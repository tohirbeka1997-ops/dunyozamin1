class CacheService {
  constructor() {
    this.productBySku = new Map();
    this.productByBarcode = new Map();
    this.productById = new Map();
    this.priceByKey = new Map();
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

  _registerSkuKeys(sku, product) {
    const s = String(sku || '').trim();
    if (!s) return;
    this.productBySku.set(s, product);
    const normalized = s.toLowerCase().replace(/[\s\-_]/g, '');
    if (normalized) this.productBySku.set(normalized, product);
    const trimmed = s.replace(/^0+/, '') || '0';
    if (trimmed !== s) this.productBySku.set(trimmed, product);
  }

  _registerBarcodeKeys(barcode, product) {
    const b = String(barcode || '').trim();
    if (!b) return;
    this.productByBarcode.set(b, product);
    const digitsOnly = b.replace(/[^\d]/g, '');
    if (digitsOnly && digitsOnly !== b) this.productByBarcode.set(digitsOnly, product);
    const upper = b.toUpperCase();
    if (upper !== b) this.productByBarcode.set(upper, product);
    const lower = b.toLowerCase();
    if (lower !== b) this.productByBarcode.set(lower, product);
  }

  setProduct(product) {
    if (!product || !product.id) return;
    const id = String(product.id);
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
    const existing = this.productById.get(id);
    if (existing?.sku) this.productBySku.delete(String(existing.sku));
    if (existing?.barcode) this.productByBarcode.delete(String(existing.barcode));
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
