/**
 * Post-process Vite dist output for Electron file:// loading.
 *
 * Some toolchains/plugins can leave absolute "/assets/..." URLs in dist/index.html.
 * In Electron production we load via file://.../dist/index.html, so "/assets/..."
 * resolves to "file:///assets/..." and breaks (white screen).
 *
 * This script rewrites known absolute asset paths to relative ones.
 */

const fs = require('fs');
const path = require('path');

function fixHtmlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[fix-electron-dist] skip (missing): ${filePath}`);
    return;
  }

  let html = fs.readFileSync(filePath, 'utf8');
  const before = html;

  // Rewrite Vite asset URLs
  html = html.replace(/(src|href)=\"\/assets\//g, '$1="./assets/');

  // Rewrite favicon (optional but nice)
  html = html.replace(/href=\"\/favicon\.png\"/g, 'href="./favicon.png"');

  // Rewrite common public images if referenced with leading slash
  html = html.replace(/(src|href)=\"\/images\//g, '$1="./images/');

  if (html !== before) {
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`[fix-electron-dist] ✅ Rewrote absolute asset paths: ${path.basename(filePath)}`);
  } else {
    console.log(`[fix-electron-dist] ℹ No changes needed: ${path.basename(filePath)}`);
  }
}

const distDir = path.resolve(__dirname, '..', 'dist');
const distIndex = path.join(distDir, 'index.html');

if (!fs.existsSync(distIndex)) {
  console.error(`[fix-electron-dist] dist/index.html not found at: ${distIndex}`);
  process.exit(1);
}

fixHtmlFile(distIndex);
fixHtmlFile(path.join(distDir, 'kassa.html'));























