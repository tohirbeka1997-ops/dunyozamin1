const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Inventory Service
 * Handles stock balances, stock moves, and adjustments
 */
class InventoryService {
  constructor(db, batchService = null) {
    this.db = db;
    this.batchService = batchService;
  }

  /**
   * Internal helper: check if a SQLite view exists
   */
  _viewExists(name) {
    try {
      const row = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='view' AND name = ?")
        .get(name);
      return !!row;
    } catch (_e) {
      return false;
    }
  }

  _hasTable(name) {
    try {
      const row = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name);
      return !!row;
    } catch (_e) {
      return false;
    }
  }

  _ymd(date) {
    if (!date) return null;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Get stock balances with filters
   */
  getBalances(filters = {}) {
    let query = `
      SELECT 
        sb.*,
        p.name as product_name,
        p.sku as product_sku,
        w.name as warehouse_name
      FROM stock_balances sb
      INNER JOIN products p ON sb.product_id = p.id
      INNER JOIN warehouses w ON sb.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.product_id) {
      query += ' AND sb.product_id = ?';
      params.push(filters.product_id);
    }

    if (filters.warehouse_id) {
      query += ' AND sb.warehouse_id = ?';
      params.push(filters.warehouse_id);
    }

    if (filters.low_stock) {
      query += `
        AND sb.quantity <= (
          SELECT min_stock_level FROM products WHERE id = sb.product_id
        )
        AND sb.quantity > 0
      `;
    }

    if (filters.out_of_stock) {
      query += ' AND sb.quantity = 0';
    }

    query += ' ORDER BY p.name ASC';

    return this.db.prepare(query).all(params);
  }

  /**
   * Get stock moves (history) with filters
   */
  getMoves(filters = {}) {
    let query = `
      SELECT 
        sm.id,
        sm.move_number AS movement_number,
        sm.product_id,
        sm.move_type AS movement_type,
        sm.quantity,
        sm.before_quantity,
        sm.after_quantity,
        sm.reference_type,
        sm.reference_id,
        sm.reason,
        sm.notes,
        sm.created_by,
        sm.created_at,
        json_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
        json_object('id', u.id, 'username', u.username, 'full_name', u.full_name) as user,
        w.name as warehouse_name
      FROM stock_moves sm
      INNER JOIN products p ON sm.product_id = p.id
      INNER JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN users u ON sm.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.product_id) {
      query += ' AND sm.product_id = ?';
      params.push(filters.product_id);
    }

    if (filters.warehouse_id) {
      query += ' AND sm.warehouse_id = ?';
      params.push(filters.warehouse_id);
    }

    if (filters.move_type) {
      query += ' AND sm.move_type = ?';
      params.push(filters.move_type);
    }

    if (filters.reference_type && filters.reference_id) {
      query += ' AND sm.reference_type = ? AND sm.reference_id = ?';
      params.push(filters.reference_type, filters.reference_id);
    }

    if (filters.date_from) {
      query += ' AND sm.created_at >= ?';
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      query += ' AND sm.created_at <= ?';
      params.push(filters.date_to);
    }

    query += ' ORDER BY sm.created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(query).all(params);
    // Parse JSON columns (product, user) from SQLite json_object
    return rows.map(row => ({
      ...row,
      product: row.product ? JSON.parse(row.product) : null,
      user: row.user ? JSON.parse(row.user) : null,
    }));
  }

  /**
   * Adjust stock (creates adjustment document and stock moves)
   * Uses transaction to ensure consistency
   */
  adjustStock(adjustmentData) {
    if (!adjustmentData.warehouse_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse ID is required');
    }

    if (!adjustmentData.items || !Array.isArray(adjustmentData.items) || adjustmentData.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Adjustment items are required');
    }

    if (!adjustmentData.reason || !adjustmentData.reason.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Adjustment reason is required');
    }

    // Use transaction for multi-step operation
    return this.db.transaction(() => {
      const adjustmentId = randomUUID();
      const adjustmentNumber = `ADJ-${Date.now()}`;
      const now = new Date().toISOString();
      const nowSqlite = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      const batchActive = !!this.batchService?.shouldEnforceAt?.(nowSqlite);

      // Create adjustment document
      this.db.prepare(`
        INSERT INTO inventory_adjustments (
          id, adjustment_number, warehouse_id, adjustment_type, reason, notes,
          status, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        adjustmentId,
        adjustmentNumber,
        adjustmentData.warehouse_id,
        adjustmentData.adjustment_type || 'adjustment',
        adjustmentData.reason.trim(),
        adjustmentData.notes || null,
        'completed', // Auto-complete adjustments
        adjustmentData.created_by || null,
        now,
        now
      );

      let totalAdjustment = 0;

      // Process each item
      for (const item of adjustmentData.items) {
        if (!item.product_id) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product ID is required for each item');
        }

        // SINGLE SOURCE OF TRUTH: inventory_movements
        // Compute before from movements, apply delta via _updateBalance (which also keeps stock_balances in sync).
        const beforeQuantity = Number(this.getCurrentStock(item.product_id, adjustmentData.warehouse_id)) || 0;

        const type = adjustmentData.adjustment_type || 'adjustment';
        const qty = Number(item.quantity || 0) || 0;
        const absQty = Math.abs(qty);

        let adjustmentQuantity = 0; // signed delta
        if (type === 'set') {
          const target = Number(item.target_quantity || 0) || 0;
          adjustmentQuantity = target - beforeQuantity;
        } else if (type === 'increase') {
          adjustmentQuantity = absQty;
        } else if (type === 'decrease') {
          adjustmentQuantity = -absQty;
        } else {
          adjustmentQuantity = qty;
        }

        // Batch mode: adjustments must also keep batches consistent.
        // - decrease: consume FIFO from existing batches (fail-fast if insufficient)
        // - increase: create an inbound adjustment batch
        if (batchActive && this.batchService && adjustmentQuantity !== 0) {
          if (adjustmentQuantity < 0) {
            this.batchService.allocateFIFOForAdjustment(
              adjustmentId,
              item.product_id,
              adjustmentData.warehouse_id,
              Math.abs(adjustmentQuantity)
            );
          } else {
            const unitCost =
              typeof this.batchService.defaultUnitCost === 'function'
                ? this.batchService.defaultUnitCost(item.product_id)
                : (() => {
                    const productRow = this.db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(item.product_id);
                    return Number(productRow?.purchase_price || 0) || 0;
                  })();
            this.batchService.applyAdjustmentDelta(
              item.product_id,
              adjustmentData.warehouse_id,
              adjustmentQuantity,
              adjustmentId,
              unitCost
            );
          }
        }

        // Apply movement and update balances atomically
        const { beforeQuantity: before2, afterQuantity } = this._updateBalance(
          item.product_id,
          adjustmentData.warehouse_id,
          adjustmentQuantity,
          'adjustment',
          'adjustment',
          adjustmentId,
          adjustmentData.reason,
          adjustmentData.created_by || null
        );

        totalAdjustment += Math.abs(adjustmentQuantity);

        // Create adjustment item record
        const itemId = randomUUID();
        this.db.prepare(`
          INSERT INTO inventory_adjustment_items (
            id, adjustment_id, product_id, before_quantity, adjustment_quantity, after_quantity, notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          itemId,
          adjustmentId,
          item.product_id,
          before2 ?? beforeQuantity,
          adjustmentQuantity,
          afterQuantity,
          item.notes || null
        );
      }

      // Return the created adjustment with items
      const adjustment = this.db.prepare('SELECT * FROM inventory_adjustments WHERE id = ?').get(adjustmentId);
      const items = this.db.prepare(`
        SELECT aai.*, p.name as product_name, p.sku as product_sku
        FROM inventory_adjustment_items aai
        INNER JOIN products p ON aai.product_id = p.id
        WHERE aai.adjustment_id = ?
      `).all(adjustmentId);

      return {
        ...adjustment,
        items,
      };
    })();
  }

  /**
   * Update stock balance (internal helper)
   * Should be called within transactions for other operations
   * This method atomically checks and updates stock to prevent race conditions
   */
  _updateBalance(productId, warehouseId, quantityChange, moveType, referenceType, referenceId, reason, createdBy) {
    return this.db.transaction(() => {
    // Use SQLite-friendly datetime format (consistent across services)
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

    // SINGLE SOURCE OF TRUTH: inventory_movements
    // Compute stock from movements, not from stock_balances
    const beforeQuantity = Number(this.getCurrentStock(productId, warehouseId)) || 0;
    const afterQuantity = beforeQuantity + quantityChange;

    // Check if negative stock is allowed
    const allowNegativeStock = this.db.prepare(`
      SELECT value FROM settings WHERE key = 'allow_negative_stock'
    `).get();
    const canGoNegative = allowNegativeStock?.value === '1';

    // Validate stock availability for negative changes (sales, adjustments that decrease stock)
    if (quantityChange < 0 && !canGoNegative) {
      if (afterQuantity < 0) {
        // Get product name for better error message
        const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
        const productName = product ? product.name : productId;
        throw createError(ERROR_CODES.INSUFFICIENT_STOCK, 
          `Insufficient stock for ${productName}. Available: ${beforeQuantity}, Requested: ${Math.abs(quantityChange)}`,
          { productId, productName, available: beforeQuantity, requested: Math.abs(quantityChange) });
      }
    }

    // Additional check: prevent going negative even if change is positive but would result in negative
    if (!canGoNegative && afterQuantity < 0) {
      const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
      const productName = product ? product.name : productId;
      throw createError(ERROR_CODES.INSUFFICIENT_STOCK, 
        `Stock cannot go negative for ${productName}. Current: ${beforeQuantity}, Change: ${quantityChange}`,
        { productId, productName, current: beforeQuantity, change: quantityChange });
    }

    // Insert inventory movement (ledger)
    // This drives v_product_stock and all stock displays in the app
    try {
      const movementId = randomUUID();
      const movementNumber = `MOV-${Date.now()}-${movementId.substring(0, 8)}`;
      this.db.prepare(`
        INSERT INTO inventory_movements (
          id, product_id, warehouse_id, movement_number, movement_type, quantity,
          before_quantity, after_quantity, reference_type, reference_id,
          reason, notes, created_by, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        movementId,
        productId,
        warehouseId || null,
        movementNumber,
        moveType,
        quantityChange,
        beforeQuantity,
        afterQuantity,
        referenceType || null,
        referenceId || null,
        reason || null,
        null,
        createdBy || null,
        now
      );
    } catch (movementError) {
      console.error('❌ [InventoryService._updateBalance] Failed to insert inventory_movements:', movementError.message);
      throw movementError;
    }

    // Update or create balance
    // NOTE: stock_balances is kept for legacy checks, but authoritative stock is inventory_movements.
    let balance = this.db.prepare(`
      SELECT * FROM stock_balances 
      WHERE product_id = ? AND warehouse_id = ?
    `).get(productId, warehouseId);

    if (balance) {
      this.db.prepare(`
        UPDATE stock_balances 
        SET quantity = ?, updated_at = ?, last_movement_at = ?
        WHERE product_id = ? AND warehouse_id = ?
      `).run(afterQuantity, now, now, productId, warehouseId);
    } else {
      this.db.prepare(`
        INSERT INTO stock_balances (
          id, product_id, warehouse_id, quantity, last_movement_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        productId,
        warehouseId,
        afterQuantity,
        now,
        now,
        now
      );
    }

    // CRITICAL FIX: Also update products.current_stock for consistency
    // Calculate total stock across all warehouses from inventory_movements
    const totalQuantity = Number(this.getCurrentStock(productId, null)) || 0;
    
    // Update products.current_stock to match sum of stock_balances
    this.db.prepare(`
      UPDATE products 
      SET current_stock = ?, updated_at = ?
      WHERE id = ?
    `).run(totalQuantity, now, productId);
    
    console.log(`📦 Updated products.current_stock for ${productId}: ${totalQuantity} (warehouse ${warehouseId}: ${afterQuantity})`);

    // Create stock move record
    const moveId = randomUUID();
    const moveNumber = `MOV-${Date.now()}-${moveId.substring(0, 8)}`;
    this.db.prepare(`
      INSERT INTO stock_moves (
        id, move_number, product_id, warehouse_id, move_type, quantity,
        before_quantity, after_quantity, reference_type, reference_id,
        reason, created_by, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      moveId,
      moveNumber,
      productId,
      warehouseId,
      moveType,
      quantityChange,
      beforeQuantity,
      afterQuantity,
      referenceType || null,
      referenceId || null,
      reason || null,
      createdBy || null,
      now
    );

    return { beforeQuantity, afterQuantity, moveId };
    })();
  }

  /**
   * Get current stock for a product (SINGLE SOURCE OF TRUTH)
   * Uses inventory_movements SUM(quantity) - same logic as productsService.list()
   */
  getCurrentStock(productId, warehouseId = null) {
    try {
      // Check if v_product_stock view exists (same as productsService.list)
      let viewExists = false;
      try {
        const viewCheck = this.db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='v_product_stock'").get();
        viewExists = !!viewCheck;
      } catch (e) {
        // View doesn't exist, use subquery
      }

      let stock = 0;
      
      if (viewExists) {
        // Use view for cleaner query
        if (warehouseId) {
          // Prefer warehouse-specific view if present
          const whViewCheck = this.db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='v_product_stock_by_warehouse'").get();
          if (whViewCheck) {
            const result = this.db.prepare(`
              SELECT stock
              FROM v_product_stock_by_warehouse
              WHERE product_id = ? AND warehouse_id = ?
            `).get(productId, warehouseId);
            stock = result ? Number(result.stock || 0) : 0;
          } else {
            // Fallback to global view if warehouse view doesn't exist
            const result = this.db.prepare(`
              SELECT stock
              FROM v_product_stock
              WHERE product_id = ?
            `).get(productId);
            stock = result ? Number(result.stock || 0) : 0;
          }
        } else {
        const result = this.db.prepare(`
          SELECT stock
          FROM v_product_stock
          WHERE product_id = ?
        `).get(productId);
        stock = result ? Number(result.stock || 0) : 0;
        }
      } else {
        // Fallback to subquery - same logic as productsService.list()
        const tableInfo = this.db.prepare("PRAGMA table_info(inventory_movements)").all();
        const hasWarehouseId = tableInfo.some(col => col.name === 'warehouse_id');
        
        if (hasWarehouseId && warehouseId) {
          const result = this.db.prepare(`
            SELECT COALESCE(SUM(quantity), 0) AS stock
            FROM inventory_movements
            WHERE product_id = ? AND warehouse_id = ?
          `).get(productId, warehouseId);
          stock = result ? Number(result.stock || 0) : 0;
        } else {
          const result = this.db.prepare(`
            SELECT COALESCE(SUM(quantity), 0) AS stock
            FROM inventory_movements
            WHERE product_id = ?
          `).get(productId);
          stock = result ? Number(result.stock || 0) : 0;
        }
      }
      
      return stock;
    } catch (error) {
      console.error('Error calculating current stock:', error);
      return 0;
    }
  }

  /**
   * Get product detail with real-time stock (for Inventory Detail page)
   * Returns product info + current_stock (from inventory_movements) + stock_value
   * 
   * @param {string} productIdOrSku - Product UUID or SKU (will resolve SKU to UUID)
   */
  getProductDetail(productIdOrSku) {
    try {
      if (!productIdOrSku) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product ID or SKU is required');
      }

      console.log('[InventoryService.getProductDetail] Resolving product:', productIdOrSku);

      // CRITICAL: Resolve productId - try UUID first, then SKU
      let product = null;
      let resolvedProductId = null;

      // Check if it's a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productIdOrSku);
      
      if (isUUID) {
        // Try by UUID first
        product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(productIdOrSku);
        if (product) {
          resolvedProductId = product.id;
          console.log('[InventoryService.getProductDetail] Found product by UUID:', product.name);
        }
      }
      
      // If not found by UUID, try by SKU
      if (!product) {
        product = this.db.prepare('SELECT * FROM products WHERE sku = ?').get(productIdOrSku);
        if (product) {
          resolvedProductId = product.id;
          console.log('[InventoryService.getProductDetail] Found product by SKU:', product.name, '-> UUID:', resolvedProductId);
        }
      }
      
      if (!product || !resolvedProductId) {
        throw createError(ERROR_CODES.NOT_FOUND, `Product with id/sku "${productIdOrSku}" not found`);
      }

      // Get current stock using unified method (MUST use resolved UUID)
      const currentStock = this.getCurrentStock(resolvedProductId);
      console.log('[InventoryService.getProductDetail] Current stock from movements:', currentStock);
      
      // Get latest purchase price from purchase_order_items (most recent received purchase)
      let latestPurchasePrice = Number(product.purchase_price) || 0;
      try {
        const latestPurchase = this.db.prepare(`
          SELECT unit_cost
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON poi.purchase_order_id = po.id
          WHERE poi.product_id = ? 
            AND po.status = 'received'
            AND poi.received_qty > 0
          ORDER BY po.created_at DESC
          LIMIT 1
        `).get(resolvedProductId);
        
        if (latestPurchase && latestPurchase.unit_cost) {
          latestPurchasePrice = Number(latestPurchase.unit_cost);
          console.log('[InventoryService.getProductDetail] Using latest purchase price:', latestPurchasePrice);
        } else {
          // Fallback to product.purchase_price
          console.log('[InventoryService.getProductDetail] No purchase history, using product.purchase_price:', latestPurchasePrice);
        }
      } catch (error) {
        console.warn('[InventoryService.getProductDetail] Error fetching latest purchase price:', error);
        // Use product.purchase_price as fallback
      }
      
      // Calculate stock value with safe defaults
      const stockValue = currentStock * latestPurchasePrice;

      // Get category name
      const category = product.category_id 
        ? this.db.prepare('SELECT name FROM categories WHERE id = ?').get(product.category_id)
        : null;
      
      // Get inventory movements for this product (from inventory_movements table)
      let movements = [];
      try {
        const tableInfo = this.db.prepare("PRAGMA table_info(inventory_movements)").all();
        if (tableInfo.length > 0) {
          // Use inventory_movements table
          const movementsQuery = `
            SELECT 
              im.*,
              p.name as product_name,
              p.sku as product_sku,
              w.name as warehouse_name
            FROM inventory_movements im
            INNER JOIN products p ON im.product_id = p.id
            LEFT JOIN warehouses w ON im.warehouse_id = w.id
            WHERE im.product_id = ?
            ORDER BY im.created_at DESC
            LIMIT 100
          `;
          movements = this.db.prepare(movementsQuery).all(resolvedProductId);
        } else {
          // Fallback to stock_moves if inventory_movements doesn't exist
          movements = this.getMoves({ product_id: resolvedProductId, limit: 100 });
        }
      } catch (error) {
        console.warn('[InventoryService.getProductDetail] Error fetching movements:', error);
        movements = [];
      }
      
      // Get purchase and sales history
      const purchaseHistory = this.getProductPurchaseHistory(resolvedProductId);
      const salesHistory = this.getProductSalesHistory(resolvedProductId);

      // CRITICAL: Ensure all numeric fields have defaults (no NaN)
      const result = {
        id: product.id,
        name: product.name || '',
        sku: product.sku || '',
        barcode: product.barcode || null,
        unit: product.unit || 'pcs',
        sale_price: Number(product.sale_price) || 0,
        purchase_price: latestPurchasePrice,
        cost_price: latestPurchasePrice, // Alias for purchase_price
        min_stock_level: Number(product.min_stock_level) || 0,
        max_stock_level: product.max_stock_level ? Number(product.max_stock_level) : null,
        description: product.description || null,
        image_url: product.image_url || null,
        category_id: product.category_id || null,
        category_name: category?.name || null,
        is_active: product.is_active === 1,
        track_stock: product.track_stock === 1,
        // CRITICAL: Use real-time stock from inventory_movements
        current_stock: currentStock,
        stock_available: currentStock,
        available_stock: currentStock,
        // Legacy fields for backward compatibility (but use real-time stock)
        stock_quantity: currentStock,
        // Calculated value
        stock_value: stockValue,
        // Additional data
        movements: movements || [],
        purchase_history: purchaseHistory || [],
        sales_history: salesHistory || [],
        created_at: product.created_at || null,
        updated_at: product.updated_at || null,
      };

      console.log('[InventoryService.getProductDetail] Returning product detail:', {
        id: result.id,
        name: result.name,
        current_stock: result.current_stock,
        min_stock_level: result.min_stock_level,
        purchase_price: result.purchase_price,
        sale_price: result.sale_price,
        stock_value: result.stock_value,
        movements_count: result.movements?.length || 0,
        purchase_history_count: result.purchase_history?.length || 0,
        sales_history_count: result.sales_history?.length || 0,
      });

      return result;
    } catch (error) {
      console.error('[InventoryService.getProductDetail] Error:', error);
      throw error;
    }
  }

  /**
   * Get product purchase history (from purchase_order_items)
   */
  getProductPurchaseHistory(productId) {
    try {
      const query = `
        SELECT 
          poi.id,
          poi.purchase_order_id,
          poi.product_id,
          poi.ordered_qty as quantity,
          poi.unit_cost,
          poi.received_qty,
          po.po_number,
          po.created_at,
          po.status,
          s.name as supplier_name,
          s.id as supplier_id
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON poi.purchase_order_id = po.id
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE poi.product_id = ?
        ORDER BY po.created_at DESC
        LIMIT 100
      `;
      
      const items = this.db.prepare(query).all(productId);
      
      return items.map(item => ({
        id: item.id,
        purchase_order_id: item.purchase_order_id,
        product_id: item.product_id,
        quantity: Number(item.quantity || 0),
        unit_cost: Number(item.unit_cost || 0),
        received_qty: Number(item.received_qty || 0),
        purchase_order: {
          id: item.purchase_order_id,
          po_number: item.po_number,
          created_at: item.created_at,
          status: item.status,
          supplier: item.supplier_id ? {
            id: item.supplier_id,
            name: item.supplier_name
          } : null
        }
      }));
    } catch (error) {
      console.error('Error fetching product purchase history:', error);
      return [];
    }
  }

  /**
   * Get product sales history (from order_items)
   */
  getProductSalesHistory(productId) {
    try {
      const query = `
        SELECT 
          oi.id,
          oi.order_id,
          oi.product_id,
          oi.quantity,
          oi.unit_price,
          o.order_number,
          o.created_at,
          o.status,
          c.name as customer_name,
          c.id as customer_id
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE oi.product_id = ?
        ORDER BY o.created_at DESC
        LIMIT 100
      `;
      
      const items = this.db.prepare(query).all(productId);
      
      return items.map(item => ({
        id: item.id,
        order_id: item.order_id,
        product_id: item.product_id,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        order: {
          id: item.order_id,
          order_number: item.order_number,
          created_at: item.created_at,
          status: item.status,
          customer: item.customer_id ? {
            id: item.customer_id,
            name: item.customer_name
          } : null
        }
      }));
    } catch (error) {
      console.error('Error fetching product sales history:', error);
      return [];
    }
  }

  /**
   * Dead stock (harakatsiz mahsulotlar)
   * - days: number (e.g. 30/60/90)
   * Global scope (across all warehouses).
   */
  getDeadStock({ days } = {}) {
    const d = Number(days || 30);
    if (!Number.isFinite(d) || d <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'days must be a positive number');
    }
    const sinceExpr = `-${Math.floor(d)} day`;
    const viewExists = this._viewExists('v_product_stock');

    const query = `
      WITH base AS (
        SELECT
          p.id AS product_id,
          p.sku AS product_sku,
          p.name AS product_name,
          p.category_id,
          p.unit,
          COALESCE(p.purchase_price, 0) AS purchase_price,
          COALESCE(p.sale_price, 0) AS sale_price,
          ${viewExists ? `COALESCE(vps.stock, 0)` : `(
            SELECT COALESCE(SUM(im.quantity), 0)
            FROM inventory_movements im
            WHERE im.product_id = p.id
          )`} AS current_stock,
          (
            SELECT MAX(im2.created_at)
            FROM inventory_movements im2
            WHERE im2.product_id = p.id AND im2.movement_type = 'sale'
          ) AS last_sale_at
        FROM products p
        ${viewExists ? `LEFT JOIN v_product_stock vps ON vps.product_id = p.id` : ``}
        WHERE p.is_active = 1 AND COALESCE(p.track_stock, 1) = 1
      )
      SELECT
        base.*,
        (base.current_stock * base.purchase_price) AS frozen_value,
        CASE
          WHEN base.last_sale_at IS NULL THEN NULL
          ELSE CAST((julianday('now') - julianday(base.last_sale_at)) AS INTEGER)
        END AS days_since_last_sale
      FROM base
      WHERE base.current_stock > 0
        AND (base.last_sale_at IS NULL OR base.last_sale_at < datetime('now', ?))
      ORDER BY frozen_value DESC, base.product_name ASC
    `;

    return this.db.prepare(query).all(sinceExpr);
  }

  /**
   * Stock turnover (aylanish tezligi)
   * - days: number (e.g. 30/60/90)
   * Global scope (across all warehouses).
   */
  getStockTurnover({ days } = {}) {
    const d = Number(days || 30);
    if (!Number.isFinite(d) || d <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'days must be a positive number');
    }
    const sinceExpr = `-${Math.floor(d)} day`;
    const viewExists = this._viewExists('v_product_stock');

    const query = `
      WITH base AS (
        SELECT
          p.id AS product_id,
          p.sku AS product_sku,
          p.name AS product_name,
          p.category_id,
          p.unit,
          COALESCE(p.purchase_price, 0) AS purchase_price,
          COALESCE(p.sale_price, 0) AS sale_price,
          ${viewExists ? `COALESCE(vps.stock, 0)` : `(
            SELECT COALESCE(SUM(im.quantity), 0)
            FROM inventory_movements im
            WHERE im.product_id = p.id
          )`} AS current_stock,
          (
            SELECT COALESCE(SUM(ABS(im3.quantity)), 0)
            FROM inventory_movements im3
            WHERE im3.product_id = p.id
              AND im3.movement_type = 'sale'
              AND im3.created_at >= datetime('now', ?)
          ) AS sold_qty_n
        FROM products p
        ${viewExists ? `LEFT JOIN v_product_stock vps ON vps.product_id = p.id` : ``}
        WHERE p.is_active = 1 AND COALESCE(p.track_stock, 1) = 1
      ),
      calc AS (
        SELECT
          base.*,
          (base.sold_qty_n / ${Math.floor(d)}) AS avg_daily_sales,
          CASE
            WHEN (base.sold_qty_n / ${Math.floor(d)}) > 0 THEN (base.current_stock / (base.sold_qty_n / ${Math.floor(d)}))
            ELSE NULL
          END AS days_to_sell_out,
          (base.current_stock * base.purchase_price) AS stock_value
        FROM base
      )
      SELECT
        calc.*,
        CASE
          WHEN calc.days_to_sell_out IS NULL THEN NULL
          WHEN calc.days_to_sell_out <= 14 THEN 'fast'
          WHEN calc.days_to_sell_out <= 45 THEN 'medium'
          ELSE 'slow'
        END AS speed_label
      FROM calc
      ORDER BY
        CASE WHEN calc.days_to_sell_out IS NULL THEN 1 ELSE 0 END ASC,
        calc.days_to_sell_out ASC,
        calc.product_name ASC
    `;

    return this.db.prepare(query).all(sinceExpr);
  }

  /**
   * Reorder suggestions (qayta buyurtma)
   * Global scope (across all warehouses).
   */
  getReorderSuggestions() {
    const viewExists = this._viewExists('v_product_stock');

    const query = `
      WITH base AS (
        SELECT
          p.id AS product_id,
          p.sku AS product_sku,
          p.name AS product_name,
          p.category_id,
          p.unit,
          COALESCE(p.purchase_price, 0) AS purchase_price,
          COALESCE(p.sale_price, 0) AS sale_price,
          COALESCE(p.min_stock_level, 0) AS min_stock_level,
          p.max_stock_level AS max_stock_level,
          ${viewExists ? `COALESCE(vps.stock, 0)` : `(
            SELECT COALESCE(SUM(im.quantity), 0)
            FROM inventory_movements im
            WHERE im.product_id = p.id
          )`} AS current_stock
        FROM products p
        ${viewExists ? `LEFT JOIN v_product_stock vps ON vps.product_id = p.id` : ``}
        WHERE p.is_active = 1 AND COALESCE(p.track_stock, 1) = 1
      )
      SELECT
        base.*,
        COALESCE(base.max_stock_level, base.min_stock_level) AS target_level,
        CASE
          WHEN (COALESCE(base.max_stock_level, base.min_stock_level) - base.current_stock) > 0
            THEN (COALESCE(base.max_stock_level, base.min_stock_level) - base.current_stock)
          ELSE 0
        END AS recommended_order_qty,
        (base.current_stock * base.purchase_price) AS stock_value
      FROM base
      WHERE base.min_stock_level > 0
      ORDER BY
        (base.current_stock <= base.min_stock_level) DESC,
        recommended_order_qty DESC,
        base.product_name ASC
    `;

    return this.db.prepare(query).all();
  }

  /**
   * Rebuild stock_balances from inventory_movements (source of truth).
   */
  rebuildStockBalances() {
    if (!this._hasTable('inventory_movements') || !this._hasTable('stock_balances')) {
      return { rebuilt: false, reason: 'Required tables missing' };
    }

    return this.db.transaction(() => {
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

      this.db.prepare('DELETE FROM stock_balances').run();

      const rows = this.db
        .prepare(
          `
          SELECT
            product_id,
            warehouse_id,
            COALESCE(SUM(quantity), 0) AS quantity,
            MAX(created_at) AS last_movement_at
          FROM inventory_movements
          GROUP BY product_id, warehouse_id
        `
        )
        .all();

      const insert = this.db.prepare(`
        INSERT INTO stock_balances (
          id, product_id, warehouse_id, quantity, last_movement_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of rows) {
        insert.run(
          randomUUID(),
          r.product_id,
          r.warehouse_id,
          Number(r.quantity || 0) || 0,
          r.last_movement_at || now,
          now,
          now
        );
      }

      // Update products.current_stock from inventory_movements
      const totals = this.db
        .prepare(
          `
          SELECT product_id, COALESCE(SUM(quantity), 0) AS total_qty
          FROM inventory_movements
          GROUP BY product_id
        `
        )
        .all();
      const updateProduct = this.db.prepare(
        `UPDATE products SET current_stock = ?, updated_at = ? WHERE id = ?`
      );
      for (const t of totals) {
        updateProduct.run(Number(t.total_qty || 0) || 0, now, t.product_id);
      }

      return { rebuilt: true, rows: rows.length };
    })();
  }

  /**
   * Validate inventory integrity between movements and balances.
   */
  validateInventoryIntegrity() {
    if (!this._hasTable('inventory_movements') || !this._hasTable('stock_balances')) {
      return { ok: false, reason: 'Required tables missing' };
    }

    const allowNegativeRow = this.db.prepare(`SELECT value FROM settings WHERE key = 'allow_negative_stock'`).get();
    const allowNegative = allowNegativeRow?.value === '1';

    const movementRows = this.db
      .prepare(
        `
        SELECT product_id, warehouse_id, COALESCE(SUM(quantity), 0) AS qty
        FROM inventory_movements
        GROUP BY product_id, warehouse_id
      `
      )
      .all();
    const balanceRows = this.db
      .prepare(
        `
        SELECT product_id, warehouse_id, COALESCE(quantity, 0) AS qty
        FROM stock_balances
      `
      )
      .all();

    const movementMap = new Map();
    for (const r of movementRows) {
      const key = `${r.product_id || ''}::${r.warehouse_id || ''}`;
      movementMap.set(key, Number(r.qty || 0) || 0);
    }

    const balanceMap = new Map();
    for (const r of balanceRows) {
      const key = `${r.product_id || ''}::${r.warehouse_id || ''}`;
      balanceMap.set(key, Number(r.qty || 0) || 0);
    }

    const mismatches = [];
    const negativeStocks = [];

    for (const [key, mvQty] of movementMap.entries()) {
      const balQty = balanceMap.get(key);
      if (balQty == null || Math.abs(mvQty - balQty) > 0.0001) {
        const [product_id, warehouse_id] = key.split('::');
        mismatches.push({ product_id, warehouse_id: warehouse_id || null, movements_qty: mvQty, balance_qty: balQty ?? null });
      }
      if (!allowNegative && mvQty < 0) {
        const [product_id, warehouse_id] = key.split('::');
        negativeStocks.push({ product_id, warehouse_id: warehouse_id || null, quantity: mvQty, source: 'movements' });
      }
    }

    for (const [key, balQty] of balanceMap.entries()) {
      if (!movementMap.has(key) && Math.abs(balQty) > 0.0001) {
        const [product_id, warehouse_id] = key.split('::');
        mismatches.push({ product_id, warehouse_id: warehouse_id || null, movements_qty: 0, balance_qty: balQty });
      }
      if (!allowNegative && balQty < 0) {
        const [product_id, warehouse_id] = key.split('::');
        negativeStocks.push({ product_id, warehouse_id: warehouse_id || null, quantity: balQty, source: 'balances' });
      }
    }

    const orphanMovements = this.db
      .prepare(
        `
        SELECT im.id, im.product_id, im.warehouse_id
        FROM inventory_movements im
        LEFT JOIN products p ON p.id = im.product_id
        WHERE p.id IS NULL
      `
      )
      .all();
    const orphanMovementWarehouses = this.db
      .prepare(
        `
        SELECT im.id, im.product_id, im.warehouse_id
        FROM inventory_movements im
        LEFT JOIN warehouses w ON w.id = im.warehouse_id
        WHERE im.warehouse_id IS NOT NULL AND w.id IS NULL
      `
      )
      .all();

    const orphanBalances = this.db
      .prepare(
        `
        SELECT sb.id, sb.product_id, sb.warehouse_id
        FROM stock_balances sb
        LEFT JOIN products p ON p.id = sb.product_id
        WHERE p.id IS NULL
      `
      )
      .all();

    const ok =
      mismatches.length === 0 &&
      negativeStocks.length === 0 &&
      orphanMovements.length === 0 &&
      orphanMovementWarehouses.length === 0 &&
      orphanBalances.length === 0;

    return {
      ok,
      allow_negative: allowNegative,
      mismatches,
      negative_stocks: negativeStocks,
      orphan_movements: orphanMovements,
      orphan_movement_warehouses: orphanMovementWarehouses,
      orphan_balances: orphanBalances,
    };
  }

  /**
   * Product Stock Ledger (Traceability + Margin Analyzer)
   */
  getProductLedger(filters = {}) {
    const productId = filters.product_id || filters.productId;
    if (!productId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'product_id is required');
    }

    const dateFrom = this._ymd(filters.date_from || filters.fromDate);
    const dateTo = this._ymd(filters.date_to || filters.toDate);

    const params = [productId];
    let dateWhere = '';
    if (dateFrom) {
      params.push(dateFrom);
      dateWhere += ` AND date(im.created_at) >= date(?)`;
    }
    if (dateTo) {
      params.push(dateTo);
      dateWhere += ` AND date(im.created_at) <= date(?)`;
    }

    const movements = this.db
      .prepare(
        `
        SELECT
          im.id AS movement_id,
          im.product_id,
          im.warehouse_id,
          im.created_at,
          im.movement_type,
          im.quantity,
          im.reference_type,
          im.reference_id
        FROM inventory_movements im
        WHERE im.product_id = ?
        ${dateWhere}
        ORDER BY datetime(im.created_at) ASC, im.id ASC
      `
      )
      .all(params);

    const openingBalance = dateFrom
      ? Number(
          this.db
            .prepare(
              `
              SELECT COALESCE(SUM(quantity), 0) AS qty
              FROM inventory_movements
              WHERE product_id = ?
                AND date(created_at) < date(?)
            `
            )
            .get(productId, dateFrom)?.qty || 0
        ) || 0
      : 0;

    const warehouseMap = new Map();
    if (this._hasTable('warehouses')) {
      for (const w of this.db.prepare(`SELECT id, name FROM warehouses`).all()) {
        warehouseMap.set(String(w.id), w.name || 'Warehouse');
      }
    }

    const orderIds = [];
    const receiptIds = [];
    const returnIds = [];
    const supplierReturnIds = [];
    const adjustmentIds = [];

    for (const m of movements) {
      const refType = String(m.reference_type || '');
      if (refType === 'order') orderIds.push(m.reference_id);
      if (refType === 'purchase_receipt') receiptIds.push(m.reference_id);
      if (refType === 'return') returnIds.push(m.reference_id);
      if (refType === 'supplier_return') supplierReturnIds.push(m.reference_id);
      if (refType === 'adjustment') adjustmentIds.push(m.reference_id);
    }

    const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
    const uniqOrderIds = uniq(orderIds);
    const uniqReceiptIds = uniq(receiptIds);
    const uniqReturnIds = uniq(returnIds);
    const uniqSupplierReturnIds = uniq(supplierReturnIds);
    const uniqAdjustmentIds = uniq(adjustmentIds);

    const orderMap = new Map();
    const customerMap = new Map();
    if (uniqOrderIds.length && this._hasTable('orders')) {
      const rows = this.db
        .prepare(
          `SELECT id, order_number, customer_id, warehouse_id FROM orders WHERE id IN (${uniqOrderIds
            .map(() => '?')
            .join(',')})`
        )
        .all(...uniqOrderIds);
      for (const r of rows) orderMap.set(String(r.id), r);
      const customerIds = uniq(rows.map((r) => r.customer_id));
      if (customerIds.length && this._hasTable('customers')) {
        const cRows = this.db
          .prepare(`SELECT id, name FROM customers WHERE id IN (${customerIds.map(() => '?').join(',')})`)
          .all(...customerIds);
        for (const c of cRows) customerMap.set(String(c.id), c.name || 'Customer');
      }
    }

    const hasQtyBase = (() => {
      try {
        const cols = this.db.prepare(`PRAGMA table_info(order_items)`).all() || [];
        return cols.some((c) => c.name === 'qty_base');
      } catch {
        return false;
      }
    })();
    const qtyExpr = hasQtyBase ? 'COALESCE(qty_base, quantity)' : 'quantity';

    const orderItemAgg = new Map();
    const orderItemIds = [];
    if (uniqOrderIds.length && this._hasTable('order_items')) {
      const rows = this.db
        .prepare(
          `
          SELECT
            order_id,
            COALESCE(SUM(${qtyExpr}), 0) AS qty,
            COALESCE(SUM(line_total), 0) AS line_total,
            COALESCE(SUM(COALESCE(cost_price, 0) * ${qtyExpr}), 0) AS cost_total,
            SUM(CASE WHEN cost_price IS NULL THEN 1 ELSE 0 END) AS missing_cost_count,
            GROUP_CONCAT(id) AS order_item_ids
          FROM order_items
          WHERE product_id = ?
            AND order_id IN (${uniqOrderIds.map(() => '?').join(',')})
          GROUP BY order_id
        `
        )
        .all(productId, ...uniqOrderIds);
      for (const r of rows) {
        const ids = String(r.order_item_ids || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        ids.forEach((id) => orderItemIds.push(id));
        orderItemAgg.set(String(r.order_id), {
          qty: Number(r.qty || 0) || 0,
          line_total: Number(r.line_total || 0) || 0,
          cost_total: Number(r.cost_total || 0) || 0,
          missing_cost_count: Number(r.missing_cost_count || 0) || 0,
          order_item_ids: ids,
        });
      }
    }

    const allocationsMap = new Map();
    if (orderItemIds.length && this._hasTable('inventory_batch_allocations')) {
      const allocRows = this.db
        .prepare(
          `
          SELECT reference_id, batch_id, quantity, unit_cost
          FROM inventory_batch_allocations
          WHERE reference_type = 'order_item'
            AND reference_id IN (${orderItemIds.map(() => '?').join(',')})
          ORDER BY created_at ASC
        `
        )
        .all(...orderItemIds);
      for (const a of allocRows) {
        const ref = String(a.reference_id);
        const list = allocationsMap.get(ref) || [];
        list.push({
          batch_id: a.batch_id,
          quantity: Number(a.quantity || 0) || 0,
          unit_cost: Number(a.unit_cost || 0) || 0,
          line_cost: (Number(a.quantity || 0) || 0) * (Number(a.unit_cost || 0) || 0),
        });
        allocationsMap.set(ref, list);
      }
    }

    const receiptMap = new Map();
    const supplierMap = new Map();
    if (uniqReceiptIds.length && this._hasTable('purchase_receipts')) {
      const rRows = this.db
        .prepare(
          `SELECT id, receipt_number, supplier_id, warehouse_id FROM purchase_receipts WHERE id IN (${uniqReceiptIds
            .map(() => '?')
            .join(',')})`
        )
        .all(...uniqReceiptIds);
      for (const r of rRows) receiptMap.set(String(r.id), r);
      const supplierIds = uniq(rRows.map((r) => r.supplier_id));
      if (supplierIds.length && this._hasTable('suppliers')) {
        const sRows = this.db
          .prepare(`SELECT id, name FROM suppliers WHERE id IN (${supplierIds.map(() => '?').join(',')})`)
          .all(...supplierIds);
        for (const s of sRows) supplierMap.set(String(s.id), s.name || 'Supplier');
      }
    }

    const receiptItemAgg = new Map();
    if (uniqReceiptIds.length && this._hasTable('purchase_receipt_items')) {
      const rows = this.db
        .prepare(
          `
          SELECT
            receipt_id,
            COALESCE(SUM(received_qty), 0) AS qty,
            COALESCE(SUM(unit_cost * received_qty), 0) AS cost_total
          FROM purchase_receipt_items
          WHERE product_id = ?
            AND receipt_id IN (${uniqReceiptIds.map(() => '?').join(',')})
          GROUP BY receipt_id
        `
        )
        .all(productId, ...uniqReceiptIds);
      for (const r of rows) {
        receiptItemAgg.set(String(r.receipt_id), {
          qty: Number(r.qty || 0) || 0,
          cost_total: Number(r.cost_total || 0) || 0,
        });
      }
    }

    const returnsTable = this._hasTable('sale_returns')
      ? 'sale_returns'
      : this._hasTable('sales_returns')
        ? 'sales_returns'
        : null;
    const returnItemsTable = returnsTable === 'sale_returns' ? 'sale_return_items' : 'return_items';

    const returnMap = new Map();
    if (uniqReturnIds.length && returnsTable) {
      const rRows = this.db
        .prepare(
          `SELECT id, return_number, customer_id, warehouse_id FROM ${returnsTable} WHERE id IN (${uniqReturnIds
            .map(() => '?')
            .join(',')})`
        )
        .all(...uniqReturnIds);
      for (const r of rRows) returnMap.set(String(r.id), r);
      const customerIds = uniq(rRows.map((r) => r.customer_id));
      if (customerIds.length && this._hasTable('customers')) {
        const cRows = this.db
          .prepare(`SELECT id, name FROM customers WHERE id IN (${customerIds.map(() => '?').join(',')})`)
          .all(...customerIds);
        for (const c of cRows) customerMap.set(String(c.id), c.name || 'Customer');
      }
    }

    const returnItemAgg = new Map();
    if (uniqReturnIds.length && returnsTable && this._hasTable(returnItemsTable) && this._hasTable('order_items')) {
      const rows = this.db
        .prepare(
          `
          SELECT
            ri.return_id AS return_id,
            COALESCE(SUM(ri.quantity), 0) AS qty,
            COALESCE(SUM(ri.line_total), 0) AS line_total,
            COALESCE(SUM(COALESCE(oi.cost_price, 0) * ri.quantity), 0) AS cost_total,
            SUM(CASE WHEN oi.cost_price IS NULL THEN 1 ELSE 0 END) AS missing_cost_count
          FROM ${returnItemsTable} ri
          LEFT JOIN order_items oi ON oi.id = ri.order_item_id
          WHERE ri.product_id = ?
            AND ri.return_id IN (${uniqReturnIds.map(() => '?').join(',')})
          GROUP BY ri.return_id
        `
        )
        .all(productId, ...uniqReturnIds);
      for (const r of rows) {
        returnItemAgg.set(String(r.return_id), {
          qty: Number(r.qty || 0) || 0,
          line_total: Number(r.line_total || 0) || 0,
          cost_total: Number(r.cost_total || 0) || 0,
          missing_cost_count: Number(r.missing_cost_count || 0) || 0,
        });
      }
    }

    const supplierReturnMap = new Map();
    if (uniqSupplierReturnIds.length && this._hasTable('supplier_returns')) {
      const rows = this.db
        .prepare(
          `SELECT id, return_number, supplier_id, warehouse_id FROM supplier_returns WHERE id IN (${uniqSupplierReturnIds
            .map(() => '?')
            .join(',')})`
        )
        .all(...uniqSupplierReturnIds);
      for (const r of rows) supplierReturnMap.set(String(r.id), r);
      const supplierIds = uniq(rows.map((r) => r.supplier_id));
      if (supplierIds.length && this._hasTable('suppliers')) {
        const sRows = this.db
          .prepare(`SELECT id, name FROM suppliers WHERE id IN (${supplierIds.map(() => '?').join(',')})`)
          .all(...supplierIds);
        for (const s of sRows) supplierMap.set(String(s.id), s.name || 'Supplier');
      }
    }

    const supplierReturnItemAgg = new Map();
    if (uniqSupplierReturnIds.length && this._hasTable('supplier_return_items')) {
      const rows = this.db
        .prepare(
          `
          SELECT
            return_id,
            COALESCE(SUM(quantity), 0) AS qty,
            COALESCE(SUM(unit_cost * quantity), 0) AS cost_total
          FROM supplier_return_items
          WHERE product_id = ?
            AND return_id IN (${uniqSupplierReturnIds.map(() => '?').join(',')})
          GROUP BY return_id
        `
        )
        .all(productId, ...uniqSupplierReturnIds);
      for (const r of rows) {
        supplierReturnItemAgg.set(String(r.return_id), {
          qty: Number(r.qty || 0) || 0,
          cost_total: Number(r.cost_total || 0) || 0,
        });
      }
    }

    const adjustmentMap = new Map();
    if (uniqAdjustmentIds.length && this._hasTable('inventory_adjustments')) {
      const rows = this.db
        .prepare(
          `SELECT id, adjustment_number, warehouse_id, reason FROM inventory_adjustments WHERE id IN (${uniqAdjustmentIds
            .map(() => '?')
            .join(',')})`
        )
        .all(...uniqAdjustmentIds);
      for (const r of rows) adjustmentMap.set(String(r.id), r);
    }

    let running = openingBalance;
    let totalIn = 0;
    let totalOut = 0;
    let totalMargin = 0;
    let missingCostCount = 0;
    let negativeMarginCount = 0;
    let negativeBalanceCount = 0;

    const rows = movements.map((m) => {
      const qty = Number(m.quantity || 0) || 0;
      const qtyIn = qty > 0 ? qty : 0;
      const qtyOut = qty < 0 ? Math.abs(qty) : 0;
      totalIn += qtyIn;
      totalOut += qtyOut;

      const refType = String(m.reference_type || '');
      const refId = String(m.reference_id || '');
      let documentNo = null;
      let fromName = null;
      let toName = null;
      let unitPrice = null;
      let costPrice = null;
      let allocations = [];

      if (refType === 'order') {
        const order = orderMap.get(refId);
        documentNo = order?.order_number || null;
        const whName = warehouseMap.get(String(order?.warehouse_id || m.warehouse_id)) || 'Warehouse';
        const customerName = order?.customer_id ? (customerMap.get(String(order.customer_id)) || 'Customer') : 'Walk-in';
        fromName = whName;
        toName = customerName;
        const agg = orderItemAgg.get(refId);
        if (agg && agg.qty > 0) {
          unitPrice = agg.line_total > 0 ? agg.line_total / agg.qty : null;
          if (agg.missing_cost_count > 0) {
            costPrice = null;
          } else {
            costPrice = agg.cost_total / agg.qty;
          }
          if (agg.order_item_ids?.length) {
            for (const oid of agg.order_item_ids) {
              const allocs = allocationsMap.get(oid);
              if (allocs && allocs.length) allocations = allocations.concat(allocs);
            }
          }
        }
      } else if (refType === 'purchase_receipt') {
        const receipt = receiptMap.get(refId);
        documentNo = receipt?.receipt_number || null;
        const whName = warehouseMap.get(String(receipt?.warehouse_id || m.warehouse_id)) || 'Warehouse';
        fromName = supplierMap.get(String(receipt?.supplier_id || '')) || 'Supplier';
        toName = whName;
        const agg = receiptItemAgg.get(refId);
        if (agg && agg.qty > 0) {
          costPrice = agg.cost_total / agg.qty;
        }
      } else if (refType === 'return') {
        const ret = returnMap.get(refId);
        documentNo = ret?.return_number || null;
        const whName = warehouseMap.get(String(ret?.warehouse_id || m.warehouse_id)) || 'Warehouse';
        fromName = ret?.customer_id ? (customerMap.get(String(ret.customer_id)) || 'Customer') : 'Walk-in';
        toName = whName;
        const agg = returnItemAgg.get(refId);
        if (agg && agg.qty > 0) {
          unitPrice = agg.line_total > 0 ? agg.line_total / agg.qty : null;
          if (agg.missing_cost_count > 0) {
            costPrice = null;
          } else {
            costPrice = agg.cost_total / agg.qty;
          }
        }
      } else if (refType === 'supplier_return') {
        const ret = supplierReturnMap.get(refId);
        documentNo = ret?.return_number || null;
        const whName = warehouseMap.get(String(ret?.warehouse_id || m.warehouse_id)) || 'Warehouse';
        fromName = whName;
        toName = supplierMap.get(String(ret?.supplier_id || '')) || 'Supplier';
        const agg = supplierReturnItemAgg.get(refId);
        if (agg && agg.qty > 0) {
          costPrice = agg.cost_total / agg.qty;
        }
      } else if (refType === 'adjustment') {
        const adj = adjustmentMap.get(refId);
        documentNo = adj?.adjustment_number || null;
        const whName = warehouseMap.get(String(adj?.warehouse_id || m.warehouse_id)) || 'Warehouse';
        if (qtyIn > 0) {
          fromName = 'System';
          toName = whName;
        } else {
          fromName = whName;
          toName = 'System';
        }
      } else {
        const whName = warehouseMap.get(String(m.warehouse_id || '')) || 'Warehouse';
        if (qtyIn > 0) {
          fromName = 'System';
          toName = whName;
        } else if (qtyOut > 0) {
          fromName = whName;
          toName = 'System';
        }
      }

      let margin = 0;
      if (qtyOut > 0 && unitPrice != null && costPrice != null) {
        margin = (Number(unitPrice) - Number(costPrice)) * qtyOut;
      }
      if (qtyOut > 0 && costPrice == null) {
        missingCostCount += 1;
      }
      if (qtyOut > 0 && margin < 0) {
        negativeMarginCount += 1;
      }

      running += qtyIn - qtyOut;
      if (running < 0) negativeBalanceCount += 1;
      totalMargin += margin;

      return {
        movement_id: m.movement_id,
        product_id: m.product_id,
        created_at: m.created_at,
        movement_type: m.movement_type,
        qty_in: qtyIn,
        qty_out: qtyOut,
        reference_type: m.reference_type,
        reference_id: m.reference_id,
        document_no: documentNo,
        from_name: fromName,
        to_name: toName,
        unit_price: unitPrice == null ? null : Number(unitPrice || 0) || 0,
        cost_price: costPrice == null ? null : Number(costPrice || 0) || 0,
        margin: Number(margin || 0) || 0,
        running_balance: Number(running || 0) || 0,
        allocations,
      };
    });

    return {
      product_id: productId,
      period: { date_from: dateFrom, date_to: dateTo },
      opening_balance: openingBalance,
      summary: {
        total_in: Number(totalIn || 0) || 0,
        total_out: Number(totalOut || 0) || 0,
        ending_balance: Number(running || 0) || 0,
        total_margin: Number(totalMargin || 0) || 0,
        missing_cost_count: missingCostCount,
        negative_margin_count: negativeMarginCount,
        negative_balance_count: negativeBalanceCount,
      },
      rows,
    };
  }
}

module.exports = InventoryService;


