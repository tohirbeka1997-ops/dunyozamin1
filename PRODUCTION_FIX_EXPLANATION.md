# Production Database Fix - Complete Explanation

## Root Cause Analysis

### Why Yesterday's Data Disappeared

**The Problem:**
1. **Multiple Database Files**: The app was using different DB files:
   - `pos.db` (production)
   - `pos.dev.db` (development)
   - `pos.legacy.db` (migration artifact)
   
2. **WAL Mode Phantom Data**: WAL (Write-Ahead Logging) mode was enabled, which creates separate `-wal` and `-shm` files. When the app closed improperly or WAL files were lost/corrupted, data that existed in WAL files disappeared because it was never checkpointed to the main database file.

3. **Path Inconsistency**: 
   - Backend wrote to `pos.db`
   - Frontend sometimes read from `pos.dev.db`
   - Migrations ran on one file, services used another
   - Result: Data appeared to exist but wasn't actually in the active database

4. **Migration Conflicts**: Migrations were not idempotent, causing:
   - Duplicate column errors
   - Partial migrations
   - Inconsistent schema state

### Architectural Problems

1. **Dev/Prod Split**: Having separate DB files for dev/prod is dangerous in a desktop app because:
   - Users can accidentally use the wrong file
   - Data can be lost when switching between modes
   - No clear "source of truth"

2. **WAL Mode for Single-Writer**: WAL is designed for multi-writer scenarios. For a single-writer desktop app:
   - DELETE mode is safer and simpler
   - WAL files can be lost (not backed up)
   - Checkpointing can fail silently
   - Data appears in WAL but not in main DB

3. **No Single Source of Truth**: Multiple DB paths meant:
   - Services could read from one DB
   - IPC handlers could write to another
   - Migrations could run on a third
   - Result: Complete data inconsistency

## The Fix

### 1. Single Canonical Database Path

**Before:**
```javascript
// Different paths for dev/prod
const dbFileName = app.isPackaged ? 'pos.db' : 'pos.dev.db';
```

**After:**
```javascript
// ALWAYS pos.db (single source of truth)
cachedDbPath = path.join(userDataPath, 'pos.db');
```

**Why This Fixes It:**
- One database file = one source of truth
- No confusion about which file is active
- All reads and writes go to the same place

### 2. WAL Mode Disabled

**Before:**
```javascript
const USE_WAL_MODE = process.env.USE_WAL_MODE !== 'false'; // Default: true
db.pragma('journal_mode = WAL');
```

**After:**
```javascript
// ALWAYS DELETE mode
db.pragma('journal_mode = DELETE');
// Verify it's actually DELETE
if (journalMode !== 'delete') {
  console.error('🚨 CRITICAL: Journal mode is not DELETE!');
  db.pragma('journal_mode = DELETE'); // Force it
}
```

**Why This Fixes It:**
- DELETE mode writes directly to main DB file
- No WAL files to lose or corrupt
- Data is immediately persistent
- Simpler for single-writer desktop apps

### 3. Idempotent Migrations

**Before:**
```sql
-- Migration 022: Would fail if column exists
ALTER TABLE customer_ledger ADD COLUMN method TEXT;
```

**After:**
```javascript
// Check before adding
if (!hasColumn(db, 'customer_ledger', 'method')) {
  safeAddColumn(db, 'customer_ledger', 'method', 'TEXT');
}
```

**Why This Fixes It:**
- Migrations can be re-run safely
- No duplicate column errors
- Consistent schema state

### 4. Single DB Connection

**Before:**
- Multiple `new Database()` calls
- Different paths used in different places
- No connection reuse

**After:**
```javascript
let db = null; // Singleton

function getDb() {
  if (!db) {
    return open(); // Opens once, reuses connection
  }
  return db;
}
```

**Why This Fixes It:**
- All services use the same connection
- All operations on the same database
- No path confusion

## Recovery Plan

### If You Have Data in pos.legacy.db

1. **Check what you have:**
   ```bash
   npm run db:check:legacy
   ```

2. **Verify data exists:**
   ```bash
   npm run db:counts
   ```

3. **The app will automatically migrate from legacy on first run** if:
   - `pos.db` doesn't exist OR
   - `pos.db` exists but is empty (no products/categories)

4. **Manual migration (if needed):**
   ```bash
   npm run db:migrate:legacy
   ```

### If You Have Data in pos.dev.db

**WARNING**: The app no longer uses `pos.dev.db`. You must manually migrate:

1. **Backup pos.dev.db:**
   ```bash
   # Find location
   npm run db:where
   # Copy pos.dev.db to pos.legacy.db manually
   ```

2. **Rename pos.dev.db to pos.legacy.db:**
   ```bash
   # Windows PowerShell
   Copy-Item "$env:APPDATA\miaoda-react-admin\pos.dev.db" "$env:APPDATA\miaoda-react-admin\pos.legacy.db"
   ```

3. **Start the app** - it will migrate from `pos.legacy.db` automatically

### If You Have WAL Files (pos.db-wal, pos.dev.db-wal)

**CRITICAL**: WAL files contain uncommitted data. If you have WAL files:

1. **Check if WAL files exist:**
   ```bash
   # In userData directory
   dir *.db-wal
   ```

2. **If WAL files exist, checkpoint them:**
   ```bash
   # Using sqlite3 command-line tool
   sqlite3 pos.db "PRAGMA wal_checkpoint(FULL);"
   ```

3. **Then rename the DB to legacy:**
   ```bash
   # After checkpoint, rename to legacy
   Move-Item pos.db pos.legacy.db
   Move-Item pos.db-wal pos.legacy.db-wal
   Move-Item pos.db-shm pos.legacy.db-shm
   ```

4. **Start the app** - it will create new `pos.db` and migrate from legacy

### If You Lost Data Completely

1. **Check backups:**
   - Look for `pos.db.backup` files
   - Check Windows File History / Time Machine
   - Check cloud sync folders (if any)

2. **Check legacy files:**
   ```bash
   npm run db:check:legacy
   ```

3. **If no backups exist:**
   - Data is likely lost
   - Start fresh with new database
   - Consider implementing automatic backups

## Verification

After applying the fix, verify:

1. **Single DB path:**
   ```bash
   npm run db:where
   # Should show: .../pos.db (NOT pos.dev.db)
   ```

2. **WAL disabled:**
   ```bash
   npm run db:check
   # Should show: journal_mode: delete
   ```

3. **Migrations applied:**
   ```bash
   npm run db:check
   # Should list all migrations as applied
   ```

4. **Data consistency:**
   ```bash
   npm run db:counts
   # Should show consistent row counts
   ```

5. **Inventory works:**
   - Create a sale
   - Check stock decreases
   - Reload app
   - Stock should still be decreased

## Why This Architecture is Correct

1. **Single Source of Truth**: One database file eliminates confusion
2. **DELETE Mode**: Safer for single-writer, no WAL file corruption risk
3. **Idempotent Migrations**: Safe to re-run, consistent schema
4. **Fail-Fast Security**: App refuses to start with wrong paths
5. **Data Preservation**: Legacy migration preserves old data

## Prevention

1. **Never use pos.dev.db** - it's been removed from the codebase
2. **Never enable WAL mode** - DELETE mode is enforced
3. **Always use getDb()** - never create new Database() instances
4. **Run migrations on startup** - they're idempotent, safe to re-run
5. **Monitor logs** - check for migration errors or path violations

## Summary

**What Was Wrong:**
- Multiple DB files (pos.db, pos.dev.db)
- WAL mode causing phantom data
- Non-idempotent migrations
- Path inconsistency

**What's Fixed:**
- Single canonical path (pos.db only)
- WAL disabled (DELETE mode)
- Idempotent migrations
- Single DB connection

**Result:**
- Data is persistent and consistent
- No phantom data
- No path confusion
- Production-ready stability




































