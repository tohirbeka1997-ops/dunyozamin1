'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createError, ERROR_CODES } = require('./errors.cjs');

const MAX_UPLOAD_BYTES = Math.max(
  10 * 1024 * 1024,
  Number.parseInt(String(process.env.POS_DB_UPLOAD_MAX_BYTES || '524288000'), 10) || 524288000,
);

const DEFAULT_CHUNK_SIZE = Math.max(
  256 * 1024,
  Number.parseInt(String(process.env.POS_DB_UPLOAD_CHUNK_BYTES || String(3 * 1024 * 1024)), 10) ||
    3 * 1024 * 1024,
);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestampForFilename(d = new Date()) {
  return (
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function safeMkdir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function verifySqliteFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'Upload file missing');
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'Upload file is empty');
  }
  if (stat.size > MAX_UPLOAD_BYTES) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'Upload file too large');
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Fayl SQLite bazasi emas');
    }
  } finally {
    fs.closeSync(fd);
  }

  const verifyDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const row = verifyDb.pragma('integrity_check', { simple: true });
    const result = typeof row === 'string' ? row : row?.integrity_check;
    if (result !== 'ok') {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `SQLite integrity_check failed: ${String(result).slice(0, 200)}`,
      );
    }
  } finally {
    verifyDb.close();
  }
}

function removeSidecarFiles(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // ignore
    }
  }
}

function backupExistingDb(dbPath, backupDir) {
  safeMkdir(backupDir);
  const ts = timestampForFilename();
  const backupPath = path.join(backupDir, `pos-pre-upload-${ts}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function atomicMoveFile(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      fs.copyFileSync(sourcePath, targetPath);
      fs.unlinkSync(sourcePath);
      return;
    }
    throw err;
  }
}

function runMigrationsOnFile(dbPath) {
  const tempDb = new Database(dbPath);
  try {
    tempDb.pragma('journal_mode = DELETE');
    tempDb.pragma('foreign_keys = ON');
    const { runMigrations } = require('../db/migrate.cjs');
    runMigrations(tempDb);
  } finally {
    tempDb.close();
  }
}

/**
 * Replace live pos.db with a verified upload file.
 * Caller should restart the process afterwards so services pick up the new DB handle.
 */
function replaceDatabaseFile({ uploadPath, targetPath, closeDb } = {}) {
  if (!uploadPath || !targetPath) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'uploadPath and targetPath are required');
  }

  verifySqliteFile(uploadPath);

  const backupDir = path.join(path.dirname(targetPath), 'backups');
  let backupPath = null;
  if (fs.existsSync(targetPath)) {
    backupPath = backupExistingDb(targetPath, backupDir);
  }

  if (typeof closeDb === 'function') {
    closeDb();
  }

  removeSidecarFiles(targetPath);
  atomicMoveFile(uploadPath, targetPath);
  runMigrationsOnFile(targetPath);

  return {
    ok: true,
    backupPath,
    targetPath,
    restartRequired: true,
  };
}

module.exports = {
  MAX_UPLOAD_BYTES,
  DEFAULT_CHUNK_SIZE,
  verifySqliteFile,
  replaceDatabaseFile,
};
