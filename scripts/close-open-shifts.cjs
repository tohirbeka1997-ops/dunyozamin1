/**
 * Emergency script to close all open shifts
 * Run this if shifts are stuck in 'open' status
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Get database path
const userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'miaoda-react-admin');
const dbPath = path.join(userDataPath, 'pos.db');

console.log('📂 Database path:', dbPath);

try {
  const db = new Database(dbPath);
  
  // Get all open shifts
  const openShifts = db.prepare(`
    SELECT id, shift_number, cashier_id, opened_at, opening_cash 
    FROM shifts 
    WHERE status = 'open' AND closed_at IS NULL
  `).all();
  
  console.log(`\n📊 Found ${openShifts.length} open shift(s):\n`);
  
  if (openShifts.length === 0) {
    console.log('✅ No open shifts found. All good!');
    db.close();
    process.exit(0);
  }
  
  openShifts.forEach((shift, index) => {
    console.log(`${index + 1}. Shift ID: ${shift.id}`);
    console.log(`   Number: ${shift.shift_number}`);
    console.log(`   Cashier: ${shift.cashier_id}`);
    console.log(`   Opened: ${shift.opened_at}`);
    console.log(`   Opening Cash: ${shift.opening_cash}`);
    console.log('');
  });
  
  // Close all open shifts
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE shifts 
    SET 
      status = 'closed',
      closed_at = ?,
      closing_cash = opening_cash,
      expected_cash = opening_cash,
      cash_difference = 0
    WHERE status = 'open' AND closed_at IS NULL
  `).run(now);
  
  console.log(`✅ Closed ${result.changes} shift(s)`);
  
  // Clear users.current_shift_id
  const usersResult = db.prepare(`
    UPDATE users 
    SET current_shift_id = NULL 
    WHERE current_shift_id IS NOT NULL
  `).run();
  
  console.log(`✅ Cleared current_shift_id for ${usersResult.changes} user(s)`);
  
  db.close();
  console.log('\n✅ Done! You can now open a new shift.');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
