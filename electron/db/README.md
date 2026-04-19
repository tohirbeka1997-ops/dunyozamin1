# Database Foundation

This directory contains the SQLite database foundation for the Electron app.

## Files

- **`index.cjs`** - Main entry point. Calls `open()`, `migrate()`, and `seed()`
- **`open.cjs`** - Opens SQLite database with production-ready settings
- **`migrate.cjs`** - Runs migrations from `migrations/` directory
- **`seed.cjs`** - Seeds default data (idempotent)

## Initialization Flow

```
app.whenReady() 
  → initializeDb() 
    → open()        (opens DB, sets pragmas)
    → migrate()     (runs pending migrations)
    → seed()        (seeds default data)
```

## Migrations

- Migrations live in `migrations/*.sql`
- Tracked in `schema_migrations` table
- Only pending migrations run
- Each migration runs in a transaction

## Seed Data

- Admin user: `admin` / role: `admin`
- Default categories (Uncategorized, Food & Beverages, etc.)
- Idempotent: safe to run multiple times

## Database Location

- Windows: `%APPDATA%\POS Tizimi\pos.db`
- macOS: `~/Library/Application Support/POS Tizimi/pos.db`
- Linux: `~/.config/POS Tizimi/pos.db`





















































