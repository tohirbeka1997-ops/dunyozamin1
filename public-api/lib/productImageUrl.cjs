'use strict';

const path = require('path');
const fs = require('fs');

function getProductImageDir() {
  return path.join(process.env.POS_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'product-images');
}

/**
 * @param {string | null | undefined} imageUrl
 * @returns {string | null}
 */
function extractProductImageFileName(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const u = imageUrl.trim();
  if (!u || u.startsWith('data:')) return null;
  if (u.startsWith('product-image://')) {
    return path.basename(decodeURIComponent(u.replace(/^product-image:\/\//, ''))).replace(/\.\./g, '');
  }
  if (u.startsWith('/product-images/')) {
    return path.basename(decodeURIComponent(u.split('?')[0])).replace(/\.\./g, '');
  }
  if (u.startsWith('file://')) {
    const parts = u.split(/[/\\]/);
    const last = parts[parts.length - 1] || '';
    return last.replace(/\.\./g, '') || null;
  }
  return null;
}

/**
 * @param {import('express').Request | { headers?: Record<string, string | string[] | undefined> }} req
 */
function externalBaseUrl(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim() || 'http';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
    .split(',')[0]
    .trim();
  return host ? `${proto}://${host}` : '';
}

/**
 * Resolve stored image URL to a path the mini-app / browser can load.
 * @param {string | null | undefined} imageUrl
 * @param {import('express').Request | { headers?: Record<string, string | string[] | undefined> }} [req]
 */
function resolveCatalogImageUrl(imageUrl, req) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const u = imageUrl.trim();
  if (!u) return null;
  if (u.startsWith('data:')) return null;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;

  const fileName = extractProductImageFileName(u);
  const imageDir = getProductImageDir();
  if (fileName) {
    const filePath = path.join(imageDir, fileName);
    if (fs.existsSync(filePath)) {
      const publicPath = `/product-images/${fileName}`;
      const base = externalBaseUrl(req);
      return base ? `${base}${publicPath}` : publicPath;
    }
  }

  if (u.startsWith('/product-images/')) {
    const base = externalBaseUrl(req);
    return base ? `${base}${u}` : u;
  }

  return null;
}

module.exports = {
  getProductImageDir,
  extractProductImageFileName,
  resolveCatalogImageUrl,
  externalBaseUrl,
};
