/**
 * Migration: Fix Customer Balance Sign Logic
 * 
 * PROBLEM:
 * Previously, customer balance used positive values for debt:
 * - balance > 0 = customer owes money (debt)
 * - balance = 0 = no debt
 * 
 * NEW LOGIC:
 * - balance < 0 = customer owes money (debt)
 * - balance = 0 = settled
 * - balance > 0 = customer has prepaid balance
 * 
 * This migration flips all positive balances to negative:
 * - If balance > 0: new_balance = -old_balance
 * - If balance = 0: unchanged
 * - If balance < 0: unchanged (already correct)
 * 
 * Run this migration ONCE to convert existing data.
 */

const { randomUUID } = require('crypto');

module.exports = {
  name: '001_fix_customer_balance_sign',
  up: (db) => {
    console.log('🔄 Starting migration: Fix Customer Balance Sign Logic');
    
    try {
      // Get all customers with positive balance (old debt)
      const customersWithDebt = db.prepare(`
        SELECT id, name, balance 
        FROM customers 
        WHERE balance > 0
      `).all();
      
      console.log(`📊 Found ${customersWithDebt.length} customers with positive balance (old debt format)`);
      
      if (customersWithDebt.length === 0) {
        console.log('✅ No customers to migrate. All balances are already correct.');
        return;
      }
      
      // Flip positive balances to negative
      const updateStmt = db.prepare(`
        UPDATE customers 
        SET balance = -balance,
            updated_at = datetime('now')
        WHERE id = ?
      `);
      
      let updated = 0;
      for (const customer of customersWithDebt) {
        const oldBalance = Number(customer.balance);
        const newBalance = -oldBalance;
        
        updateStmt.run(customer.id);
        updated++;
        
        console.log(`  ✅ ${customer.name}: ${oldBalance} → ${newBalance}`);
      }
      
      console.log(`✅ Migration complete: Updated ${updated} customer balances`);
      
      // Verify migration
      const remainingPositive = db.prepare(`
        SELECT COUNT(*) as count 
        FROM customers 
        WHERE balance > 0
      `).get();
      
      if (remainingPositive.count > 0) {
        console.warn(`⚠️  Warning: ${remainingPositive.count} customers still have positive balance after migration`);
      } else {
        console.log('✅ Verification: All customer balances are now <= 0 (debt format)');
      }
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  },
  
  down: (db) => {
    // Rollback: flip negative balances back to positive
    console.log('🔄 Rolling back: Reverting Customer Balance Sign Logic');
    
    try {
      const customersWithDebt = db.prepare(`
        SELECT id, name, balance 
        FROM customers 
        WHERE balance < 0
      `).all();
      
      console.log(`📊 Found ${customersWithDebt.length} customers with negative balance`);
      
      if (customersWithDebt.length === 0) {
        console.log('✅ No customers to rollback.');
        return;
      }
      
      const updateStmt = db.prepare(`
        UPDATE customers 
        SET balance = -balance,
            updated_at = datetime('now')
        WHERE id = ?
      `);
      
      let updated = 0;
      for (const customer of customersWithDebt) {
        const oldBalance = Number(customer.balance);
        const newBalance = -oldBalance;
        
        updateStmt.run(customer.id);
        updated++;
        
        console.log(`  ✅ ${customer.name}: ${oldBalance} → ${newBalance}`);
      }
      
      console.log(`✅ Rollback complete: Updated ${updated} customer balances`);
      
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }
};











































