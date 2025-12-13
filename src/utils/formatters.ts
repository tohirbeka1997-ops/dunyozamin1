/**
 * Format unit for display
 * Converts internal unit values to localized display values
 */
export function formatUnit(unit?: string): string {
  if (!unit) return '';
  if (unit === 'pcs') return 'dona';
  return unit;
}

