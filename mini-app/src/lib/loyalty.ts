import { apiFetch } from './api';

export type LoyaltyTier = {
  current: { key: string; name: string; emoji: string; color: string; min: number };
  next: { key: string; name: string; emoji: string; color: string; min: number } | null;
  points_to_next: number;
  progress_pct: number;
};

export type LoyaltyLedgerRow = {
  type: string;
  points_delta: number;
  order_id: number | null;
  note: string | null;
  created_at: string;
};

export type LoyaltyState = {
  ok: true;
  points_balance: number;
  card_code: string | null;
  qr_payload: string | null;
  tier: LoyaltyTier;
  stats: {
    earned_total: number;
    earned_this_month: number;
    total_orders: number;
    total_spent: number;
    first_order_date: string | null;
  };
  ledger: LoyaltyLedgerRow[];
};

export type Badge = {
  key: string;
  emoji: string;
  label: string;
  earned: boolean;
  hint?: string;
};

/**
 * Compute the user's badge wall from raw loyalty + order stats.
 * Pure function so we can also use it for analytics later.
 */
export function computeBadges(state: LoyaltyState): Badge[] {
  const totalOrders = state.stats.total_orders;
  const totalSpent = state.stats.total_spent;
  const earnedTotal = state.stats.earned_total;
  const firstDate = state.stats.first_order_date
    ? new Date(state.stats.first_order_date)
    : null;
  const monthsSinceFirst = firstDate
    ? Math.max(0, (Date.now() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
    : 0;

  return [
    {
      key: 'first_order',
      emoji: '🎉',
      label: 'Birinchi xarid',
      earned: totalOrders >= 1,
      hint: '1 ta buyurtma',
    },
    {
      key: 'loyal_5',
      emoji: '🛒',
      label: 'Doimiy mijoz',
      earned: totalOrders >= 5,
      hint: '5 ta buyurtma',
    },
    {
      key: 'loyal_10',
      emoji: '⭐',
      label: '10 buyurtma',
      earned: totalOrders >= 10,
      hint: '10 ta buyurtma',
    },
    {
      key: 'big_spender',
      emoji: '💎',
      label: 'Katta xaridor',
      earned: totalSpent >= 1_000_000,
      hint: '1 mln+ soʻm',
    },
    {
      key: 'collector',
      emoji: '✦',
      label: 'Ball yigʻuvchi',
      earned: earnedTotal >= 500,
      hint: '500+ ball',
    },
    {
      key: 'veteran',
      emoji: '🏆',
      label: '1 yil bilan',
      earned: monthsSinceFirst >= 12,
      hint: '12+ oy',
    },
  ];
}

export type PromoPreview = {
  ok: true;
  code: string;
  discount: number;
  type: 'percent' | 'amount';
  percent: number | null;
  amount: number | null;
  new_total: number;
};

export async function fetchLoyalty(): Promise<LoyaltyState | null> {
  try {
    const r = await apiFetch('/v1/me/loyalty');
    if (!r.ok) return null;
    return (await r.json()) as LoyaltyState;
  } catch {
    return null;
  }
}

export type PromoError =
  | { ok: false; reason: 'invalid_code' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'min_subtotal_not_met'; min_subtotal: number }
  | { ok: false; reason: 'network' };

/**
 * Back-in-stock subscription helpers. Each user gets at most one row
 * per product server-side; subscribing again is a no-op.
 */
export async function getBackInStock(productId: string): Promise<boolean> {
  try {
    const r = await apiFetch(`/v1/me/back-in-stock/${encodeURIComponent(productId)}`);
    if (!r.ok) return false;
    const j = (await r.json()) as { subscribed?: boolean };
    return !!j.subscribed;
  } catch {
    return false;
  }
}

export async function subscribeBackInStock(productId: string): Promise<boolean> {
  try {
    const r = await apiFetch(`/v1/me/back-in-stock/${encodeURIComponent(productId)}`, {
      method: 'POST',
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeBackInStock(productId: string): Promise<boolean> {
  try {
    const r = await apiFetch(`/v1/me/back-in-stock/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function previewPromo(
  code: string,
  subtotal: number,
): Promise<PromoPreview | PromoError> {
  try {
    const r = await apiFetch('/v1/me/promo/preview', {
      method: 'POST',
      body: JSON.stringify({ code, subtotal }),
    });
    if (r.ok) {
      return (await r.json()) as PromoPreview;
    }
    const j = await r.json().catch(() => ({}) as Record<string, unknown>);
    const err = String((j as Record<string, unknown>).error || '');
    if (err === 'not_found') return { ok: false, reason: 'not_found' };
    if (err === 'expired') return { ok: false, reason: 'expired' };
    if (err === 'min_subtotal_not_met') {
      return {
        ok: false,
        reason: 'min_subtotal_not_met',
        min_subtotal: Number((j as Record<string, unknown>).min_subtotal || 0),
      };
    }
    return { ok: false, reason: 'invalid_code' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
