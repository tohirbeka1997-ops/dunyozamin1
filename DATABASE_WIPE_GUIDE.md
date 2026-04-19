# Database Wipe Guide

This guide explains how to completely wipe all transactional and master data from the SQLite database while preserving the users table.

## ⚠️ WARNING

**This is a DESTRUCTIVE operation!** All data will be permanently deleted except for:
- Users table (so you can still log in)
- Settings table (optional - preserved)
- Units table (optional - preserved)

## What Gets Deleted

### Transactional Data:
- Orders and order items
- Payments and receipts
- Sales returns
- Purchase orders and goods receipts
- Inventory movements and stock balances
- Cash movements
- Customer payments and ledger
- Expenses
- Held orders
- Shift totals

### Master Data:
- Products
- Categories
- Warehouses
- Shifts
- Suppliers
- Customers
- Expense categories

## What Gets Preserved

- **Users table** - You can still log in with admin@pos.com
- **Settings table** - Application settings remain
- **Units table** - Measurement units remain (optional)

## Methods to Wipe Database

### Method 1: Using IPC Handler (Recommended)

From the frontend, call the IPC handler:

```typescript
// In your React component or console
const result = await window.posApi.database.wipeAllData();
console.log('Wipe result:', result);
```

The app will automatically reload after the wipe completes.

### Method 2: Using Standalone Script

Run the standalone script:

```bash
node scripts/wipe_database.cjs
```

### Method 3: Using SQL Script Directly

The SQL script is located at:
```
electron/db/migrations/024_wipe_transactional_data.sql
```

You can execute it manually using any SQLite client or through the migration system.

## Implementation Details

### Service Method

The wipe operation is implemented in:
- `electron/services/databaseService.cjs` - `wipeAllData()` method

### IPC Handler

The IPC handler is registered in:
- `electron/ipc/index.cjs` - `pos:database:wipeAllData` handler

### Preload API

The frontend API is exposed in:
- `electron/preload.cjs` - `window.posApi.database.wipeAllData()`

## Verification

After wiping, you can verify the database is empty by checking counts:

```typescript
const counts = await window.posApi.debug.tableCounts();
console.log('Table counts:', counts);
```

Expected results:
- `products`: 0
- `categories`: 0
- `warehouses`: 0
- `shifts`: 0
- `customers`: 0
- `orders`: 0
- `users`: > 0 (at least admin user)

## Auto-Reload

After the wipe completes:
1. The app automatically reloads the window
2. All caches are invalidated
3. All lists will show "0" items

## Safety Features

1. **Transaction-based**: All deletions happen in a single transaction
2. **Rollback on error**: If any error occurs, all changes are rolled back
3. **User preservation**: Users table is never touched
4. **Verification**: Final counts are logged and returned

## Troubleshooting

### Error: "Database service not available"
- Ensure the app is fully initialized
- Check that services are properly registered

### Error: "Foreign key constraint failed"
- The script handles foreign keys by deleting in the correct order
- If you see this error, check the deletion order in `databaseService.cjs`

### Users table is empty
- This should not happen - users table is never deleted
- If it does, you'll need to recreate the admin user manually

## Notes

- The `sqlite_sequence` table is reset to ensure new IDs start from 1
- The operation is logged extensively in the console
- The wipe is synchronous and blocks until complete
- All foreign key constraints are respected

































