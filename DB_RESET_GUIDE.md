# Database Reset and Migration Guide

## How to Safely Reset the Database

### Backup Current Database

1. **Find your database location:**
   ```bash
   npm run db:where
   ```
   This will show the exact path to your database file.

2. **Backup the database:**
   - Copy `pos.db` to a safe location (e.g., `pos.db.backup`)
   - Also copy WAL/SHM files if they exist: `pos.db-wal`, `pos.db-shm`

### Reset Database

**Option 1: Delete and let app recreate (recommended)**
1. Close the application
2. Delete `pos.db` (and `pos.db-wal`, `pos.db-shm` if they exist)
3. If you have `pos.legacy.db`, the app will migrate data from it on next startup
4. Start the app - it will create a new clean database

**Option 2: Use reset script**
```bash
npm run db:reset
```
This will show a confirmation dialog before deleting.

### Restore from Legacy

If you need to restore data from `pos.legacy.db`:

1. Ensure `pos.legacy.db` exists in userData directory
2. Delete `pos.db` (if it exists)
3. Start the app - it will automatically migrate data from legacy

### Re-run Migrations

Migrations run automatically on every app startup. If you need to force re-run:

1. **Check current migrations:**
   ```bash
   npm run db:check
   ```

2. **If migrations are stuck:**
   - Check the migration file that's failing
   - Fix the SQL in the migration file
   - Delete the failed migration record from `schema_migrations` table:
     ```sql
     DELETE FROM schema_migrations WHERE id = '022_customer_ledger_add_method.sql';
     ```
   - Restart the app

### Manual Migration

To manually run legacy data migration:

```bash
npm run db:migrate:legacy
```

## Database Locations

- **Production:** `%APPDATA%\miaoda-react-admin\pos.db` (Windows)
- **Development:** `%APPDATA%\miaoda-react-admin\pos.dev.db` (Windows)
- **Legacy:** `%APPDATA%\miaoda-react-admin\pos.legacy.db`

## Diagnostic Commands

- `npm run db:check` - Check database schema and migrations
- `npm run db:counts` - Show row counts for key tables
- `npm run db:integrity` - Run integrity check
- `npm run db:where` - Show database location

## Troubleshooting

### "Duplicate column" error

This means a migration tried to add a column that already exists. The migration system now handles this automatically, but if you see this error:

1. The migration was marked as applied (safe to ignore)
2. Or fix the migration file to check before adding

### "No such table" error

This means migrations haven't run. Check:
1. `npm run db:check` - see which migrations are applied
2. Ensure migration files exist in `electron/db/migrations/`
3. Check console logs for migration errors

### Data not showing after migration

1. Check if data exists: `npm run db:counts`
2. Verify legacy migration ran: Check console logs for "Data migration complete"
3. If legacy DB exists but data wasn't migrated, run: `npm run db:migrate:legacy`




































