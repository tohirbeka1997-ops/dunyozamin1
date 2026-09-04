class CacheService {
  constructor() {
    this.productBySku = new Map();
    this.productByBarcode = new Map();
    this.productById = new Map();
    this.priceByKey = new Map();
    this._skuKeysByProductId = new Map();
    this._barcodeKeysByProductId = new Map();
  }

  _priceKey({ product_id, tier_id, currency, unit }) {
    return `${product_id || ''}::${tier_id || ''}::${currency || ''}::${unit || ''}`;
  }

  getProductBySku(sku) {
    return this.productBySku.get(String(sku || '')) || null;
  }

  getProductByBarcode(barcode) {
    return this.productByBarcode.get(String(barcode || '')) || null;
  }

  getProductById(id) {
    return this.productById.get(String(id || '')) || null;
  }

  _rememberKey(index, productId, key) {
    const id = String(productId || '');
    let keys = index.get(id);
    if (!keys) {
      keys = new Set();
      index.set(id, keys);
    }
    keys.add(key);
  }

  _dropRememberedKeys(map, index, productId) {
    const id = String(productId || '');
    const keys = index.get(id);
    if (keys) {
      for (const key of keys) map.delete(key);
      index.delete(id);
    }
  }

  _registerSkuKeys(sku, product) {
    const s = String(sku || '').trim();
    if (!s || !product?.id) return;
    const id = String(product.id);
    const add = (key) => {
      if (!key) return;
      this.productBySku.set(key, product);
      this._rememberKey(this._skuKeysByProductId, id, key);
    };
    add(s);
    const normalized = s.toLowerCase().replace(/[\s\-_]/g, '');
    if (normalized) add(normalized);
    const trimmed = s.replace(/^0+/, '') || '0';
    if (trimmed !== s) add(trimmed);
  }

  _registerBarcodeKeys(barcode, product) {
    const b = String(barcode || '').trim();
    if (!b || !product?.id) return;
    const id = String(product.id);
    const add = (key) => {
      if (!key) return;
      this.productByBarcode.set(key, product);
      this._rememberKey(this._barcodeKeysByProductId, id, key);
    };
    add(b);
    const digitsOnly = b.replace(/[^\d]/g, '');
    if (digitsOnly && digitsOnly !== b) add(digitsOnly);
    const upper = b.toUpperCase();
    if (upper !== b) add(upper);
    const lower = b.toLowerCase();
    if (lower !== b) add(lower);
  }

  setProduct(product) {
    if (!product || !product.id) return;
    const id = String(product.id);
    // Drop every previous SKU/barcode alias for this id before registering the
    // current codes. Otherwise regenerate/edit leaves the old SKU "occupied"
    // in lookup caches (normalized / zero-stripped keys).
    this.invalidateProduct(id);
    this.productById.set(id, product);
    if (product.sku) this._registerSkuKeys(product.sku, product);
    if (product.barcode) this._registerBarcodeKeys(product.barcode, product);
    const alt = product.alt_barcodes;
    if (Array.isArray(alt)) {
      for (const code of alt) this._registerBarcodeKeys(code, product);
    }
  }

  invalidateProduct(productId) {
    const id = String(productId || '');
    this._dropRememberedKeys(this.productBySku, this._skuKeysByProductId, id);
    this._dropRememberedKeys(this.productByBarcode, this._barcodeKeysByProductId, id);
    this.productById.delete(id);
  }

  getPrice({ product_id, tier_id, currency, unit }) {
    const key = this._priceKey({ product_id, tier_id, currency, unit });
    return this.priceByKey.has(key) ? this.priceByKey.get(key) : null;
  }

  setPrice({ product_id, tier_id, currency, unit, price }) {
    const key = this._priceKey({ product_id, tier_id, currency, unit });
    this.priceByKey.set(key, price);
  }

  invalidatePricesForProduct(productId) {
    const prefix = `${productId || ''}::`;
    for (const key of this.priceByKey.keys()) {
      if (key.startsWith(prefix)) this.priceByKey.delete(key);
    }
  }
}

module.exports = CacheService;
