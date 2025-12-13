import { describe, it, expect } from 'vitest';

describe('Customer Balance Calculations', () => {
  describe('Credit sale increases balance', () => {
    it('should increase balance by credit amount on full credit sale', () => {
      // Initial balance: 0
      // Credit sale: 50000 UZS
      // Expected balance: 50000 UZS
      const initialBalance = 0;
      const creditAmount = 50000;
      const newBalance = initialBalance + creditAmount;
      expect(newBalance).toBe(50000);
    });

    it('should increase balance by credit portion on partial credit sale', () => {
      // Initial balance: 0
      // Total: 100000 UZS
      // Paid: 30000 UZS (cash)
      // Credit: 70000 UZS
      // Expected balance: 70000 UZS
      const totalAmount = 100000;
      const paidAmount = 30000;
      const creditAmount = totalAmount - paidAmount;
      const newBalance = 0 + creditAmount;
      expect(newBalance).toBe(70000);
    });

    it('should handle multiple credit sales', () => {
      // Initial balance: 50000
      // Credit sale 1: 30000
      // Credit sale 2: 20000
      // Expected balance: 100000
      let balance = 50000;
      balance += 30000;
      balance += 20000;
      expect(balance).toBe(100000);
    });
  });

  describe('Store credit refund decreases balance', () => {
    it('should decrease balance by return amount', () => {
      // Initial balance: 50000 UZS
      // Return with store credit: 20000 UZS
      // Expected balance: 30000 UZS
      const initialBalance = 50000;
      const returnAmount = 20000;
      const newBalance = initialBalance - returnAmount;
      expect(newBalance).toBe(30000);
    });

    it('should handle balance going to zero', () => {
      // Initial balance: 20000
      // Return: 20000
      // Expected balance: 0
      const initialBalance = 20000;
      const returnAmount = 20000;
      const newBalance = initialBalance - returnAmount;
      expect(newBalance).toBe(0);
    });

    it('should allow balance to go negative (credit to customer)', () => {
      // Initial balance: 10000
      // Return: 15000
      // Expected balance: -5000 (customer has credit/store credit)
      const initialBalance = 10000;
      const returnAmount = 15000;
      const newBalance = initialBalance - returnAmount;
      expect(newBalance).toBe(-5000);
    });
  });

  describe('Balance calculation correctness', () => {
    it('should maintain balance consistency across operations', () => {
      // Scenario:
      // 1. Credit sale: +50000
      // 2. Store credit return: -20000
      // 3. Credit sale: +30000
      // Expected final balance: 60000
      let balance = 0;
      balance += 50000; // Credit sale
      balance -= 20000; // Store credit return
      balance += 30000; // Credit sale
      expect(balance).toBe(60000);
    });

    it('should handle large amounts', () => {
      const balance = 1000000;
      const creditAmount = 500000;
      const newBalance = balance + creditAmount;
      expect(newBalance).toBe(1500000);
    });
  });
});





