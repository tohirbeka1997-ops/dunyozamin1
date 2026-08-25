export interface AgingRow {
  id: string;
  name: string;
  phone?: string;
  settlement_currency?: string;
  ledger_currency?: string;
  total_debt: number;
  current: number;
  days_8_30: number;
  days_31_60: number;
  days_60_plus: number;
}

export type AgingBucketTotals = {
  total: number;
  current: number;
  days_8_30: number;
  days_31_60: number;
  days_60_plus: number;
};

export type AgingCurrencySplit = {
  uzs: AgingBucketTotals;
  usd: AgingBucketTotals;
};

function emptyBuckets(): AgingBucketTotals {
  return {
    total: 0,
    current: 0,
    days_8_30: 0,
    days_31_60: 0,
    days_60_plus: 0,
  };
}

function addRowToBucket(
  bucket: AgingBucketTotals,
  row: AgingRow
): void {
  bucket.total += Number(row.total_debt || 0);
  bucket.current += Number(row.current || 0);
  bucket.days_8_30 += Number(row.days_8_30 || 0);
  bucket.days_31_60 += Number(row.days_31_60 || 0);
  bucket.days_60_plus += Number(row.days_60_plus || 0);
}

export function rowBucketSum(row: AgingRow): number {
  return (
    Number(row.current || 0) +
    Number(row.days_8_30 || 0) +
    Number(row.days_31_60 || 0) +
    Number(row.days_60_plus || 0)
  );
}

export function sumCustomerBuckets(rows: AgingRow[]): AgingCurrencySplit {
  const uzs = emptyBuckets();
  const usd = emptyBuckets();
  for (const row of rows) {
    const cur = String(row.ledger_currency || 'UZS').toUpperCase() === 'USD' ? 'usd' : 'uzs';
    addRowToBucket(cur === 'usd' ? usd : uzs, row);
  }
  return { uzs, usd };
}

export function sumSupplierBuckets(rows: AgingRow[]): AgingCurrencySplit {
  const uzs = emptyBuckets();
  const usd = emptyBuckets();
  for (const row of rows) {
    const cur = String(row.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'usd' : 'uzs';
    addRowToBucket(cur === 'usd' ? usd : uzs, row);
  }
  return { uzs, usd };
}

/** Card bucket keys must match table column sums for the active tab. */
export function cardTotalsForTab(
  activeTab: 'customers' | 'suppliers',
  customerSplit: AgingCurrencySplit,
  supplierSplit: AgingCurrencySplit
): AgingCurrencySplit {
  return activeTab === 'customers' ? customerSplit : supplierSplit;
}

export function bucketPartsMatchTotal(totals: AgingBucketTotals, eps = 0.01): boolean {
  const parts =
    totals.current + totals.days_8_30 + totals.days_31_60 + totals.days_60_plus;
  return Math.abs(parts - totals.total) < eps;
}
