import { describe, it, expect } from 'vitest';
import { formatUnit } from '../formatters';

describe('formatUnit', () => {
  it('should convert "pcs" to "dona"', () => {
    expect(formatUnit('pcs')).toBe('dona');
  });

  it('should return other units as-is', () => {
    expect(formatUnit('kg')).toBe('kg');
    expect(formatUnit('litr')).toBe('litr');
    expect(formatUnit('m')).toBe('m');
  });

  it('should handle empty string', () => {
    expect(formatUnit('')).toBe('');
  });

  it('should handle undefined', () => {
    expect(formatUnit(undefined)).toBe('');
  });

  it('should handle null', () => {
    expect(formatUnit(null as unknown as string)).toBe('');
  });

  it('should be case-sensitive for "pcs"', () => {
    expect(formatUnit('PCS')).toBe('PCS'); // Not converted, case-sensitive
    expect(formatUnit('Pcs')).toBe('Pcs');
  });
});






