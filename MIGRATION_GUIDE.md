# SQLite Migration Guide

## Overview

This project has been migrated from Supabase to local SQLite database. All data is now stored locally in SQLite files with no online sync.

## Architecture

### Backend (Electron Main Process)
- **Database**: SQLite using `better-sqlite3`
- **Location**: `app.getPath('userData')/pos-database.db`
- **Migrations**: Auto-run from `electron/db/migrations/`
- **Repositories**: TypeScript files in `electron/db/*.repo.ts`
- **IPC Handlers**: Registered in `electron/ipc/index.ts`

### Frontend (Renderer Process)
- **API Layer**: `src/db/api.ts` - Uses IPC in Electron, falls back to mock in browser
- **Communication**: IPC via `window.api.*` exposed through preload script
- **No direct DB access**: All database operations go through IPC

## File Structure

```
electron/
├── db/
│   ├── index.ts              # DB initialization & migrations
│   ├── products.repo.ts      # Product CRUD operations
│   ├── categories.repo.ts    # Category CRUD operations
│   └── migrations/
│       └── 001_init.sql      # Complete schema
├── ipc/
│   └── index.ts              # All IPC handlers
├── setup.ts                  # Backend initialization
├── main.cjs                  # Electron main process
└── preload.cjs               # Exposes window.api.*
```

## Database Schema

All tables are defined in `electron/db/migrations/001_init.sql`:
- categories
- products
- suppliers
- supplier_payments
- customers
- shifts
- orders
- order_items
- payments
- customer_payments
- sales_returns
- sales_return_items
- purchase_orders
- purchase_order_items
- inventory_movements
- expenses
- held_orders
- profiles
- employee_sessions
- employee_activity_logs

## Adding New Repositories

1. Create `electron/db/entity.repo.ts` with CRUD functions
2. Add IPC handlers in `electron/ipc/index.ts`
3. Expose in `electron/preload.cjs` under `window.api.entity.*`
4. Update `src/db/api.ts` to use IPC when available

Example pattern:
```typescript
// electron/db/entity.repo.ts
import { getDb } from './index';

export function listEntities(): Entity[] {
  const db = getDb();
  return db.prepare('SELECT * FROM entities').all() as Entity[];
}

// electron/ipc/index.ts
ipcMain.handle('entities:list', async () => {
  return entityRepo.listEntities();
});

// electron/preload.cjs
entities: {
  list: () => ipcRenderer.invoke('entities:list'),
}

// src/db/api.ts
export const getEntities = async () => {
  if (isElectron() && getElectronAPI()?.entities?.list) {
    return await getElectronAPI().entities.list();
  }
  // Fallback to mock
};
```

## Building & Running

### Development
```bash
npm run electron:build  # Compile TypeScript
npm run electron:dev    # Run Electron with Vite dev server
```

### Production
```bash
npm run build          # Build frontend
npm run electron:build # Compile Electron backend
npm run dist:win       # Create Windows installer
```

## Current Status

✅ **Completed:**
- Products CRUD (SQLite + IPC)
- Categories CRUD (SQLite + IPC)
- Complete database schema
- Migration system
- IPC infrastructure

🚧 **Pending (Fallback to Mock):**
- Customers
- Suppliers
- Orders
- Purchase Orders
- Sales Returns
- Expenses
- Shifts
- Inventory Movements
- Reports

The mock implementation in `src/db/api.ts` handles all operations until repositories are implemented.

## Database Location

- **Windows**: `%APPDATA%/POS Tizimi/pos-database.db`
- **macOS**: `~/Library/Application Support/POS Tizimi/pos-database.db`
- **Linux**: `~/.config/POS Tizimi/pos-database.db`

## Migration Notes

- No automatic data migration from Supabase
- Fresh database starts empty
- Data can be manually imported later if needed
- All operations are local-only (no sync)

