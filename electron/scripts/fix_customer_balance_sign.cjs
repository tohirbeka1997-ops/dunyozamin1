/**
 * Script: Fix Customer Balance Sign Logic
 * 
 * This script converts existing customer balances from the old format (positive = debt)
 * to the new format (negative = debt).
 * 
 * Run this script ONCE after deploying the balance logic fixes.
 * 
 * Usage:
 *   node electron/scripts/fix_customer_balance_sign.cjs
 * 
 * Or from Electron app:
 *   const fixBalance = require('./scripts/fix_customer_balance_sign.cjs');
 *   fixBalance(db);
 */

const path = require('path');
const Database = require('better-sqlite3');

function fixCustomerBalanceSign(db) {
  console.log('🔄 Starting: Fix Customer Balance Sign Logic');
  console.log('==========================================\n');
  
  try {
    // Get all customers with positive balance (old debt format)
    const customersWithDebt = db.prepare(`
      SELECT id, name, balance 
      FROM customers 
      WHERE balance > 0
    `).all();
    
    console.log(`📊 Found ${customersWithDebt.length} customers with positive balance (old debt format)\n`);
    
    if (customersWithDebt.length === 0) {
      console.log('✅ No customers to migrate. All balances are already correct.');
      return { updated: 0, skipped: 0 };
    }
    
    // Show preview
    console.log('Customers to update:');
    customersWithDebt.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.name}: ${c.balance} → ${-c.balance}`);
    });
    console.log('');
    
    // Flip positive balances to negative
    const updateStmt = db.prepare(`
      UPDATE customers 
      SET balance = -balance,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    
    let updated = 0;
    const transaction = db.transaction(() => {
      for (const customer of customersWithDebt) {
        const oldBalance = Number(customer.balance);
        const newBalance = -oldBalance;
        
        updateStmt.run(customer.id);
        updated++;
      }
    });
    
    transaction();
    
    console.log(`✅ Updated ${updated} customer balances\n`);
    
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
    
    // Show summary
    const negativeCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM customers 
      WHERE balance < 0
    `).get();
    
    const zeroCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM customers 
      WHERE balance = 0
    `).get();
    
    console.log('\n📊 Summary:');
    console.log(`  - Customers with debt (balance < 0): ${negativeCount.count}`);
    console.log(`  - Customers with zero balance: ${zeroCount.count}`);
    console.log(`  - Customers with prepaid (balance > 0): ${remainingPositive.count}`);
    
    return { updated, skipped: customersWithDebt.length - updated };
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// If run directly (not imported)
// NOTE: This script MUST be run via Electron (not system Node) to ensure
// better-sqlite3 ABI compatibility and to use the canonical database path.
// 
// Usage:
//   npx electron -e "const fix = require('./electron/scripts/fix_customer_balance_sign.cjs'); const { app } = require('electron'); const { getDbPath } = require('./electron/db/dbPath.cjs'); const Database = require('better-sqlite3'); const db = new Database(getDbPath(app)); fix(db); db.close();"
//
// Or use the npm script: npm run db:check
if (require.main === module) {
  // SECURITY: DB_PATH env var is IGNORED - must use canonical path
  // This script should only be run via Electron to ensure path security
  const { app } = require('electron');
  const { getDbPath, assertDbPathSafe } = require('../db/dbPath.cjs');
  
  if (!app) {
    console.error('');
    console.error('❌ ERROR: This script must be run via Electron (not system Node)');
    console.error('');
    console.error('Please use: npm run db:check');
    console.error('Or: npx electron -e "<code>"');
    console.error('');
    process.exit(1);
  }
  
  // Get canonical database path (inside userData)
  const dbPath = getDbPath(app);
  
  // Validate path is safe
  try {
    assertDbPathSafe(dbPath, app);
  } catch (error) {
    console.error('❌ SECURITY: Invalid database path');
    process.exit(1);
  }
  
  console.log(`Opening database: ${dbPath}\n`);
  
  const db = new Database(dbPath);
  
  try {
    fixCustomerBalanceSign(db);
    console.log('\n✅ Script completed successfully');
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

module.exports = fixCustomerBalanceSign;








