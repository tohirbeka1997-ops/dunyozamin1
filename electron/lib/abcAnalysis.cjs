'use strict';

/**
 * ABC tahlil: mahsulotlarni sotuv summasi bo‘yicha tartiblab,
 * kumulativ ulushga qarab A / B / C sinflarga ajratadi.
 *
 * Qoida (oldingi kumulativ):
 * - A: prevCum < aThreshold (default 80%)
 * - B: prevCum < bThreshold (default 95%)
 * - C: qolganlari
 *
 * Shunda 80% chegarasini kesib o‘tgan birinchi mahsulot ham A da qoladi.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * @param {Array<{ sales_amount?: number, [key: string]: any }>} items
 * @param {{ a_threshold?: number, b_threshold?: number }} [opts]
 * @returns {{
 *   rows: Array,
 *   summary: {
 *     total_revenue: number,
 *     a: { count: number, revenue: number, revenue_share_pct: number },
 *     b: { count: number, revenue: number, revenue_share_pct: number },
 *     c: { count: number, revenue: number, revenue_share_pct: number },
 *   },
 *   thresholds: { a: number, b: number }
 * }}
 */
function classifyAbcRows(items, opts = {}) {
  const aThreshold = Number.isFinite(Number(opts.a_threshold)) ? Number(opts.a_threshold) : 80;
  const bThreshold = Number.isFinite(Number(opts.b_threshold)) ? Number(opts.b_threshold) : 95;

  const sorted = (Array.isArray(items) ? items : [])
    .map((r) => ({ ...r, sales_amount: Number(r.sales_amount || 0) || 0 }))
    .filter((r) => r.sales_amount > 0)
    .sort((a, b) => {
      const d = b.sales_amount - a.sales_amount;
      if (d !== 0) return d;
      return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'uz');
    });

  const total = sorted.reduce((s, r) => s + r.sales_amount, 0);
  let prevCum = 0;

  const rows = sorted.map((r, idx) => {
    const sharePct = total > 0 ? (r.sales_amount / total) * 100 : 0;
    const cumPct = prevCum + sharePct;
    let abc_class = 'C';
    if (prevCum < aThreshold) abc_class = 'A';
    else if (prevCum < bThreshold) abc_class = 'B';
    prevCum = cumPct;
    return {
      ...r,
      rank: idx + 1,
      share_pct: round2(sharePct),
      cumulative_pct: round2(cumPct),
      abc_class,
    };
  });

  const bucket = (cls) => {
    const list = rows.filter((x) => x.abc_class === cls);
    const revenue = list.reduce((s, x) => s + Number(x.sales_amount || 0), 0);
    return {
      count: list.length,
      revenue,
      revenue_share_pct: round2(total > 0 ? (revenue / total) * 100 : 0),
    };
  };

  return {
    rows,
    summary: {
      total_revenue: total,
      a: bucket('A'),
      b: bucket('B'),
      c: bucket('C'),
    },
    thresholds: { a: aThreshold, b: bThreshold },
  };
}

module.exports = {
  classifyAbcRows,
  round2,
};
