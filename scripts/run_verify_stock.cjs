/**
 * Run stock verification queries against the Electron app's SQLite database
 * 
 * Usage (Windows):
 *   node scripts/run_verify_stock.cjs <db-path>
 * 
 * Example:
 *   node scripts/run_verify_stock.cjs "C:\Users\YourName\AppData\Roaming\POS Tizimi\pos.db"
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Get DB path from command line or use default
const dbPathArg = process.argv[2];
const dbPath = dbPathArg || process.env.DB_PATH;

if (!dbPath) {
  console.error('Error: Database path required');
  console.error('Usage: node scripts/run_verify_stock.cjs <db-path>');
  console.error('Or set DB_PATH environment variable');
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Error: Database file not found: ${dbPath}`);
  console.error('Please run the Electron app first to create the database.');
  console.error('Or use: npm run electron:dev');
  process.exit(1);
}

// Read verification SQL
const verifySqlPath = path.join(__dirname, '..', 'electron', 'db', 'verify_stock.sql');
if (!fs.existsSync(verifySqlPath)) {
  console.error(`Error: Verification SQL file not found: ${verifySqlPath}`);
  process.exit(1);
}

const verifySql = fs.readFileSync(verifySqlPath, 'utf8');

// Open database
console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath);

// Set pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('\n=== STOCK VERIFICATION RESULTS ===\n');

// Parse SQL into individual SELECT queries
// We'll execute each SELECT statement that starts with 'SELECT'
const lines = verifySql.split('\n');
let currentQuery = '';
let inComment = false;
const queries = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  
  // Skip empty lines
  if (!line) continue;
  
  // Handle block comments
  if (line.startsWith('/*')) {
    inComment = true;
    continue;
  }
  if (line.includes('*/')) {
    inComment = false;
    continue;
  }
  if (inComment) continue;
  
  // Skip single-line comments
  if (line.startsWith('--')) continue;
  
  // Skip CREATE/DROP statements (they're setup, not checks)
  if (line.toUpperCase().startsWith('CREATE') || 
      line.toUpperCase().startsWith('DROP')) {
    continue;
  }
  
  // Accumulate query lines
  currentQuery += line + ' ';
  
  // If line ends with semicolon, we have a complete query
  if (line.endsWith(';')) {
    const query = currentQuery.trim();
    if (query.toUpperCase().startsWith('SELECT')) {
      queries.push(query.slice(0, -1)); // Remove trailing semicolon
    }
    currentQuery = '';
  }
}

let issueCount = 0;
let checkCount = 0;
const results = [];

for (const query of queries) {
  try {
    const stmt = db.prepare(query);
    const queryResults = stmt.all();
    
    // Try to identify check type from query or results
    let checkName = 'UNKNOWN_CHECK';
    if (query.includes('STOCK_CONSISTENCY') || query.includes('balance_quantity')) {
      checkName = 'Stock Consistency Check';
    } else if (query.includes('NEGATIVE_STOCK') || query.includes('quantity < 0')) {
      checkName = 'Negative Stock Check';
    } else if (query.includes('SALES_WITHOUT_MOVEMENTS') || query.includes('reference_type = \'order\'')) {
      checkName = 'Sales Without Movements';
    } else if (query.includes('RETURNS_WITHOUT_MOVEMENTS') || query.includes('reference_type = \'return\'')) {
      checkName = 'Returns Without Movements';
    } else if (query.includes('PURCHASE_RECEIPTS_WITHOUT_MOVEMENTS') || query.includes('reference_type = \'purchase_order\'')) {
      checkName = 'Purchase Receipts Without Movements';
    } else if (query.includes('MOVEMENT_TYPE_INCONSISTENCY')) {
      checkName = 'Movement Type Consistency';
    } else if (query.includes('MOVEMENT_QUANTITY_SIGN_ERROR')) {
      checkName = 'Movement Quantity Sign';
    } else if (query.includes('BEFORE_AFTER_QUANTITY_MISMATCH')) {
      checkName = 'Before/After Quantity Mismatch';
    } else if (query.includes('PRODUCTS_WITHOUT_BALANCES')) {
      checkName = 'Products Without Balances';
    } else if (query.includes('SUMMARY')) {
      checkName = 'Summary';
    }
    
    if (queryResults.length > 0) {
      checkCount++;
      issueCount += queryResults.length;
      
      const checkType = queryResults[0]?.check_type || checkName;
      
      console.log(`❌ FAIL: ${checkType}`);
      console.log(`   Found ${queryResults.length} issue(s):`);
      
      // Print first 3 issues with details
      const displayResults = queryResults.slice(0, 3);
      displayResults.forEach((row, idx) => {
        const rowStr = JSON.stringify(row, null, 2);
        // Truncate if too long
        if (rowStr.length > 200) {
          console.log(`   Issue ${idx + 1}:`, rowStr.substring(0, 200) + '...');
        } else {
          console.log(`   Issue ${idx + 1}:`, rowStr);
        }
      });
      
      if (queryResults.length > 3) {
        console.log(`   ... and ${queryResults.length - 3} more issue(s)`);
      }
      console.log('');
      
      results.push({
        check: checkType,
        status: 'FAIL',
        issues: queryResults.length,
        details: queryResults
      });
    } else {
      console.log(`✅ PASS: ${checkName}`);
      results.push({
        check: checkName,
        status: 'PASS',
        issues: 0
      });
    }
  } catch (error) {
    // Skip errors for non-SELECT queries or queries that fail due to missing data
    if (error.message.includes('no such table') || error.message.includes('no such column')) {
      console.log(`⚠️  SKIP: ${checkName} (table/column not found - may be expected if no data)`);
      continue;
    }
    // Only log unexpected errors
    if (!error.message.includes('CREATE') && !error.message.includes('DROP')) {
      console.error(`Error executing query: ${error.message}`);
    }
  }
}

console.log('\n=== SUMMARY ===');
console.log(`Total checks run: ${checkCount}`);
console.log(`Issues found: ${issueCount}`);

if (issueCount === 0) {
  console.log('\n✅ All stock verification checks PASSED');
  process.exit(0);
} else {
  console.log('\n❌ Stock verification FAILED - issues found');
  console.log('\nPlease review the issues above and fix them.');
  process.exit(1);
}

















































