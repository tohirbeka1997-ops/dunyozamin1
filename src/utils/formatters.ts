/**
 * Format unit for display
 * Converts internal unit values to localized display values
 */
export function formatUnit(unit?: string): string {
  if (!unit) return '';
  switch (unit) {
    case 'pcs':
      return 'Dona';
    case 'kg':
      return 'Kg';
    case 'l':
    case 'L':
      return 'Litr';
    case 'ml':
    case 'mL':
      return 'Millilitr';
    case 'g':
      return 'Gramm';
    case 'm':
      return 'Metr';
    case 'sqm':
      return 'Kv.m';
    case 'box':
      return 'Quti';
    case 'roll':
      return 'Rulon';
    case 'bag':
      return 'Xalta';
    case 'set':
      return 'Komplekt';
    default:
      // For legacy/custom units, show as-is.
      return unit;
  }
}

