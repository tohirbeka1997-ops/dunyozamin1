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

  setProduct(product) {
    if (!product || !product.id) return;
    const id = String(product.id);
    this.productById.set(id, product);
    if (product.sku) this.productBySku.set(String(product.sku), product);
    if (product.barcode) this.productByBarcode.set(String(product.barcode), product);
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
