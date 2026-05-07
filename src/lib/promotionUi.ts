import type { PromotionStatus, PromotionType } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  draft: 'Qoralama',
  scheduled: 'Rejalashtirilgan',
  active: 'Faol',
  paused: "To'xtatilgan",
  expired: 'Muddati tugagan',
  archived: 'Arxiv',
  cancelled: 'Bekor qilingan',
};

export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  percent_discount: 'Foizli chegirma',
  amount_discount: 'Summali chegirma',
  fixed_price: 'Belgilangan narx',
};

/** Badge `variant="outline"` uchun Tailwind qo‘shimchalari */
export function promotionStatusBadgeClass(status: PromotionStatus): string {
  const map: Record<PromotionStatus, string> = {
    draft: 'border-muted-foreground/35 text-muted-foreground',
    scheduled: 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100',
    active: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100',
    paused: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100',
    expired: 'border-border text-muted-foreground',
    archived: 'border-border text-muted-foreground',
    cancelled: 'border-destructive/40 bg-destructive/5 text-destructive',
  };
  return map[status] ?? map.draft;
}

export type PromotionRewardLike = {
  discount_percent?: number | null;
  discount_amount?: number | null;
  fixed_price?: number | null;
} | null;

export function formatPromotionRewardShort(
  type: PromotionType,
  reward?: PromotionRewardLike
): string {
  if (!reward) return '—';
  if (type === 'percent_discount' && reward.discount_percent != null) {
    return `${Number(reward.discount_percent)}%`;
  }
  if (type === 'amount_discount' && reward.discount_amount != null) {
    return formatMoneyUZS(Number(reward.discount_amount));
  }
  if (type === 'fixed_price' && reward.fixed_price != null) {
    return formatMoneyUZS(Number(reward.fixed_price));
  }
  return '—';
}
