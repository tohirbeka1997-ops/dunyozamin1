import { describe, it, expect } from 'vitest';
import {
  calculateVAT,
  formatCurrency,
  formatNumber,
  parseCurrency,
  validatePaymentAmounts,
} from '../totals';

describe('calculateVAT', () => {
  it('should calculate VAT correctly with positive rate', () => {
    expect(calculateVAT(1000, 10)).toBe(100);
    expect(calculateVAT(1000, 20)).toBe(200);
    expect(calculateVAT(50000, 12)).toBe(6000);
  });

  it('should handle zero subtotal', () => {
    expect(calculateVAT(0, 10)).toBe(0);
  });

  it('should handle zero VAT rate', () => {
    expect(calculateVAT(1000, 0)).toBe(0);
  });

  it('should handle decimal VAT rates', () => {
    expect(calculateVAT(1000, 12.5)).toBe(125);
  });

  it('should handle large amounts', () => {
    expect(calculateVAT(1000000, 20)).toBe(200000);
  });
});

describe('formatCurrency', () => {
  it('should format currency with default UZS', () => {
    expect(formatCurrency(1000)).toBe("1.000 so'm");
    expect(formatCurrency(1234567.89)).toBe("1.234.568 so'm");
  });

  it('should format currency with custom currency', () => {
    // Deprecated signature: currency arg is ignored; always UZS in this POS
    expect(formatCurrency(1000, 'USD')).toBe("1.000 so'm");
  });

  it('should handle zero', () => {
    expect(formatCurrency(0)).toBe("0 so'm");
  });

  it('should handle negative amounts', () => {
    expect(formatCurrency(-1000)).toBe("-1.000 so'm");
  });

  it('should handle decimal amounts', () => {
    expect(formatCurrency(123.456)).toBe("123 so'm");
  });
});

describe('formatNumber', () => {
  it('should format number with dot thousand separators (no decimals)', () => {
    expect(formatNumber(1000)).toBe('1.000');
    expect(formatNumber(1234567.89)).toBe('1.234.568');
  });

  it('should handle zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('should handle negative numbers', () => {
    expect(formatNumber(-1000)).toBe('-1.000');
  });

  it('should round to whole numbers', () => {
    expect(formatNumber(123.456)).toBe('123');
    expect(formatNumber(123.454)).toBe('123');
  });
});

describe('parseCurrency', () => {
  it('should parse currency string to number', () => {
    expect(parseCurrency('1000')).toBe(1000);
    expect(parseCurrency('1,000')).toBe(1000);
    expect(parseCurrency('1.000')).toBe(1000);
    expect(parseCurrency("1.234.567 so'm")).toBe(1234567);
  });

  it('should handle empty string', () => {
    expect(parseCurrency('')).toBe(0);
  });

  it('should handle invalid input', () => {
    expect(parseCurrency('abc')).toBe(0);
    expect(parseCurrency('not a number')).toBe(0);
  });

  it('should handle negative amounts', () => {
    expect(parseCurrency('-1000')).toBe(-1000);
  });

  it('should handle decimal input', () => {
    // UZS rules: decimals are not used; separators are treated as thousands
    expect(parseCurrency('123.45')).toBe(12345);
  });
});

describe('validatePaymentAmounts', () => {
  it('should validate correct payment amounts', () => {
    const payments = [{ amount: 50000 }, { amount: 30000 }];
    const creditAmount = 20000;
    const totalDue = 100000;

    const result = validatePaymentAmounts(payments, creditAmount, totalDue);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject payment mismatch within tolerance', () => {
    const payments = [{ amount: 50000 }, { amount: 30000 }];
    const creditAmount = 20000;
    const totalDue = 100000.01; // 0.01 difference, within tolerance

    const result = validatePaymentAmounts(payments, creditAmount, totalDue);
    expect(result.valid).toBe(true);
  });

  it('should reject payment mismatch beyond tolerance', () => {
    const payments = [{ amount: 50000 }, { amount: 30000 }];
    const creditAmount = 20000;
    const totalDue = 100001; // 1 difference, beyond tolerance

    const result = validatePaymentAmounts(payments, creditAmount, totalDue);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Payment mismatch');
  });

  it('should handle zero payments', () => {
    const payments: Array<{ amount: number }> = [];
    const creditAmount = 0;
    const totalDue = 0;

    const result = validatePaymentAmounts(payments, creditAmount, totalDue);
    expect(result.valid).toBe(true);
  });

  it('should handle custom tolerance', () => {
    const payments = [{ amount: 50000 }];
    const creditAmount = 0;
    const totalDue = 50000.5; // 0.5 difference

    const result = validatePaymentAmounts(payments, creditAmount, totalDue, 1.0);
    expect(result.valid).toBe(true);
  });
});


































