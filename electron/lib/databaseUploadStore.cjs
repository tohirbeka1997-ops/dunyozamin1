'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { createError, ERROR_CODES } = require('./errors.cjs');

const UPLOAD_TTL_MS = 30 * 60 * 1000;

function createUploadStore({ tmpDir } = {}) {
  const dir = tmpDir || path.join(os.tmpdir(), 'pos-db-uploads');
  fs.mkdirSync(dir, { recursive: true });

  /** @type {Map<string, { fileName: string, totalSize: number, filePath: string, bytesWritten: number, nextIndex: number, createdAt: number }>} */
  const uploads = new Map();

  function cleanupExpired() {
    const now = Date.now();
    for (const [id, upload] of uploads) {
      if (now - upload.createdAt > UPLOAD_TTL_MS) {
        abort(id);
      }
    }
  }

  function begin({ fileName, totalSize, maxBytes }) {
    cleanupExpired();
    const size = Number(totalSize);
    if (!Number.isFinite(size) || size <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid upload size');
    }
    if (size > maxBytes) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Fayl hajmi ${Math.round(maxBytes / (1024 * 1024))}MB dan oshmasligi kerak`,
      );
    }

    const uploadId = randomUUID();
    const filePath = path.join(dir, `upload-${uploadId}.db`);
    fs.writeFileSync(filePath, Buffer.alloc(0));
    uploads.set(uploadId, {
      fileName: String(fileName || 'upload.db').slice(0, 200),
      totalSize: size,
      filePath,
      bytesWritten: 0,
      nextIndex: 0,
      createdAt: Date.now(),
    });
    return uploadId;
  }

  function writeChunk(uploadId, index, chunkBuf) {
    const upload = uploads.get(uploadId);
    if (!upload) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Upload session not found or expired');
    }
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx !== upload.nextIndex) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Unexpected chunk index');
    }
    if (!Buffer.isBuffer(chunkBuf) || chunkBuf.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Empty chunk');
    }
    if (upload.bytesWritten + chunkBuf.length > upload.totalSize) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Upload exceeds declared size');
    }

    fs.appendFileSync(upload.filePath, chunkBuf);
    upload.bytesWritten += chunkBuf.length;
    upload.nextIndex += 1;
    return {
      bytesWritten: upload.bytesWritten,
      totalSize: upload.totalSize,
      index: idx,
    };
  }

  function finalize(uploadId) {
    const upload = uploads.get(uploadId);
    if (!upload) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Upload session not found or expired');
    }
    if (upload.bytesWritten !== upload.totalSize) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Incomplete upload (${upload.bytesWritten}/${upload.totalSize} bytes)`,
      );
    }
    uploads.delete(uploadId);
    return upload;
  }

  function abort(uploadId) {
    const upload = uploads.get(uploadId);
    if (!upload) return;
    uploads.delete(uploadId);
    try {
      fs.unlinkSync(upload.filePath);
    } catch {
      // ignore
    }
  }

  return { begin, writeChunk, finalize, abort };
}

let sharedStore = null;

function getUploadStore() {
  if (!sharedStore) {
    const { resolvePosDataDir } = require('./resolvePosDbPath.cjs');
    sharedStore = createUploadStore({
      tmpDir: path.join(resolvePosDataDir(), 'tmp', 'db-uploads'),
    });
  }
  return sharedStore;
}

module.exports = { createUploadStore, getUploadStore, UPLOAD_TTL_MS };
