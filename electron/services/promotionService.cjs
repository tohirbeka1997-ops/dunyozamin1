/**
 * Promotion Service (Aksiya)
 * Rule engine for applying promotions to cart items
 */

const { randomUUID } = require('crypto');

const DEFAULT_STORE_ID = 'default-store-001';

class PromotionService {
  constructor(db) {
    this.db = db;
  }

  /**
   * List active promotions (status=active, within date range, optionally filtered by store)
   */
  listActivePromotions(storeId = null, warehouseId = null) {
    const store = storeId || DEFAULT_STORE_ID;
    const now = new Date().toISOString();

    const rows = this.db
      .prepare(
        `
      SELECT p.*, ps.scope_type, ps.scope_ids, pc.min_qty, pc.min_amount, pc.promo_code,
             pr.discount_percent, pr.discount_amount, pr.fixed_price
      FROM promotions p
      LEFT JOIN promotion_scope ps ON ps.promotion_id = p.id
      LEFT JOIN promotion_condition pc ON pc.promotion_id = p.id
      LEFT JOIN promotion_reward pr ON pr.promotion_id = p.id
      WHERE p.status = 'active'
        AND p.start_at <= ?
        AND p.end_at >= ?
        AND (p.store_id IS NULL OR p.store_id = ?)
      ORDER BY p.priority DESC, p.created_at ASC
    `
      )
      .all(now, now, store);

    return rows;
  }

  /**
   * Check if product matches promotion scope
   * scope_type 'products' = ONLY selected product IDs; 'categories' = products in selected categories; 'all' = all products
   */
  _productMatchesScope(product, scope) {
    if (!scope) return false;
    const st = (scope.scope_type || '').toLowerCase();
    if (st === 'all') return true;

    let ids = [];
    try {
      const raw = scope.scope_ids;
      ids = raw ? JSON.parse(String(raw)) : [];
    } catch {
      return false;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      if (st === 'products' || st === 'categories') return false;
      return st === 'all';
    }

    const productId = product?.id ? String(product.id) : null;
    if (!productId) return false;

    if (st === 'products') {
      return ids.some((id) => String(id) === productId);
    }
    if (st === 'categories') {
      const catId = product?.category_id ? String(product.category_id) : null;
      return catId ? ids.some((id) => String(id) === catId) : false;
    }
    return false;
  }

  /**
   * Check if conditions are met (min_qty, min_amount, promo_code)
   */
  _conditionsMet(condition, quantity, lineSubtotal, cartSubtotal, promoCode) {
    if (!condition) return true;

    if (condition.min_qty != null && quantity < Number(condition.min_qty)) return false;
    if (condition.min_amount != null) {
      const minAmt = Number(condition.min_amount);
      if (minAmt > 0 && cartSubtotal < minAmt) return false;
    }
    if (condition.promo_code) {
      const code = (promoCode || '').trim().toUpperCase();
      const expected = (condition.promo_code || '').trim().toUpperCase();
      if (code !== expected) return false;
    }
    return true;
  }

  /**
   * Compute discount for a single line item based on reward
   */
  _computeDiscount(reward, type, unitPrice, quantity, lineSubtotal) {
    if (!reward) return { discountAmount: 0, finalUnitPrice: unitPrice };

    let discountAmount = 0;
    let finalUnitPrice = unitPrice;

    if (type === 'percent_discount' && reward.discount_percent != null) {
      const pct = Number(reward.discount_percent);
      if (pct > 0 && pct <= 100) {
        discountAmount = (lineSubtotal * pct) / 100;
        finalUnitPrice = lineSubtotal > 0 ? (lineSubtotal - discountAmount) / quantity : unitPrice;
      }
    } else if (type === 'amount_discount' && reward.discount_amount != null) {
      const amt = Number(reward.discount_amount);
      if (amt > 0) {
        discountAmount = Math.min(amt * quantity, lineSubtotal);
        finalUnitPrice = lineSubtotal > 0 ? (lineSubtotal - discountAmount) / quantity : unitPrice;
      }
    } else if (type === 'fixed_price' && reward.fixed_price != null) {
      const fp = Number(reward.fixed_price);
      if (fp >= 0) {
        finalUnitPrice = fp;
        discountAmount = Math.max(0, lineSubtotal - fp * quantity);
      }
    }

    return { discountAmount, finalUnitPrice };
  }

  /**
   * Apply promotions to cart items
   * @param {Array} cartItems - [{ product, quantity, unit_price, ... }]
   * @param {string|null} customerId
   * @param {string|null} promoCode
   * @returns {Array} Cart items with promotion applied (discount_amount, promotion_id, etc.)
   */
  applyPromotions(cartItems, customerId = null, promoCode = null) {
    if (!cartItems || cartItems.length === 0) return cartItems;

    const cartSubtotal = cartItems.reduce((sum, it) => {
      const qty = Number(it.quantity ?? it.qty_sale ?? it.qty_base ?? 1);
      const up = Number(it.unit_price ?? 0);
      return sum + qty * up;
    }, 0);

    const activePromos = this.listActivePromotions();

    const result = cartItems.map((item) => {
      const product = item.product || item;
      const quantity = Number(item.quantity ?? item.qty_sale ?? item.qty_base ?? 1);
      const unitPrice = Number(item.unit_price ?? product.sale_price ?? 0);
      const lineSubtotal = quantity * unitPrice;

      let bestPromo = null;
      let bestDiscount = 0;
      let bestFinalPrice = unitPrice;

      for (const promo of activePromos) {
        if (!this._productMatchesScope(product, promo)) continue;
        if (!this._conditionsMet(promo, quantity, lineSubtotal, cartSubtotal, promoCode)) continue;

        const { discountAmount, finalUnitPrice } = this._computeDiscount(
          promo,
          promo.type,
          unitPrice,
          quantity,
          lineSubtotal
        );

        if (discountAmount > bestDiscount) {
          bestDiscount = discountAmount;
          bestPromo = promo;
          bestFinalPrice = finalUnitPrice;
        }
      }

      if (bestPromo) {
        return {
          ...item,
          unit_price: bestFinalPrice,
          discount_amount: bestDiscount,
          subtotal: lineSubtotal,
          total: lineSubtotal - bestDiscount,
          price_source: 'promo',
          promotion_id: bestPromo.id,
          promotion_name: bestPromo.name,
        };
      }

      return {
        ...item,
        unit_price: unitPrice,
        discount_amount: item.discount_amount ?? 0,
        subtotal: lineSubtotal,
        total: lineSubtotal - (item.discount_amount ?? 0),
        promotion_id: null,
        promotion_name: null,
      };
    });

    return result;
  }

  /**
   * Record promotion usage when order is completed
   */
  recordUsage(promotionId, orderId, orderItemId, discountAmount) {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO promotion_usage (id, promotion_id, order_id, order_item_id, discount_amount, applied_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `
      )
      .run(id, promotionId, orderId, orderItemId, discountAmount);
  }

  /**
   * Update promotion status
   */
  setStatus(promotionId, status, userId = null) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      UPDATE promotions SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?
    `
      )
      .run(status, userId, now, promotionId);
  }

  /**
   * Audit log entry
   */
  audit(promotionId, action, beforeJson, afterJson, userId) {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO promotion_audit (id, promotion_id, action, before_json, after_json, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `
      )
      .run(id, promotionId, action, beforeJson || null, afterJson || null, userId || null);
  }

  // --- CRUD / Admin (used by IPC, avoids requiring ESM promotions.repo) ---

  listPromotionsWithStats(params = {}) {
    const { status, type, storeId, limit = 500, offset = 0 } = params;
    let query = `
      SELECT p.*, ps.scope_type, ps.scope_ids,
             (SELECT COUNT(*) FROM promotion_usage WHERE promotion_id = p.id) as usage_count,
             (SELECT COALESCE(SUM(discount_amount), 0) FROM promotion_usage WHERE promotion_id = p.id) as total_discount
      FROM promotions p
      LEFT JOIN promotion_scope ps ON ps.promotion_id = p.id
      WHERE 1=1
    `;
    const values = [];
    if (status) {
      query += ' AND p.status = ?';
      values.push(status);
    }
    if (type) {
      query += ' AND p.type = ?';
      values.push(type);
    }
    if (storeId) {
      query += ' AND (p.store_id IS NULL OR p.store_id = ?)';
      values.push(storeId);
    }
    query += ' ORDER BY p.priority DESC, p.created_at DESC LIMIT ? OFFSET ?';
    values.push(limit, offset);
    const rows = this.db.prepare(query).all(...values);
    return rows.map((row) => {
      const { scope_type, scope_ids, usage_count, total_discount, ...p } = row;
      return {
        ...p,
        scope: scope_type != null ? { scope_type, scope_ids } : null,
        usage_count: Number(usage_count ?? 0),
        total_discount: Number(total_discount ?? 0),
      };
    });
  }

  getPromotionById(id) {
    const row = this.db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    return row || null;
  }

  getPromotionScope(promotionId) {
    const row = this.db.prepare('SELECT * FROM promotion_scope WHERE promotion_id = ?').get(promotionId);
    return row || null;
  }

  getPromotionCondition(promotionId) {
    const row = this.db.prepare('SELECT * FROM promotion_condition WHERE promotion_id = ?').get(promotionId);
    return row || null;
  }

  getPromotionReward(promotionId) {
    const row = this.db.prepare('SELECT * FROM promotion_reward WHERE promotion_id = ?').get(promotionId);
    return row || null;
  }

  getPromotionUsageCount(promotionId) {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM promotion_usage WHERE promotion_id = ?')
      .get(promotionId);
    return Number(row?.cnt ?? 0);
  }

  getPromotionTotalDiscount(promotionId) {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(discount_amount), 0) as total FROM promotion_usage WHERE promotion_id = ?')
      .get(promotionId);
    return Number(row?.total ?? 0);
  }

  createPromotion(payload) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      INSERT INTO promotions (id, name, code, description, type, status, store_id, start_at, end_at, priority, combinable, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        payload.name ?? null,
        payload.code ?? null,
        payload.description ?? null,
        payload.type,
        payload.status ?? 'draft',
        payload.store_id ?? null,
        payload.start_at,
        payload.end_at,
        payload.priority ?? 0,
        payload.combinable ? 1 : 0,
        payload.created_by ?? null,
        now,
        now
      );
    if (payload.scope) {
      const scopeId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO promotion_scope (id, promotion_id, scope_type, scope_ids) VALUES (?, ?, ?, ?)'
        )
        .run(scopeId, id, payload.scope.scope_type, payload.scope.scope_ids ?? null);
    }
    if (payload.condition) {
      const condId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO promotion_condition (id, promotion_id, min_qty, min_amount, promo_code) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          condId,
          id,
          payload.condition.min_qty ?? null,
          payload.condition.min_amount ?? null,
          payload.condition.promo_code ?? null
        );
    }
    if (payload.reward) {
      const rewardId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO promotion_reward (id, promotion_id, discount_percent, discount_amount, fixed_price) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          rewardId,
          id,
          payload.reward.discount_percent ?? null,
          payload.reward.discount_amount ?? null,
          payload.reward.fixed_price ?? null
        );
    }
    return this.getPromotionById(id);
  }

  updatePromotion(payload) {
    const existing = this.getPromotionById(payload.id);
    if (!existing) throw new Error(`Promotion ${payload.id} not found`);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      UPDATE promotions SET
        name = ?, code = ?, description = ?, type = ?, status = ?, store_id = ?,
        start_at = ?, end_at = ?, priority = ?, combinable = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `
      )
      .run(
        payload.name ?? existing.name,
        payload.code !== undefined ? payload.code : existing.code,
        payload.description !== undefined ? payload.description : existing.description,
        payload.type ?? existing.type,
        payload.status ?? existing.status,
        payload.store_id !== undefined ? payload.store_id : existing.store_id,
        payload.start_at ?? existing.start_at,
        payload.end_at ?? existing.end_at,
        payload.priority ?? existing.priority,
        (payload.combinable !== undefined ? payload.combinable : existing.combinable) ? 1 : 0,
        payload.updated_by ?? null,
        now,
        payload.id
      );
    if (payload.scope) {
      this.db.prepare('DELETE FROM promotion_scope WHERE promotion_id = ?').run(payload.id);
      const scopeId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO promotion_scope (id, promotion_id, scope_type, scope_ids) VALUES (?, ?, ?, ?)'
        )
        .run(scopeId, payload.id, payload.scope.scope_type, payload.scope.scope_ids ?? null);
    }
    if (payload.condition) {
      this.db.prepare('DELETE FROM promotion_condition WHERE promotion_id = ?').run(payload.id);
      const condId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO promotion_condition (id, promotion_id, min_qty, min_amount, promo_code) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          condId,
          payload.id,
          payload.condition.min_qty ?? null,
          payload.condition.min_amount ?? null,
          payload.condition.promo_code ?? null
        );
    }
    if (payload.reward) {
      this.db.prepare('DELETE FROM promotion_reward WHERE promotion_id = ?').run(payload.id);
      const rewardId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO promotion_reward (id, promotion_id, discount_percent, discount_amount, fixed_price) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          rewardId,
          payload.id,
          payload.reward.discount_percent ?? null,
          payload.reward.discount_amount ?? null,
          payload.reward.fixed_price ?? null
        );
    }
    return this.getPromotionById(payload.id);
  }

  deletePromotion(id) {
    const run = this.db.transaction(() => {
      // Must run before deleting promotions row: FK has no ON DELETE CASCADE in schema
      this.db.prepare('DELETE FROM promotion_usage WHERE promotion_id = ?').run(id);
      this.db.prepare('DELETE FROM promotion_audit WHERE promotion_id = ?').run(id);
      // Historical line items may still reference this promo (column has no FK)
      try {
        this.db.prepare('UPDATE order_items SET promotion_id = NULL WHERE promotion_id = ?').run(id);
      } catch {
        // order_items.promotion_id may be absent on very old DBs
      }
      this.db.prepare('DELETE FROM promotion_scope WHERE promotion_id = ?').run(id);
      this.db.prepare('DELETE FROM promotion_condition WHERE promotion_id = ?').run(id);
      this.db.prepare('DELETE FROM promotion_reward WHERE promotion_id = ?').run(id);
      const result = this.db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
      if (result.changes === 0) throw new Error(`Promotion ${id} not found`);
    });
    run();
  }
}

module.exports = PromotionService;
