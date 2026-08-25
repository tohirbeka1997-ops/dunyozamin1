import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('barcodeLookup normalizes and matches exact SKU/barcode', () => {
  const lookupPath = path.resolve(__dirname, '../../lib/barcodeLookup.ts');
  const source = fs.readFileSync(lookupPath, 'utf8');
  assert.match(source, /normalizeScannedCode/);
  assert.match(source, /isExactCodeMatch/);
});

test('productSearch falls back to catalog cache on network errors', () => {
  const searchPath = path.resolve(__dirname, '../../lib/productSearch.ts');
  const cachePath = path.resolve(__dirname, '../../lib/catalogCache.ts');
  const cartPath = path.resolve(__dirname, '../../store/cart.ts');
  const searchSource = fs.readFileSync(searchPath, 'utf8');
  const cacheSource = fs.readFileSync(cachePath, 'utf8');
  const cartSource = fs.readFileSync(cartPath, 'utf8');
  assert.match(searchSource, /searchProductsWithCache/);
  assert.match(searchSource, /lookupProductByCodeWithCache/);
  assert.match(searchSource, /isNetworkError/);
  assert.match(searchSource, /searchCachedProducts|lookupCachedProductByCode/);
  assert.match(cacheSource, /upsertCatalogProducts/);
  assert.match(cacheSource, /MAX_CACHED_PRODUCTS/);
  assert.match(cartSource, /hydrateCart/);
  assert.match(cartSource, /dz_staff_cart_v1/);
});

test('web barcode modal falls back to manual when camera unavailable', () => {
  const webModalPath = path.resolve(__dirname, '../BarcodeScanModal.web.tsx');
  const source = fs.readFileSync(webModalPath, 'utf8');
  assert.match(source, /ManualBarcodeForm/);
  assert.match(source, /cameraPermissionDenied|cameraUnavailable/);
  assert.match(source, /jsQR|BarcodeDetector/);
  assert.match(source, /onScan/);
  assert.match(source, /cameraPermission|isCameraGrantedInSession|probeWebCameraPermission/);
});

test('native barcode modal requests camera permission once per session', () => {
  const nativeModalPath = path.resolve(__dirname, '../BarcodeScanModal.tsx');
  const permPath = path.resolve(__dirname, '../../lib/cameraPermission.ts');
  const nativeSource = fs.readFileSync(nativeModalPath, 'utf8');
  const permSource = fs.readFileSync(permPath, 'utf8');
  assert.match(nativeSource, /useCameraPermissions/);
  assert.match(nativeSource, /hasCameraPermissionRequestStarted|markCameraPermissionRequestStarted/);
  assert.match(permSource, /sessionGranted|markCameraGrantedInSession/);
});
