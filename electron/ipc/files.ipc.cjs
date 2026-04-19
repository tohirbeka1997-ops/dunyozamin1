const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const iconv = require('iconv-lite');
const { wrapHandler, createError, ERROR_CODES } = require('../lib/errors.cjs');

const IMAGE_FILTERS = [
  { name: 'Rasmlar', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
  { name: 'Barcha fayllar', extensions: ['*'] },
];

/**
 * Files / OS dialogs IPC Handlers
 * Channels: pos:files:*
 */
function registerFilesHandlers() {
  // Pick a file path via OS "Save As" dialog (returns path only, does not write)
  ipcMain.removeHandler('pos:files:selectSavePath');
  ipcMain.handle(
    'pos:files:selectSavePath',
    wrapHandler(async (event, defaultName) => {
      const defaultFileName =
        typeof defaultName === 'string' && defaultName.trim()
          ? defaultName.trim()
          : 'file.txt';

      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Saqlash',
        defaultPath: path.join(process.cwd(), path.basename(defaultFileName)),
      });

      if (canceled || !filePath) {
        return { canceled: true };
      }

      return { canceled: false, filePath };
    })
  );

  // Write a file to disk
  ipcMain.removeHandler('pos:files:writeFile');
  ipcMain.handle(
    'pos:files:writeFile',
    wrapHandler(async (_event, filePath, data, encoding) => {
      const fp = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : null;
      if (!fp) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'filePath is required');
      }

      const encRaw = typeof encoding === 'string' ? encoding.trim().toLowerCase() : 'utf8';
      const enc =
        encRaw === 'ansi' || encRaw === 'win1251' || encRaw === 'windows-1251'
          ? 'cp1251'
          : encRaw || 'utf8';

      let payload;
      if (Buffer.isBuffer(data)) {
        payload = data;
      } else if (typeof data === 'string') {
        payload = enc === 'utf8' ? data : iconv.encode(data, enc);
      } else if (data && typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
        // best-effort support for structured buffer
        payload = Buffer.from(data.data);
      } else {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'data must be string or Buffer');
      }

      await fs.promises.mkdir(path.dirname(fp), { recursive: true }).catch(() => {});
      await fs.promises.writeFile(fp, payload);
      return { success: true };
    })
  );

  // Read a file from disk
  ipcMain.removeHandler('pos:files:readFile');
  ipcMain.handle(
    'pos:files:readFile',
    wrapHandler(async (_event, filePath, encoding) => {
      const fp = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : null;
      if (!fp) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'filePath is required');
      }

      const encRaw = typeof encoding === 'string' ? encoding.trim().toLowerCase() : 'utf8';
      const enc =
        encRaw === 'ansi' || encRaw === 'win1251' || encRaw === 'windows-1251'
          ? 'cp1251'
          : encRaw || 'utf8';

      const buf = await fs.promises.readFile(fp);
      if (enc === 'utf8') return buf.toString('utf8');
      return iconv.decode(buf, enc);
    })
  );

  // Check if file exists
  ipcMain.removeHandler('pos:files:exists');
  ipcMain.handle(
    'pos:files:exists',
    wrapHandler(async (_event, filePath) => {
      const fp = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : null;
      if (!fp) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'filePath is required');
      }
      return fs.existsSync(fp);
    })
  );

  // Save a text file to disk using OS "Save As" dialog
  ipcMain.removeHandler('pos:files:saveTextFile');
  ipcMain.handle(
    'pos:files:saveTextFile',
    wrapHandler(async (event, opts) => {
      const content = typeof opts?.content === 'string' ? opts.content : null;
      if (content == null) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'content is required');
      }

      const defaultFileName =
        typeof opts?.defaultFileName === 'string' && opts.defaultFileName.trim()
          ? opts.defaultFileName.trim()
          : 'file.txt';

      const filters = Array.isArray(opts?.filters) ? opts.filters : undefined;

      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Saqlash',
        defaultPath: path.join(
          // If defaultFileName includes dirs, keep only basename
          process.cwd(),
          path.basename(defaultFileName)
        ),
        filters,
      });

      if (canceled || !filePath) {
        return { canceled: true };
      }

      await fs.promises.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
      const encRaw = typeof opts?.encoding === 'string' ? opts.encoding.trim().toLowerCase() : 'utf8';
      const enc =
        encRaw === 'ansi' || encRaw === 'win1251' || encRaw === 'windows-1251'
          ? 'cp1251'
          : encRaw || 'utf8';
      const payload = enc === 'utf8' ? content : iconv.encode(content, enc);
      await fs.promises.writeFile(filePath, payload);
      return { canceled: false, filePath };
    })
  );

  // Open a text file from disk using OS "Open" dialog (returns content)
  ipcMain.removeHandler('pos:files:openTextFile');
  ipcMain.handle(
    'pos:files:openTextFile',
    wrapHandler(async (event, opts) => {
      const filters = Array.isArray(opts?.filters) ? opts.filters : undefined;
      const defaultPath = typeof opts?.defaultPath === 'string' && opts.defaultPath.trim() ? opts.defaultPath.trim() : undefined;

      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Ochish',
        defaultPath: defaultPath || process.cwd(),
        properties: ['openFile'],
        filters,
      });

      if (canceled || !filePaths || !filePaths[0]) {
        return { canceled: true };
      }

      const filePath = filePaths[0];
      const encRaw = typeof opts?.encoding === 'string' ? opts.encoding.trim().toLowerCase() : 'utf8';
      const enc =
        encRaw === 'ansi' || encRaw === 'win1251' || encRaw === 'windows-1251'
          ? 'cp1251'
          : encRaw || 'utf8';

      const buf = await fs.promises.readFile(filePath);
      const content = enc === 'utf8' ? buf.toString('utf8') : iconv.decode(buf, enc);
      return { canceled: false, filePath, content };
    })
  );

  // Select image file(s) via OS dialog (for product images)
  // Returns single filePath for backward compat, or filePaths array when multiple selected
  ipcMain.removeHandler('pos:files:selectImageFile');
  ipcMain.handle(
    'pos:files:selectImageFile',
    wrapHandler(async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Maxsulot rasmini tanlash',
        defaultPath: process.cwd(),
        properties: ['openFile', 'multiSelections'],
        filters: IMAGE_FILTERS,
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { canceled: true };
      }

      return { canceled: false, filePath: filePaths[0], filePaths };
    })
  );

  // Save product image: copy selected file to app's product-images folder
  // productIdOrTempId: product id or temp-xxx for new products
  // index: optional 0-based index for multiple images per product (e.g. productId-0.png, productId-1.png)
  ipcMain.removeHandler('pos:files:saveProductImage');
  ipcMain.handle(
    'pos:files:saveProductImage',
    wrapHandler(async (_event, sourcePath, productIdOrTempId, index) => {
      const src = typeof sourcePath === 'string' && sourcePath.trim() ? sourcePath.trim() : null;
      const id = typeof productIdOrTempId === 'string' && productIdOrTempId.trim()
        ? productIdOrTempId.trim()
        : `temp-${Date.now()}`;

      if (!src || !fs.existsSync(src)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Fayl topilmadi');
      }

      const ext = path.extname(src).toLowerCase() || '.png';
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext) ? ext : '.png';
      const userData = app.getPath('userData');
      const imagesDir = path.join(userData, 'product-images');
      await fs.promises.mkdir(imagesDir, { recursive: true });
      const destFileName = typeof index === 'number' && index >= 0
        ? `${id}-${index}${safeExt}`
        : `${id}${safeExt}`;
      const destPath = path.join(imagesDir, destFileName);
      await fs.promises.copyFile(src, destPath);
      const displayUrl = `product-image://${destFileName}`;
      return { path: destPath, fileUrl: displayUrl };
    })
  );

  // Convert local file path to file:// URL for display in renderer
  ipcMain.removeHandler('pos:files:pathToFileUrl');
  ipcMain.handle(
    'pos:files:pathToFileUrl',
    wrapHandler(async (_event, filePath) => {
      const fp = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : null;
      if (!fp || !fs.existsSync(fp)) {
        return null;
      }
      return pathToFileURL(fp).href;
    })
  );
}

module.exports = { registerFilesHandlers };
















