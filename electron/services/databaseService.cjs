const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const fs = require('fs');
const path = require('path');

/**
 * Database Service
 * Handles database maintenance operations like wiping data
 */
class DatabaseService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Wipe all transactional and master data while preserving users
   * This is a DESTRUCTIVE operation - use with caution!
   */
  wipeAllData() {
    console.log('🗑️  [DatabaseService] Starting database wipe...');
    
    return this.db.transaction(() => {
      try {
        // ============================================================================
        // STEP 1: DELETE TRANSACTIONAL DATA
        // ============================================================================
        console.log('🗑️  [DatabaseService] Deleting transactional data...');

        // Returns related tables
        // IMPORTANT: Returns reference orders WITHOUT ON DELETE CASCADE, so delete returns BEFORE orders.
        // Also: return items reference order_items, so delete *_return_items BEFORE order_items.
        this.db.prepare('DELETE FROM return_items').run();
        this.db.prepare('DELETE FROM sale_return_items').run();
        this.db.prepare('DELETE FROM sales_returns').run();
        this.db.prepare('DELETE FROM sale_returns').run();
        console.log('  ✓ Deleted returns data');

        // Customer payments may reference orders (nullable order_id but can be set), so delete BEFORE orders.
        this.db.prepare('DELETE FROM customer_payments').run();

        // Sales/Orders related tables (delete in order to respect foreign keys)
        this.db.prepare('DELETE FROM receipts').run();
        this.db.prepare('DELETE FROM payments').run();
        this.db.prepare('DELETE FROM order_items').run();
        this.db.prepare('DELETE FROM orders').run();
        console.log('  ✓ Deleted orders and related data');

        // Purchases related tables
        this.db.prepare('DELETE FROM purchase_order_items').run();
        this.db.prepare('DELETE FROM goods_receipt_items').run();
        this.db.prepare('DELETE FROM goods_receipts').run();
        this.db.prepare('DELETE FROM supplier_payments').run();
        this.db.prepare('DELETE FROM purchase_orders').run();
        console.log('  ✓ Deleted purchases data');

        // Inventory movements and stock tracking
        this.db.prepare('DELETE FROM inventory_adjustment_items').run();
        this.db.prepare('DELETE FROM inventory_adjustments').run();
        // Batch mode tables (must be cleared before products/warehouses due to FKs)
        this.db.prepare('DELETE FROM inventory_batch_allocations').run();
        this.db.prepare('DELETE FROM inventory_batches').run();
        this.db.prepare('DELETE FROM stock_moves').run();
        this.db.prepare('DELETE FROM stock_balances').run();
        this.db.prepare('DELETE FROM inventory_movements').run();
        console.log('  ✓ Deleted inventory movements');

        // Cash movements
        this.db.prepare('DELETE FROM cash_movements').run();
        console.log('  ✓ Deleted cash movements');

        // Customer payments and ledger
        this.db.prepare('DELETE FROM customer_ledger').run();
        this.db.prepare('DELETE FROM customers').run();
        console.log('  ✓ Deleted customers and payments');

        // Expenses
        this.db.prepare('DELETE FROM expenses').run();
        console.log('  ✓ Deleted expenses');

        // Held orders
        this.db.prepare('DELETE FROM held_orders').run();
        console.log('  ✓ Deleted held orders');

        // Shift totals
        this.db.prepare('DELETE FROM shift_totals').run();
        console.log('  ✓ Deleted shift totals');

        // ============================================================================
        // STEP 2: DELETE MASTER DATA
        // ============================================================================
        console.log('🗑️  [DatabaseService] Deleting master data...');
        
        // Products (must be deleted before categories due to foreign key)
        this.db.prepare('DELETE FROM products').run();
        console.log('  ✓ Deleted products');

        // Categories
        this.db.prepare('DELETE FROM categories').run();
        console.log('  ✓ Deleted categories');

        // Warehouses
        this.db.prepare('DELETE FROM warehouses').run();
        console.log('  ✓ Deleted warehouses');

        // Shifts
        this.db.prepare('DELETE FROM shifts').run();
        console.log('  ✓ Deleted shifts');

        // Suppliers
        this.db.prepare('DELETE FROM suppliers').run();
        console.log('  ✓ Deleted suppliers');

        // Expense categories
        this.db.prepare('DELETE FROM expense_categories').run();
        console.log('  ✓ Deleted expense categories');

        // ============================================================================
        // STEP 3: RESET AUTO-INCREMENT SEQUENCES
        // ============================================================================
        console.log('🗑️  [DatabaseService] Resetting sequences...');
        try {
          this.db.prepare('DELETE FROM sqlite_sequence').run();
          console.log('  ✓ Reset sqlite_sequence');
        } catch (error) {
          // sqlite_sequence might not exist - that's okay
          if (!error.message.includes('no such table')) {
            throw error;
          }
          console.log('  ⚠️  sqlite_sequence table does not exist (normal for SQLite)');
        }

        // ============================================================================
        // STEP 4: VERIFY USERS TABLE IS PRESERVED
        // ============================================================================
        const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        console.log(`✅ [DatabaseService] Users table preserved: ${userCount} user(s) remaining`);
        
        // Verify admin user exists
        const adminUser = this.db.prepare("SELECT id, username, email FROM users WHERE email = 'admin@pos.com' OR username = 'admin'").get();
        if (adminUser) {
          console.log(`✅ [DatabaseService] Admin user preserved: ${adminUser.username} (${adminUser.email || 'N/A'})`);
        } else {
          console.warn('⚠️  [DatabaseService] Admin user not found - you may need to recreate it');
        }

        // ============================================================================
        // VERIFICATION: Get counts after wipe
        // ============================================================================
        const counts = {
          orders: this.db.prepare('SELECT COUNT(*) as count FROM orders').get().count,
          products: this.db.prepare('SELECT COUNT(*) as count FROM products').get().count,
          categories: this.db.prepare('SELECT COUNT(*) as count FROM categories').get().count,
          warehouses: this.db.prepare('SELECT COUNT(*) as count FROM warehouses').get().count,
          shifts: this.db.prepare('SELECT COUNT(*) as count FROM shifts').get().count,
          customers: this.db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
          users: userCount,
        };

        console.log('📊 [DatabaseService] Final counts after wipe:', counts);

      return {
        success: true,
        message: 'Database wiped successfully',
        counts,
      };
    } catch (error) {
      console.error('❌ [DatabaseService] Error during wipe:', error);
      console.error('❌ [DatabaseService] Error details:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        stack: error.stack,
      });
      throw createError(ERROR_CODES.DATABASE_ERROR, `Failed to wipe database: ${error.message}`);
    }
  })();
  }

  /**
   * Data-only wipe: Clears all records while preserving:
   * - Main warehouse (main-warehouse-001)
   * - Admin user (admin@pos.com)
   * - All table structures (schema unchanged)
   * - Application logic (single warehouse, manual SKU rules)
   */
  wipeDataOnly() {
    console.log('🗑️  [DatabaseService] Starting data-only wipe...');
    
    return this.db.transaction(() => {
      try {
        // ============================================================================
        // STEP 1: DELETE TRANSACTIONAL DATA
        // ============================================================================
        console.log('🗑️  [DatabaseService] Deleting transactional data...');

        // Returns related tables
        // IMPORTANT: Returns reference orders WITHOUT ON DELETE CASCADE, so delete returns BEFORE orders.
        // Also: return items reference order_items, so delete *_return_items BEFORE order_items.
        this.db.prepare('DELETE FROM return_items').run();
        this.db.prepare('DELETE FROM sale_return_items').run();
        this.db.prepare('DELETE FROM sales_returns').run();
        this.db.prepare('DELETE FROM sale_returns').run();
        console.log('  ✓ Deleted returns data');

        // Customer payments may reference orders (nullable order_id but can be set), so delete BEFORE orders.
        this.db.prepare('DELETE FROM customer_payments').run();

        // Sales/Orders related tables
        this.db.prepare('DELETE FROM receipts').run();
        this.db.prepare('DELETE FROM payments').run();
        this.db.prepare('DELETE FROM order_items').run();
        this.db.prepare('DELETE FROM orders').run();
        console.log('  ✓ Deleted orders and related data');

        // Purchases related tables
        this.db.prepare('DELETE FROM purchase_order_items').run();
        this.db.prepare('DELETE FROM goods_receipt_items').run();
        this.db.prepare('DELETE FROM goods_receipts').run();
        this.db.prepare('DELETE FROM supplier_payments').run();
        this.db.prepare('DELETE FROM purchase_orders').run();
        console.log('  ✓ Deleted purchases data');

        // Inventory movements and stock tracking
        this.db.prepare('DELETE FROM inventory_adjustment_items').run();
        this.db.prepare('DELETE FROM inventory_adjustments').run();
        // Batch mode tables (must be cleared before products/warehouses due to FKs)
        this.db.prepare('DELETE FROM inventory_batch_allocations').run();
        this.db.prepare('DELETE FROM inventory_batches').run();
        this.db.prepare('DELETE FROM stock_moves').run();
        this.db.prepare('DELETE FROM stock_balances').run();
        this.db.prepare('DELETE FROM inventory_movements').run();
        console.log('  ✓ Deleted inventory movements');

        // Cash movements
        this.db.prepare('DELETE FROM cash_movements').run();
        console.log('  ✓ Deleted cash movements');

        // Customer payments and ledger
        this.db.prepare('DELETE FROM customer_ledger').run();
        this.db.prepare('DELETE FROM customers').run();
        console.log('  ✓ Deleted customers and payments');

        // Expenses
        this.db.prepare('DELETE FROM expenses').run();
        console.log('  ✓ Deleted expenses');

        // Held orders
        this.db.prepare('DELETE FROM held_orders').run();
        console.log('  ✓ Deleted held orders');

        // Shift totals
        this.db.prepare('DELETE FROM shift_totals').run();
        console.log('  ✓ Deleted shift totals');

        // ============================================================================
        // STEP 2: DELETE MASTER DATA
        // ============================================================================
        console.log('🗑️  [DatabaseService] Deleting master data...');
        
        // Products (must be deleted before categories due to foreign key)
        this.db.prepare('DELETE FROM products').run();
        console.log('  ✓ Deleted products');

        // Categories
        this.db.prepare('DELETE FROM categories').run();
        console.log('  ✓ Deleted categories');

        // Shifts
        this.db.prepare('DELETE FROM shifts').run();
        console.log('  ✓ Deleted shifts');

        // Suppliers
        this.db.prepare('DELETE FROM suppliers').run();
        console.log('  ✓ Deleted suppliers');

        // Expense categories
        this.db.prepare('DELETE FROM expense_categories').run();
        console.log('  ✓ Deleted expense categories');

        // ============================================================================
        // STEP 3: DELETE WAREHOUSES (EXCEPT MAIN WAREHOUSE)
        // ============================================================================
        console.log('🗑️  [DatabaseService] Deleting warehouses (keeping main-warehouse-001)...');
        const warehouseDeleteResult = this.db.prepare('DELETE FROM warehouses WHERE id != ?').run('main-warehouse-001');
        console.log(`  ✓ Deleted ${warehouseDeleteResult.changes} warehouse(s), kept main-warehouse-001`);

        // Verify main warehouse exists
        const mainWarehouse = this.db.prepare('SELECT id, name FROM warehouses WHERE id = ?').get('main-warehouse-001');
        if (mainWarehouse) {
          console.log(`  ✅ Main warehouse preserved: ${mainWarehouse.name}`);
        } else {
          // Create it if missing
          console.log('  ⚠️  Main warehouse not found, creating it...');
          this.db.prepare(`
            INSERT INTO warehouses (id, code, name, is_active, created_at, updated_at)
            VALUES (?, 'MAIN', 'Asosiy Ombor', 1, datetime('now'), datetime('now'))
          `).run('main-warehouse-001');
          console.log('  ✅ Main warehouse created');
        }

        // ============================================================================
        // STEP 4: DELETE USERS (EXCEPT ADMIN)
        // ============================================================================
        console.log('🗑️  [DatabaseService] Deleting users (keeping admin@pos.com)...');
        
        // Get admin user ID first
        const adminUser = this.db.prepare("SELECT id FROM users WHERE username = 'admin@pos.com' OR email = 'admin@pos.com'").get();
        const adminUserId = adminUser?.id;
        
        if (adminUserId) {
          // Delete all users except admin
          const userDeleteResult = this.db.prepare('DELETE FROM users WHERE id != ?').run(adminUserId);
          console.log(`  ✓ Deleted ${userDeleteResult.changes} user(s), kept admin@pos.com`);
          
          // Clean up user_roles for deleted users
          const roleDeleteResult = this.db.prepare('DELETE FROM user_roles WHERE user_id != ?').run(adminUserId);
          console.log(`  ✓ Cleaned up ${roleDeleteResult.changes} user role assignment(s)`);
          
          // Clean up sessions for deleted users
          const sessionDeleteResult = this.db.prepare('DELETE FROM sessions WHERE user_id != ?').run(adminUserId);
          console.log(`  ✓ Cleaned up ${sessionDeleteResult.changes} session(s)`);
          
          console.log(`  ✅ Admin user preserved: admin@pos.com (ID: ${adminUserId})`);
        } else {
          console.warn('  ⚠️  Admin user not found - all users will be deleted!');
          this.db.prepare('DELETE FROM users').run();
          this.db.prepare('DELETE FROM user_roles').run();
          this.db.prepare('DELETE FROM sessions').run();
          console.warn('  ⚠️  You may need to recreate the admin user');
        }

        // ============================================================================
        // STEP 5: RESET AUTO-INCREMENT SEQUENCES
        // ============================================================================
        console.log('🗑️  [DatabaseService] Resetting sequences...');
        try {
          this.db.prepare('DELETE FROM sqlite_sequence').run();
          console.log('  ✓ Reset sqlite_sequence');
        } catch (error) {
          // sqlite_sequence might not exist - that's okay
          if (!error.message.includes('no such table')) {
            throw error;
          }
          console.log('  ⚠️  sqlite_sequence table does not exist (normal for SQLite)');
        }

        // ============================================================================
        // VERIFICATION: Get counts after wipe
        // ============================================================================
        const counts = {
          orders: this.db.prepare('SELECT COUNT(*) as count FROM orders').get().count,
          products: this.db.prepare('SELECT COUNT(*) as count FROM products').get().count,
          categories: this.db.prepare('SELECT COUNT(*) as count FROM categories').get().count,
          warehouses: this.db.prepare('SELECT COUNT(*) as count FROM warehouses').get().count,
          shifts: this.db.prepare('SELECT COUNT(*) as count FROM shifts').get().count,
          customers: this.db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
          users: this.db.prepare('SELECT COUNT(*) as count FROM users').get().count,
          inventory_movements: this.db.prepare('SELECT COUNT(*) as count FROM inventory_movements').get().count,
          stock_balances: this.db.prepare('SELECT COUNT(*) as count FROM stock_balances').get().count,
        };

        console.log('📊 [DatabaseService] Final counts after data-only wipe:', counts);

        return {
          success: true,
          message: 'Data-only wipe completed successfully',
          counts,
        };
      } catch (error) {
        console.error('❌ [DatabaseService] Error during data-only wipe:', error);
        console.error('❌ [DatabaseService] Error details:', {
          message: error.message,
          code: error.code,
          errno: error.errno,
          stack: error.stack,
        });
        throw createError(ERROR_CODES.DATABASE_ERROR, `Failed to perform data-only wipe: ${error.message}`);
      }
    })();
  }
}

module.exports = DatabaseService;

