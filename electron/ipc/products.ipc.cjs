const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

// Defensive check: ensure wrapHandler is imported correctly
if (typeof wrapHandler !== 'function') {
  throw new Error(
    `wrapHandler import is invalid: check electron/lib/errors.cjs export.\n` +
    `  Expected: function\n` +
    `  Actual: ${typeof wrapHandler}\n` +
    `  Ensure errors.cjs exports: module.exports = { wrapHandler, ... };`
  );
}

/**
 * Products IPC Handlers
 * Channels: pos:products:*
 */
function registerProductsHandlers(services) {
  if (!services) {
    throw new Error('Services object is required for registerProductsHandlers');
  }

  const { products, audit } = services;
  
  if (!products) {
    throw new Error('Products service is not available in services object');
  }

  // Remove any existing handlers before registering (allows override of fallback handlers)
  console.log('Registering pos:products:list handler...');
  ipcMain.removeHandler('pos:products:list');
  ipcMain.handle('pos:products:list', wrapHandler(async (_event, filters) => {
    return products.list(filters || {});
  }));

  console.log('Registering pos:products:searchScreen handler...');
  ipcMain.removeHandler('pos:products:searchScreen');
  ipcMain.handle('pos:products:searchScreen', wrapHandler(async (_event, filters) => {
    return products.searchScreen(filters || {});
  }));

  console.log('Registering pos:products:get handler...');
  ipcMain.removeHandler('pos:products:get');
  ipcMain.handle('pos:products:get', wrapHandler(async (_event, id) => {
    return products.getById(id);
  }));

  console.log('Registering pos:products:getBySku handler...');
  ipcMain.removeHandler('pos:products:getBySku');
  ipcMain.handle('pos:products:getBySku', wrapHandler(async (_event, sku) => {
    return products.getBySku(sku);
  }));

  console.log('Registering pos:products:getByBarcode handler...');
  ipcMain.removeHandler('pos:products:getByBarcode');
  ipcMain.handle('pos:products:getByBarcode', wrapHandler(async (_event, barcode) => {
    return products.getByBarcode(barcode);
  }));

  console.log('Registering pos:products:getNextSku handler...');
  ipcMain.removeHandler('pos:products:getNextSku');
  ipcMain.handle('pos:products:getNextSku', wrapHandler(async (_event) => {
    return products.getNextSku();
  }));

  console.log('Registering pos:products:getNextBarcode handler...');
  ipcMain.removeHandler('pos:products:getNextBarcode');
  ipcMain.handle('pos:products:getNextBarcode', wrapHandler(async (_event) => {
    return products.getNextBarcode();
  }));

  console.log('Registering pos:products:getNextBarcodeForUnit handler...');
  ipcMain.removeHandler('pos:products:getNextBarcodeForUnit');
  ipcMain.handle('pos:products:getNextBarcodeForUnit', wrapHandler(async (_event, unit) => {
    return products.getNextBarcodeForUnit(unit);
  }));

  console.log('Registering pos:products:create handler...');
  ipcMain.removeHandler('pos:products:create');
  ipcMain.handle('pos:products:create', wrapHandler(async (event, data) => {
    console.log('📦 [IPC] pos:products:create called with data:', JSON.stringify(data, null, 2));
    try {
      const result = await products.create(data);
      // Audit (best-effort)
      try {
        audit?.logProductCreate?.(result, null);
      } catch {}
      console.log('✅ [IPC] pos:products:create succeeded, returning product:', result.id, result.name);
      console.log('✅ [IPC] Product successfully saved to pos.db:', result.name);
      // Emit cache invalidation event (frontend should listen and invalidate React Query)
      if (event && event.sender) {
        event.sender.send('cache:invalidate', { type: 'products' });
        console.log('📢 [IPC] Cache invalidation event sent to frontend');
      }
      return result;
    } catch (error) {
      console.error('❌ [IPC] pos:products:create error:', error);
      throw error;
    }
  }));

  console.log('Registering pos:products:update handler...');
  ipcMain.removeHandler('pos:products:update');
  ipcMain.handle('pos:products:update', wrapHandler(async (event, id, data) => {
    console.log('✏️ [IPC] pos:products:update called with id:', id, 'data:', JSON.stringify(data, null, 2));
    try {
      const before = (() => {
        try {
          return products.getById(id);
        } catch {
          return null;
        }
      })();
      const result = await products.update(id, data);
      // Audit (best-effort)
      try {
        if (before) audit?.logProductUpdate?.(before, result, null);
      } catch {}
      console.log('✅ [IPC] pos:products:update succeeded:', result?.id);
      // Emit cache invalidation event
      if (event && event.sender) {
        event.sender.send('cache:invalidate', { type: 'products' });
      }
      return result;
    } catch (error) {
      console.error('❌ [IPC] pos:products:update error:', error);
      console.error('❌ [IPC] Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      throw error;
    }
  }));

  console.log('Registering pos:products:delete handler...');
  ipcMain.removeHandler('pos:products:delete');
  ipcMain.handle('pos:products:delete', wrapHandler(async (event, id) => {
    console.log('🗑️ [IPC] pos:products:delete called with id:', id);
    try {
      const before = (() => {
        try {
          return products.getById(id);
        } catch {
          return null;
        }
      })();
      const result = await products.delete(id);
      // Audit (best-effort)
      try {
        if (before) audit?.logProductDelete?.(before, null);
      } catch {}
      console.log('✅ [IPC] pos:products:delete succeeded:', result);
      // Emit cache invalidation event
      if (event && event.sender) {
        event.sender.send('cache:invalidate', { type: 'products' });
      }
      return result;
    } catch (error) {
      console.error('❌ [IPC] pos:products:delete error:', error);
      console.error('❌ [IPC] Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      throw error;
    }
  }));

  console.log('Registering pos:products:exportScaleRongtaTxt handler...');
  ipcMain.removeHandler('pos:products:exportScaleRongtaTxt');
  ipcMain.handle(
    'pos:products:exportScaleRongtaTxt',
    wrapHandler(async (_event, opts) => {
      const department = Number.isFinite(Number(opts?.department)) ? Number(opts.department) : 7;
      const prefix = Number.isFinite(Number(opts?.prefix)) ? Number(opts.prefix) : 20;

      const rows = products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

      const isWeight = (p) => {
        const unit = (p?.unit ?? '').toString().toLowerCase();
        const unitCode = (p?.unit_code ?? '').toString().toLowerCase();
        const unitSymbol = (p?.unit_symbol ?? '').toString().toLowerCase();
        return unit === 'kg' || unitCode === 'kg' || unitSymbol === 'kg';
      };

      const sanitize = (s) =>
        String(s ?? '')
          .replaceAll('\r', ' ')
          .replaceAll('\n', ' ')
          .replaceAll(';', ',')
          .trim();

      const extractPlu = (skuRaw) => {
        const digits = String(skuRaw ?? '').match(/\d+/g)?.join('') ?? '';
        if (!digits) return null;
        const normalized = digits.length > 5 ? digits.slice(-5) : digits;
        const n = Number.parseInt(normalized, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
      };

      const lines = [];
      const stats = {
        total: rows.length,
        exported: 0,
        skippedNotWeight: 0,
        skippedNoPlu: 0,
        skippedInvalid: 0,
      };

      for (const p of rows) {
        if (!isWeight(p)) {
          stats.skippedNotWeight++;
          continue;
        }

        const plu = extractPlu(p.sku);
        if (!plu) {
          stats.skippedNoPlu++;
          continue;
        }

        const name = sanitize(p.name);
        const sku = sanitize(p.sku);
        const priceRaw = Number(p.sale_price);
        const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;

        // Rongta format:
        // Name;PLU;ProductCode;Price;Department;TypeWeight;0;Prefix
        // For weight goods: TypeWeight=4, Prefix=20
        const typeWeight = 4;
        const line = `${name};${plu};${sku};${price};${department};${typeWeight};0;${prefix}`;
        if (!line || line.startsWith(';')) {
          stats.skippedInvalid++;
          continue;
        }

        lines.push(line);
        stats.exported++;
      }

      const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
      return { content, stats };
    })
  );

  // --------------------------------------------------------------------------
  // Scale exports for specific device formats
  // --------------------------------------------------------------------------

  console.log('Registering pos:products:exportScaleSharqTxt handler...');
  ipcMain.removeHandler('pos:products:exportScaleSharqTxt');
  ipcMain.handle(
    'pos:products:exportScaleSharqTxt',
    wrapHandler(async (_event, opts) => {
      // Format example (provided by user):
      //   @SHARQUZB BANANCHIK KG #1;1;16;52000;7;4;0;29
      // Interpreted as:
      //   "@SHARQUZB " + Name + " KG" + " #" + PLU + ";" + ProductCode + ";" + Group + ";" + Price + ";" + Dept + ";4;0;" + Prefix
      const department = Number.isFinite(Number(opts?.department)) ? Number(opts.department) : 7;
      const prefix = Number.isFinite(Number(opts?.prefix)) ? Number(opts.prefix) : 29;
      const group = Number.isFinite(Number(opts?.group)) ? Number(opts.group) : 19;
      const brand = String(opts?.brand ?? '@SHARQUZB').trim() || '@SHARQUZB';

      const rows = products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

      const isWeight = (p) => {
        const unit = (p?.unit ?? '').toString().toLowerCase();
        const unitCode = (p?.unit_code ?? '').toString().toLowerCase();
        const unitSymbol = (p?.unit_symbol ?? '').toString().toLowerCase();
        return unit === 'kg' || unitCode === 'kg' || unitSymbol === 'kg';
      };

      const sanitizeName = (s) =>
        String(s ?? '')
          .replaceAll('\r', ' ')
          .replaceAll('\n', ' ')
          .replaceAll(';', ' ')
          .trim();

      const extractPlu = (skuRaw) => {
        const digits = String(skuRaw ?? '').match(/\d+/g)?.join('') ?? '';
        if (!digits) return null;
        const normalized = digits.length > 5 ? digits.slice(-5) : digits;
        const n = Number.parseInt(normalized, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
      };

      const lines = [];
      const stats = {
        total: rows.length,
        exported: 0,
        skippedNotWeight: 0,
        skippedNoPlu: 0,
        skippedInvalid: 0,
      };

      for (const p of rows) {
        if (!isWeight(p)) {
          stats.skippedNotWeight++;
          continue;
        }

        const plu = extractPlu(p.sku);
        if (!plu) {
          stats.skippedNoPlu++;
          continue;
        }

        let name = sanitizeName(p.name);
        // Ensure " KG" suffix (as required by scale import format)
        if (!/\bkg\b/i.test(name)) name = `${name} KG`;
        const priceRaw = Number(p.sale_price);
        const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;

        // ProductCode is numeric on these scales; default to PLU.
        const productCode = plu;
        const typeWeight = 4;
        const line = `${brand} ${name} #${plu};${productCode};${group};${price};${department};${typeWeight};0;${prefix}`;
        if (!line || !line.includes('#') || line.startsWith(' #')) {
          stats.skippedInvalid++;
          continue;
        }

        lines.push(line);
        stats.exported++;
      }

      const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
      return { content, stats };
    })
  );

  console.log('Registering pos:products:exportScaleCsv3 handler...');
  ipcMain.removeHandler('pos:products:exportScaleCsv3');
  ipcMain.handle(
    'pos:products:exportScaleCsv3',
    wrapHandler(async (_event, _opts) => {
      // Format example (provided by user):
      //   00556,Mexmash shurup 1.6mm KG,32000
      // Columns: PLU(5 digits), NAME, PRICE
      const rows = products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

      const isWeight = (p) => {
        const unit = (p?.unit ?? '').toString().toLowerCase();
        const unitCode = (p?.unit_code ?? '').toString().toLowerCase();
        const unitSymbol = (p?.unit_symbol ?? '').toString().toLowerCase();
        return unit === 'kg' || unitCode === 'kg' || unitSymbol === 'kg';
      };

      const sanitizeCsv = (s) =>
        String(s ?? '')
          .replaceAll('\r', ' ')
          .replaceAll('\n', ' ')
          .replaceAll(',', ' ')
          .trim();

      const extractPlu = (skuRaw) => {
        const digits = String(skuRaw ?? '').match(/\d+/g)?.join('') ?? '';
        if (!digits) return null;
        const normalized = digits.length > 5 ? digits.slice(-5) : digits;
        const n = Number.parseInt(normalized, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
      };

      const pad5 = (n) => String(n).padStart(5, '0');

      const lines = [];
      const stats = {
        total: rows.length,
        exported: 0,
        skippedNotWeight: 0,
        skippedNoPlu: 0,
        skippedInvalid: 0,
      };

      for (const p of rows) {
        if (!isWeight(p)) {
          stats.skippedNotWeight++;
          continue;
        }

        const pluNum = extractPlu(p.sku);
        if (!pluNum) {
          stats.skippedNoPlu++;
          continue;
        }
        const plu = pad5(pluNum);

        const name = sanitizeCsv(p.name);
        const priceRaw = Number(p.sale_price);
        const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;

        const line = `${plu},${name},${price}`;
        if (!line || line.startsWith(',')) {
          stats.skippedInvalid++;
          continue;
        }

        lines.push(line);
        stats.exported++;
      }

      const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
      return { content, stats };
    })
  );

  console.log('Registering pos:products:getImages handler...');
  ipcMain.removeHandler('pos:products:getImages');
  ipcMain.handle('pos:products:getImages', wrapHandler(async (_event, productId) => {
    return products.getProductImages(productId);
  }));

  console.log('Registering pos:products:addImage handler...');
  ipcMain.removeHandler('pos:products:addImage');
  ipcMain.handle('pos:products:addImage', wrapHandler(async (_event, productId, url, sortOrder, isPrimary) => {
    return products.addProductImage(productId, url, sortOrder ?? 0, isPrimary ? 1 : 0);
  }));

  console.log('Registering pos:products:removeImage handler...');
  ipcMain.removeHandler('pos:products:removeImage');
  ipcMain.handle('pos:products:removeImage', wrapHandler(async (_event, imageId, productId) => {
    return products.removeProductImage(imageId, productId);
  }));

  console.log('Registering pos:products:setImages handler...');
  ipcMain.removeHandler('pos:products:setImages');
  ipcMain.handle('pos:products:setImages', wrapHandler(async (event, productId, images) => {
    const result = products.setProductImages(productId, images || []);
    if (event?.sender) event.sender.send('cache:invalidate', { type: 'products' });
    return result;
  }));

  console.log('Registering pos:products:exportScaleLegacyTxt handler...');
  ipcMain.removeHandler('pos:products:exportScaleLegacyTxt');
  ipcMain.handle(
    'pos:products:exportScaleLegacyTxt',
    wrapHandler(async (_event, opts) => {
      // Legacy scale import format (confirmed working by user):
      //   Name;PLU;000PLU;Price;7;4;0;20
      const department = Number.isFinite(Number(opts?.department)) ? Number(opts.department) : 7;
      const prefix = Number.isFinite(Number(opts?.prefix)) ? Number(opts.prefix) : 20;

      const rows = products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

      const isWeight = (p) => {
        const unit = (p?.unit ?? '').toString().toLowerCase();
        const unitCode = (p?.unit_code ?? '').toString().toLowerCase();
        const unitSymbol = (p?.unit_symbol ?? '').toString().toLowerCase();
        return unit === 'kg' || unitCode === 'kg' || unitSymbol === 'kg';
      };

      const sanitize = (s) =>
        String(s ?? '')
          .replaceAll('\r', ' ')
          .replaceAll('\n', ' ')
          .replaceAll(';', ',')
          .trim();

      const extractPlu = (skuRaw) => {
        const digits = String(skuRaw ?? '').match(/\d+/g)?.join('') ?? '';
        if (!digits) return null;
        const normalized = digits.length > 5 ? digits.slice(-5) : digits;
        const n = Number.parseInt(normalized, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
      };

      const pad5 = (n) => String(n).padStart(5, '0');

      const lines = [];
      const stats = {
        total: rows.length,
        exported: 0,
        skippedNotWeight: 0,
        skippedNoPlu: 0,
        skippedInvalid: 0,
      };

      for (const p of rows) {
        if (!isWeight(p)) {
          stats.skippedNotWeight++;
          continue;
        }

        const pluNum = extractPlu(p.sku);
        if (!pluNum) {
          stats.skippedNoPlu++;
          continue;
        }

        const name = sanitize(p.name);
        const priceRaw = Number(p.sale_price);
        const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;

        const plu = String(pluNum);
        const plu5 = pad5(pluNum);
        const typeWeight = 4;

        const line = `${name};${plu};${plu5};${price};${department};${typeWeight};0;${prefix}`;
        if (!line || line.startsWith(';')) {
          stats.skippedInvalid++;
          continue;
        }

        lines.push(line);
        stats.exported++;
      }

      const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
      return { content, stats };
    })
  );

  console.log('All products handlers registered successfully');
}

module.exports = { registerProductsHandlers };



