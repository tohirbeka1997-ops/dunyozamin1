# Electron SQLite Migration Plan

## Status: IN PROGRESS

This document tracks the migration from Supabase to local SQLite backend.

## Completed

✅ SQL Schema (`electron/db/migrations/001_init.sql`)
- All tables defined
- Foreign keys and indexes created

✅ Database initialization (`electron/db/index.ts`)
- Auto-runs migrations
- Tracks migration state

✅ Products repository (`electron/db/products.repo.ts`)
- CRUD operations implemented
- IPC handlers registered

✅ Frontend adapter (`src/db/api.ts`)
- Products functions use IPC in Electron
- Falls back to mock in browser

## In Progress

🔄 Need to create repositories for:
- Categories
- Customers
- Orders + OrderItems + Payments
- Suppliers + SupplierPayments
- Purchase Orders + Items
- Sales Returns + Items
- Expenses
- Shifts
- Held Orders
- Inventory Movements
- Profiles/Employees

## Next Steps

1. Create repository files for remaining entities
2. Create IPC handlers for all repositories
3. Update preload.cjs to expose all APIs
4. Update src/db/api.ts to use IPC for all operations
5. Test compilation with TypeScript
6. Verify all sidebar modules work

## Architecture

- **Backend**: Electron main process (Node.js + SQLite)
- **Frontend**: Renderer process (React + Vite)
- **Communication**: IPC via preload script
- **Storage**: SQLite database in `app.getPath('userData')/pos-database.db`

## IPC Channel Naming

Pattern: `{entity}:{action}`
- `products:list`, `products:create`, `products:update`, `products:remove`
- `categories:list`, `categories:create`, etc.
- `customers:list`, `customers:create`, etc.





















































