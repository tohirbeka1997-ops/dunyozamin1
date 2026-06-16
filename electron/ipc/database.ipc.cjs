const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { wrapHandler, createError, ERROR_CODES } = require('../lib/errors.cjs');
const { requireRole, requireAdmin } = require('../lib/ipcAuth.cjs');
const { getDb } = require('../db/open.cjs');
const { getDbPath } = require('../db/dbPath.cjs');
const {
  MAX_UPLOAD_BYTES,
  DEFAULT_CHUNK_SIZE,
  replaceDatabaseFile,
} = require('../lib/databaseReplace.cjs');

const UPLOAD_CONFIRM_TEXT = 'TASDIQLAYMAN';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function defaultBackupFileName() {
  const d = new Date();
  const ts =
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds());
  return `pos-backup-${ts}.db`;
}

function bufferFromExportData(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
    return Buffer.from(data.data);
  }
  throw createError(ERROR_CODES.INTERNAL_ERROR, 'Invalid backup data from server');
}

async function uploadFileToServer({ filePath, fileName, fileSize, callRpc, onProgress }) {
  if (fileSize > MAX_UPLOAD_BYTES) {
    throw createError(
      ERROR_CODES.VALIDATION_ERROR,
      `Fayl hajmi ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB dan oshmasligi kerak`,
    );
  }

  const beginResult = await callRpc('pos:database:uploadBegin', [{ fileName, totalSize: fileSize }]);
  const uploadId = beginResult?.uploadId;
  if (!uploadId) {
    throw createError(ERROR_CODES.INTERNAL_ERROR, 'Server upload session boshlanmadi');
  }

  const chunkSize = Number(beginResult?.chunkSize) || DEFAULT_CHUNK_SIZE;
  const fd = await fs.promises.open(filePath, 'r');

  try {
    let offset = 0;
    let index = 0;
    while (offset < fileSize) {
      const toRead = Math.min(chunkSize, fileSize - offset);
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fd.read(buf, 0, toRead, offset);
      if (bytesRead <= 0) {
        throw createError(ERROR_CODES.INTERNAL_ERROR, 'Faylni o\'qib bo\'lmadi');
      }
      const chunk = bytesRead === toRead ? buf : buf.subarray(0, bytesRead);
      await callRpc('pos:database:uploadChunk', [
        {
          uploadId,
          index,
          data: chunk.toString('base64'),
        },
      ]);
      offset += bytesRead;
      index += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          percent: Math.min(99, Math.round((offset / fileSize) * 100)),
          bytesSent: offset,
          totalBytes: fileSize,
        });
      }
    }
  } finally {
    await fd.close();
  }

  const finalizeResult = await callRpc('pos:database:uploadFinalize', [{ uploadId }]);
  if (typeof onProgress === 'function') {
    onProgress({ percent: 100, bytesSent: fileSize, totalBytes: fileSize });
  }
  return finalizeResult;
}

/**
 * Local-only IPC: snapshot DB and save via OS dialog.
 * HOST: uses local backupRunner. CLIENT: fetches bytes from HOST via RPC export.
 */
function registerDatabaseDownloadHandlers({ mode = 'host', getBackupRunner = null, callRpc = null } = {}) {
  ipcMain.removeHandler('pos:database:downloadToPc');
  ipcMain.handle(
    'pos:database:downloadToPc',
    wrapHandler(async (event) => {
      if (mode === 'host') {
        requireRole(getDb(), ['admin', 'manager']);
      }

      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const defaultFileName = defaultBackupFileName();
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Bazani kompyuterga saqlash',
        defaultPath: path.join(app.getPath('downloads'), defaultFileName),
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
      });
      if (canceled || !filePath) {
        return { canceled: true };
      }

      if (mode === 'client') {
        if (typeof callRpc !== 'function') {
          throw createError(ERROR_CODES.NOT_FOUND, 'Remote RPC not available');
        }
        const exportResult = await callRpc('pos:database:export', ['manual']);
        if (!exportResult?.ok) {
          throw createError(
            ERROR_CODES.INTERNAL_ERROR,
            exportResult?.error || 'Serverdan zaxira olib bo\'lmadi',
          );
        }
        const buf = bufferFromExportData(exportResult.data);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
        await fs.promises.writeFile(filePath, buf);
        return {
          canceled: false,
          filePath,
          fileName: exportResult.fileName || path.basename(filePath),
          size: buf.length,
        };
      }

      const backupRunner = typeof getBackupRunner === 'function' ? getBackupRunner() : null;
      if (!backupRunner || typeof backupRunner.backupOnce !== 'function') {
        throw createError(ERROR_CODES.NOT_FOUND, 'Backup service not available');
      }
      const result = await backupRunner.backupOnce('manual-download');
      if (!result?.ok || !result?.path) {
        throw createError(ERROR_CODES.INTERNAL_ERROR, result?.error || 'Zaxira yaratib bo\'lmadi');
      }
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
      await fs.promises.copyFile(result.path, filePath);
      return {
        canceled: false,
        filePath,
        fileName: path.basename(filePath),
        sourcePath: result.path,
      };
    }),
  );
}

/**
 * Admin-only: upload a .db file and replace the live database (CLIENT → server RPC, HOST → local).
 */
function registerDatabaseUploadHandlers({ mode = 'host', callRpc = null } = {}) {
  ipcMain.removeHandler('pos:database:uploadToServer');
  ipcMain.handle(
    'pos:database:uploadToServer',
    wrapHandler(async (event, payload) => {
      if (mode === 'host') {
        requireAdmin(getDb());
      }

      const confirmText = String(payload?.confirmText || '').trim();
      if (confirmText !== UPLOAD_CONFIRM_TEXT) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `"${UPLOAD_CONFIRM_TEXT}" deb yozib tasdiqlang`,
        );
      }

      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Serverga yuklash uchun bazani tanlang',
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
        properties: ['openFile'],
      });
      if (canceled || !filePaths?.[0]) {
        return { canceled: true };
      }

      const sourcePath = filePaths[0];
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile() || stat.size <= 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Tanlangan fayl bo\'sh yoki noto\'g\'ri');
      }
      if (stat.size > MAX_UPLOAD_BYTES) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Fayl hajmi ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB dan oshmasligi kerak`,
        );
      }

      const fileName = path.basename(sourcePath);
      const sendProgress = (progress) => {
        try {
          event.sender.send('pos:database:uploadProgress', progress);
        } catch {
          // ignore
        }
      };

      if (mode === 'client') {
        if (typeof callRpc !== 'function') {
          throw createError(ERROR_CODES.NOT_FOUND, 'Remote RPC not available');
        }
        const result = await uploadFileToServer({
          filePath: sourcePath,
          fileName,
          fileSize: stat.size,
          callRpc,
          onProgress: sendProgress,
        });
        return {
          canceled: false,
          fileName,
          size: stat.size,
          ...result,
        };
      }

      const targetPath = getDbPath(app);
      const tmpPath = path.join(app.getPath('temp'), `pos-upload-${Date.now()}.db`);
      await fs.promises.copyFile(sourcePath, tmpPath);
      sendProgress({ percent: 40, bytesSent: stat.size, totalBytes: stat.size });

      const { close } = require('../db/open.cjs');
      const result = replaceDatabaseFile({
        uploadPath: tmpPath,
        targetPath,
        closeDb: close,
      });
      sendProgress({ percent: 100, bytesSent: stat.size, totalBytes: stat.size });

      setTimeout(() => {
        try {
          app.relaunch();
        } finally {
          app.exit(0);
        }
      }, 500);

      return {
        canceled: false,
        fileName,
        size: stat.size,
        ...result,
        relaunchScheduled: true,
      };
    }),
  );
}

function registerDatabaseHandlers(options = {}) {
  registerDatabaseDownloadHandlers(options);
  registerDatabaseUploadHandlers(options);
}

module.exports = {
  registerDatabaseDownloadHandlers,
  registerDatabaseUploadHandlers,
  registerDatabaseHandlers,
  UPLOAD_CONFIRM_TEXT,
};
