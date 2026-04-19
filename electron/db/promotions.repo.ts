import { randomUUID } from 'crypto';
import { getDb } from './index';
// @ts-ignore - Type import from outside electron dir
import type { Promotion, PromotionScope, PromotionCondition, PromotionReward } from '../../src/types/database';

export interface ListPromotionsParams {
  status?: string;
  type?: string;
  storeId?: string;
  limit?: number;
  offset?: number;
}

export interface CreatePromotionPayload {
  name: string;
  code?: string | null;
  description?: string | null;
  type: string;
  status?: string;
  store_id?: string | null;
  start_at: string;
  end_at: string;
  priority?: number;
  combinable?: number;
  created_by?: string | null;
  scope?: { scope_type: string; scope_ids?: string | null };
  condition?: { min_qty?: number | null; min_amount?: number | null; promo_code?: string | null };
  reward?: { discount_percent?: number | null; discount_amount?: number | null; fixed_price?: number | null };
}

export interface UpdatePromotionPayload extends Partial<CreatePromotionPayload> {
  id: string;
  updated_by?: string | null;
}

function rowToPromotion(row: any): Promotion {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    description: row.description ?? null,
    type: row.type,
    status: row.status,
    store_id: row.store_id ?? null,
    start_at: row.start_at,
    end_at: row.end_at,
    priority: Number(row.priority ?? 0),
    combinable: Number(row.combinable ?? 0),
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listPromotions(params: ListPromotionsParams = {}): Promotion[] {
  const db = getDb();
  const { status, type, storeId, limit = 500, offset = 0 } = params;

  let query = 'SELECT * FROM promotions WHERE 1=1';
  const values: any[] = [];

  if (status) {
    query += ' AND status = ?';
    values.push(status);
  }
  if (type) {
    query += ' AND type = ?';
    values.push(type);
  }
  if (storeId) {
    query += ' AND (store_id IS NULL OR store_id = ?)';
    values.push(storeId);
  }

  query += ' ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?';
  values.push(limit, offset);

  const rows = db.prepare(query).all(...values) as any[];
  return rows.map(rowToPromotion);
}

export function listPromotionsWithStats(params: ListPromotionsParams = {}): (Promotion & { usage_count: number; total_discount: number })[] {
  const list = listPromotions(params);
  const db = getDb();
  return list.map((p) => {
    const usageRow = db.prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(discount_amount), 0) as total FROM promotion_usage WHERE promotion_id = ?').get(p.id) as { cnt: number; total: number };
    return {
      ...p,
      usage_count: Number(usageRow?.cnt ?? 0),
      total_discount: Number(usageRow?.total ?? 0),
    };
  });
}

export function getPromotionById(id: string): Promotion | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) as any;
  return row ? rowToPromotion(row) : null;
}

export function getPromotionScope(promotionId: string): PromotionScope | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM promotion_scope WHERE promotion_id = ?').get(promotionId) as any;
  return row || null;
}

export function getPromotionCondition(promotionId: string): PromotionCondition | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM promotion_condition WHERE promotion_id = ?').get(promotionId) as any;
  return row || null;
}

export function getPromotionReward(promotionId: string): PromotionReward | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM promotion_reward WHERE promotion_id = ?').get(promotionId) as any;
  return row || null;
}

export function createPromotion(payload: CreatePromotionPayload): Promotion {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO promotions (id, name, code, description, type, status, store_id, start_at, end_at, priority, combinable, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.name,
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
    now,
  );

  if (payload.scope) {
    const scopeId = randomUUID();
    db.prepare(`
      INSERT INTO promotion_scope (id, promotion_id, scope_type, scope_ids)
      VALUES (?, ?, ?, ?)
    `).run(scopeId, id, payload.scope.scope_type, payload.scope.scope_ids ?? null);
  }

  if (payload.condition) {
    const condId = randomUUID();
    db.prepare(`
      INSERT INTO promotion_condition (id, promotion_id, min_qty, min_amount, promo_code)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      condId,
      id,
      payload.condition.min_qty ?? null,
      payload.condition.min_amount ?? null,
      payload.condition.promo_code ?? null,
    );
  }

  if (payload.reward) {
    const rewardId = randomUUID();
    db.prepare(`
      INSERT INTO promotion_reward (id, promotion_id, discount_percent, discount_amount, fixed_price)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      rewardId,
      id,
      payload.reward.discount_percent ?? null,
      payload.reward.discount_amount ?? null,
      payload.reward.fixed_price ?? null,
    );
  }

  return getPromotionById(id)!;
}

export function updatePromotion(payload: UpdatePromotionPayload): Promotion {
  const db = getDb();
  const existing = getPromotionById(payload.id);
  if (!existing) throw new Error(`Promotion ${payload.id} not found`);

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE promotions SET
      name = ?, code = ?, description = ?, type = ?, status = ?, store_id = ?,
      start_at = ?, end_at = ?, priority = ?, combinable = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(
    payload.name ?? existing.name,
    payload.code !== undefined ? payload.code : existing.code,
    payload.description !== undefined ? payload.description : existing.description,
    payload.type ?? existing.type,
    payload.status ?? existing.status,
    payload.store_id !== undefined ? payload.store_id : existing.store_id,
    payload.start_at ?? existing.start_at,
    payload.end_at ?? existing.end_at,
    payload.priority ?? existing.priority,
    payload.combinable ?? existing.combinable ? 1 : 0,
    payload.updated_by ?? null,
    now,
    payload.id,
  );

  if (payload.scope) {
    db.prepare('DELETE FROM promotion_scope WHERE promotion_id = ?').run(payload.id);
    const scopeId = randomUUID();
    db.prepare(`
      INSERT INTO promotion_scope (id, promotion_id, scope_type, scope_ids)
      VALUES (?, ?, ?, ?)
    `).run(scopeId, payload.id, payload.scope.scope_type, payload.scope.scope_ids ?? null);
  }

  if (payload.condition) {
    db.prepare('DELETE FROM promotion_condition WHERE promotion_id = ?').run(payload.id);
    const condId = randomUUID();
    db.prepare(`
      INSERT INTO promotion_condition (id, promotion_id, min_qty, min_amount, promo_code)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      condId,
      payload.id,
      payload.condition.min_qty ?? null,
      payload.condition.min_amount ?? null,
      payload.condition.promo_code ?? null,
    );
  }

  if (payload.reward) {
    db.prepare('DELETE FROM promotion_reward WHERE promotion_id = ?').run(payload.id);
    const rewardId = randomUUID();
    db.prepare(`
      INSERT INTO promotion_reward (id, promotion_id, discount_percent, discount_amount, fixed_price)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      rewardId,
      payload.id,
      payload.reward.discount_percent ?? null,
      payload.reward.discount_amount ?? null,
      payload.reward.fixed_price ?? null,
    );
  }

  return getPromotionById(payload.id)!;
}

export function deletePromotion(id: string): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM promotion_usage WHERE promotion_id = ?').run(id);
    db.prepare('DELETE FROM promotion_audit WHERE promotion_id = ?').run(id);
    try {
      db.prepare('UPDATE order_items SET promotion_id = NULL WHERE promotion_id = ?').run(id);
    } catch {
      /* ignore if column missing */
    }
    db.prepare('DELETE FROM promotion_scope WHERE promotion_id = ?').run(id);
    db.prepare('DELETE FROM promotion_condition WHERE promotion_id = ?').run(id);
    db.prepare('DELETE FROM promotion_reward WHERE promotion_id = ?').run(id);
    const result = db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`Promotion ${id} not found`);
  });
  run();
}

export function getPromotionUsageCount(promotionId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM promotion_usage WHERE promotion_id = ?'
  ).get(promotionId) as { cnt: number };
  return Number(row?.cnt ?? 0);
}

export function getPromotionTotalDiscount(promotionId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COALESCE(SUM(discount_amount), 0) as total FROM promotion_usage WHERE promotion_id = ?'
  ).get(promotionId) as { total: number };
  return Number(row?.total ?? 0);
}
