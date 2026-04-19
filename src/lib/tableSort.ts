/** Jadval ustunlari bo‘yicha umumiy solishtirish (o‘sish / kamayish) */

export type TableSortOrder = 'asc' | 'desc';

export function compareScalar(
  a: string | number,
  b: string | number,
  order: TableSortOrder
): number {
  let cmp = 0;
  if (typeof a === 'string' && typeof b === 'string') {
    cmp = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  } else {
    cmp = Number(a) - Number(b);
  }
  return order === 'asc' ? cmp : -cmp;
}
