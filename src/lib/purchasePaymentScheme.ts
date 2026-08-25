export type PoPaymentScheme = 'full' | 'partial' | 'installment';

export type PoScheduleRow = {
  seq: number;
  due_date: string;
  amount: number;
  amount_usd?: number | null;
};

export function normalizePaymentScheme(value: unknown): PoPaymentScheme {
  const s = String(value || 'full').toLowerCase();
  if (s === 'partial' || s === 'installment') return s;
  return 'full';
}

export function normalizeDueDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function scheduleTolerance(currency: 'UZS' | 'USD'): number {
  return currency === 'USD' ? 0.02 : 1;
}

export function validateInstallmentScheduleSum(
  rows: PoScheduleRow[],
  total: number,
  currency: 'UZS' | 'USD'
): { ok: boolean; sum: number; error?: string } {
  const tol = scheduleTolerance(currency);
  const sum = rows.reduce((acc, row) => {
    const amt =
      currency === 'USD'
        ? Number(row.amount_usd ?? row.amount ?? 0)
        : Number(row.amount ?? 0);
    return acc + (Number.isFinite(amt) ? amt : 0);
  }, 0);
  if (Math.abs(sum - total) > tol) {
    return {
      ok: false,
      sum,
      error: `Bo'lib to'lash jami ${total.toLocaleString('uz-UZ')} bo'lishi kerak (hozir ${sum.toLocaleString('uz-UZ')})`,
    };
  }
  return { ok: true, sum };
}

export function computeSchemeSummary({
  scheme,
  total,
  payNow,
  dueDate,
  currency,
}: {
  scheme: PoPaymentScheme;
  total: number;
  payNow: number;
  dueDate: string | null;
  currency: 'UZS' | 'USD';
}): { payNow: number; debt: number; dueDate: string | null } {
  const paid = Math.max(0, Number(payNow) || 0);
  if (scheme === 'full') {
    return { payNow: paid, debt: Math.max(0, total - paid), dueDate: null };
  }
  if (scheme === 'partial') {
    return { payNow: paid, debt: Math.max(0, total - paid), dueDate };
  }
  return { payNow: paid, debt: Math.max(0, total - paid), dueDate };
}

export function dueStatusLabel(dueDate: string | null, today: string): 'Bugun' | "O'tgan" | 'Kelyapti' | '—' {
  const d = normalizeDueDate(dueDate);
  if (!d) return '—';
  if (d < today) return "O'tgan";
  if (d === today) return 'Bugun';
  return 'Kelyapti';
}
