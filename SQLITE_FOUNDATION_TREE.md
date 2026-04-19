# SQLite Foundation - File Tree

## New Foundation Files (CommonJS)

```
electron/
├── db/
│   ├── index.cjs              # Main DB initialization (open, migrate, seed)
│   ├── open.cjs               # Database connection with pragmas
│   ├── migrate.cjs            # Migration runner
│   ├── seed.cjs               # Idempotent seed data
│   └── migrations/
│       └── 001_init.sql       # Initial schema (existing)
│
├── lib/
│   └── errors.cjs             # Shared error handling format
│
├── ipc/
│   └── index.cjs              # Central IPC handler registration
│
└── main.cjs                   # Updated to use new foundation
```

## Implementation Details

### Database Connection (`electron/db/open.cjs`)
- Opens SQLite at `app.getPath("userData")/pos.db`
- Sets production pragmas:
  - `journal_mode = WAL` (Write-Ahead Logging)
  - `foreign_keys = ON`
  - `busy_timeout = 5000`
  - `synchronous = NORMAL`
- Provides: `open()`, `getDb()`, `close()`, `isOpen()`, `getDbPath()`

### Migration Runner (`electron/db/migrate.cjs`)
- Tracks migrations in `schema_migrations` table
- Runs migrations from `electron/db/migrations/*.sql`
- Executes in transactions
- Safe to run multiple times (only runs pending migrations)

### Seed Data (`electron/db/seed.cjs`)
- Idempotent seed function
- Seeds:
  - Admin user (username: `admin`, role: `admin`)
  - Default categories (Uncategorized, Food & Beverages, Electronics, Clothing, Household)
- Safe to run multiple times (checks for existing records)

### Error Handling (`electron/lib/errors.cjs`)
- Standardized error format: `{code, message, details}`
- Error codes: `NOT_FOUND`, `VALIDATION_ERROR`, `DATABASE_ERROR`, etc.
- `wrapHandler()` utility for IPC handlers

### IPC Base (`electron/ipc/index.cjs`)
- Central registration point
- Registers TypeScript handlers (if compiled)
- Health check endpoint: `db:health`

### Main Entry (`electron/main.cjs`)
- Initializes database on app start
- Calls: `open()` → `migrate()` → `seed()`
- Registers IPC handlers
- Closes DB on app quit

## Dependencies Added

- `uuid`: ^10.0.0 (for generating UUIDs)
- `@types/uuid`: ^10.0.0 (TypeScript types)
- `better-sqlite3`: ^11.10.0 (already present)
- `@types/better-sqlite3`: ^7.6.13 (already present)

## Database Location

Windows: `%APPDATA%\POS Tizimi\pos.db`
macOS: `~/Library/Application Support/POS Tizimi/pos.db`
Linux: `~/.config/POS Tizimi/pos.db`

## Usage

```javascript
// Initialize database
const { initialize } = require('./electron/db/index.cjs');
initialize();

// Get database instance
const { getDb } = require('./electron/db/index.cjs');
const db = getDb();
const users = db.prepare('SELECT * FROM profiles').all();

// Use error handling in IPC handlers
const { wrapHandler } = require('./electron/lib/errors.cjs');
ipcMain.handle('users:list', wrapHandler(async () => {
  const db = getDb();
  return db.prepare('SELECT * FROM profiles').all();
}));
```





















































