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

const distIndex = path.resolve(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(distIndex)) {
  console.error(`[fix-electron-dist] dist/index.html not found at: ${distIndex}`);
  process.exit(1);
}

let html = fs.readFileSync(distIndex, 'utf8');
const before = html;

// Rewrite Vite asset URLs
html = html.replace(/(src|href)=\"\/assets\//g, '$1="./assets/');

// Rewrite favicon (optional but nice)
html = html.replace(/href=\"\/favicon\.png\"/g, 'href="./favicon.png"');

// Rewrite common public images if referenced with leading slash
html = html.replace(/(src|href)=\"\/images\//g, '$1="./images/');

if (html !== before) {
  fs.writeFileSync(distIndex, html, 'utf8');
  console.log('[fix-electron-dist] ✅ Rewrote absolute asset paths to relative for Electron file://');
} else {
  console.log('[fix-electron-dist] ℹ No changes needed (index.html already looks relative)');
}























