const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Returns Service
 * Handles sale returns and refunds
 * BULLETPROOF: Uses hardcoded safe IDs to prevent FK constraint errors
 */
class ReturnsService {
  constructor(db, inventoryService, batchService = null) {
    this.db = db;
    this.inventoryService = inventoryService;
    this.batchService = batchService;
    this._returnItemCols = null;
    this._salesReturnCols = null;
  }

  _getReturnItemCols() {
    if (this._returnItemCols) return this._returnItemCols;
    try {
      const cols = this.db.prepare(`PRAGMA table_info(return_items)`).all() || [];
      this._returnItemCols = new Set(cols.map((c) => c.name));
    } catch {
      this._returnItemCols = new Set();
    }
    return this._returnItemCols;
  }

  _hasReturnItemCol(name) {
    return this._getReturnItemCols().has(name);
  }

  _getOrderItemCols() {
    if (this._orderItemCols) return this._orderItemCols;
    try {
      const cols = this.db.prepare(`PRAGMA table_info(order_items)`).all() || [];
      this._orderItemCols = new Set(cols.map((c) => c.name));
    } catch {
      this._orderItemCols = new Set();
    }
    return this._orderItemCols;
  }

  _hasOrderItemCol(name) {
    return this._getOrderItemCols().has(name);
  }

  _getSalesReturnCols() {
    if (this._salesReturnCols) return this._salesReturnCols;
    try {
      const cols = this.db.prepare(`PRAGMA table_info(sales_returns)`).all() || [];
      this._salesReturnCols = new Set(cols.map((c) => c.name));
    } catch {
      this._salesReturnCols = new Set();
    }
    return this._salesReturnCols;
  }

  _hasSalesReturnCol(name) {
    return this._getSalesReturnCols().has(name);
  }

  _normalizeRefundMethod(method) {
    return method === 'customer_account' ? 'customer_account' : method === 'credit' ? 'credit' : method || 'cash';
  }

  _isCustomerAccountRefund(method) {
    return method === 'credit' || method === 'customer_account';
  }

  _applyCustomerRefund(customerId, refundAmount, meta = {}) {
    if (!customerId || !Number(refundAmount || 0)) return null;
    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) return null;

    const amount = Number(refundAmount || 0);
    const oldBalance = Number(customer.balance || 0);
    const newBalance = oldBalance + amount;

    this.db.prepare(`
      UPDATE customers
      SET balance = ?
      WHERE id = ?
    `).run(newBalance, customerId);

    try {
      const tableExists = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='customer_ledger'
      `).get();

      if (tableExists) {
        const tableInfo = this.db.prepare(`PRAGMA table_info(customer_ledger)`).all();
        const hasMethodColumn = tableInfo.some((col) => col.name === 'method');
        const ledgerId = randomUUID();
        const ledgerNote =
          meta.note ||
          `Qaytarish hisobga yozildi: ${meta.returnNumber || meta.returnId || ''} (${amount} so'm)`;

        if (hasMethodColumn) {
          this.db.prepare(`
            INSERT INTO customer_ledger (
              id, customer_id, type, ref_id, ref_no, amount, balance_after, note, method, created_at, created_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            ledgerId,
            customerId,
            'refund',
            meta.returnId || null,
            meta.returnNumber || null,
            amount,
            newBalance,
            ledgerNote,
            meta.method || 'customer_account',
            meta.createdAt || new Date().toISOString(),
            meta.createdBy || null
          );
        } else {
          this.db.prepare(`
            INSERT INTO customer_ledger (
              id, customer_id, type, ref_id, ref_no, amount, balance_after, note, created_at, created_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            ledgerId,
            customerId,
            'refund',
            meta.returnId || null,
            meta.returnNumber || null,
            amount,
            newBalance,
            ledgerNote,
            meta.createdAt || new Date().toISOString(),
            meta.createdBy || null
          );
        }
      }
    } catch (ledgerError) {
      console.error('❌ Failed to insert ledger entry for refund (non-critical):', ledgerError.message);
    }

    return { customer, oldBalance, newBalance };
  }

  /**
   * Create return for an order
   * BULLETPROOF: Hardcoded safe IDs, comprehensive error handling
   */
  createReturn(data) {
    if (data?.mode === 'manual' || !data?.order_id) {
      return this.createManualReturn(data);
    }

    // Hardcode Safe IDs immediately
    const SAFE_ADMIN_ID = 'default-admin-001';
    // SINGLE WAREHOUSE SYSTEM: use the seeded warehouse from migration 013_ensure_seed_data.sql
    const SAFE_WAREHOUSE_ID = 'main-warehouse-001';
    
    // Detailed Debugging: Log incoming payload
    console.log('🔄 Processing Return Payload:', JSON.stringify(data, null, 2));
    data.refund_method = this._normalizeRefundMethod(data.refund_method);
    
    // Validation
    if (!data.order_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order ID is required');
    }

    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Return items are required');
    }

    if (!data.return_reason || !data.return_reason.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Return reason is required');
    }

    try {
      return this.db.transaction(() => {
        // --------------------------------------------------------------------
        // FK SAFETY (bulletproof):
        // Some DBs enforce FKs on user_id / warehouse_id / shift_id in returns tables.
        // If the incoming IDs (or the order's shift_id/warehouse_id) don't exist,
        // SQLite will throw SQLITE_CONSTRAINT_FOREIGNKEY at the return INSERT.
        // We proactively resolve valid IDs from the DB.
        // --------------------------------------------------------------------
        const resolveSafeUserId = () => {
          // Prefer seeded admin id, then admin username, then any user.
          const byId = this.db.prepare('SELECT id FROM users WHERE id = ?').get(SAFE_ADMIN_ID);
          if (byId?.id) return String(byId.id);
          const byUsername = this.db.prepare("SELECT id FROM users WHERE username = 'admin@pos.com' LIMIT 1").get();
          if (byUsername?.id) return String(byUsername.id);
          const anyUser = this.db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
          if (anyUser?.id) return String(anyUser.id);
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'No users exist in DB. Cannot create return.');
        };

        const resolveSafeWarehouseId = () => {
          // Prefer seeded main warehouse id, then any active warehouse.
          const byId = this.db.prepare('SELECT id FROM warehouses WHERE id = ?').get(SAFE_WAREHOUSE_ID);
          if (byId?.id) return String(byId.id);
          const anyWh = this.db.prepare('SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1').get();
          if (anyWh?.id) return String(anyWh.id);
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'No warehouses exist in DB. Cannot create return.');
        };

        // Step 1: Check if order_id exists
        console.log(`🔍 Step 1: Validating order_id=${data.order_id}`);
        const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(data.order_id);
        if (!order) {
          const error = createError(ERROR_CODES.NOT_FOUND, `Order ${data.order_id} not found`);
          console.error('❌ Step 1 FAILED:', error);
          throw error;
        }
        console.log(`✅ Step 1: Order found - ${order.order_number} (${order.id})`);

        // Resolve warehouse_id (single warehouse mode)
        // IMPORTANT: Always use a warehouse that is guaranteed to exist in DB.
        // Some installations enforce FK(warehouse_id) on sales_returns and orders may have NULL/old warehouse_id.
        const warehouseId = resolveSafeWarehouseId();

        // CRITICAL FIX: Step 2 - Validate ALL items FIRST before inserting return record
        // This prevents orphan return records when validation fails
        console.log(`🔍 Step 2: Validating ALL return items BEFORE creating return record`);
        let totalAmount = 0;
        const validatedItems = [];

        // Load all order items to compute proportional order-level discount allocation
        const orderItemCols = ['id', 'unit_price', 'quantity', 'discount_amount', 'line_total'];
        if (this._hasOrderItemCol('qty_sale')) orderItemCols.push('qty_sale');
        if (this._hasOrderItemCol('qty_base')) orderItemCols.push('qty_base');
        if (this._hasOrderItemCol('sale_unit')) orderItemCols.push('sale_unit');
        if (this._hasOrderItemCol('base_price')) orderItemCols.push('base_price');
        if (this._hasOrderItemCol('usta_price')) orderItemCols.push('usta_price');
        if (this._hasOrderItemCol('discount_type')) orderItemCols.push('discount_type');
        if (this._hasOrderItemCol('discount_value')) orderItemCols.push('discount_value');
        if (this._hasOrderItemCol('final_unit_price')) orderItemCols.push('final_unit_price');
        if (this._hasOrderItemCol('final_total')) orderItemCols.push('final_total');
        if (this._hasOrderItemCol('price_source')) orderItemCols.push('price_source');
        const orderItemsAll = this.db
          .prepare(
            `
            SELECT ${orderItemCols.join(', ')}
            FROM order_items
            WHERE order_id = ?
          `
          )
          .all(data.order_id);
        const preDiscountTotal = orderItemsAll.reduce(
          (sum, it) => {
            const qtySale = Number(it.qty_sale ?? it.quantity ?? 0) || 0;
            return sum + (Number(it.unit_price || 0) * qtySale);
          },
          0
        );
        const orderDiscount = Number(order.discount_amount || 0) || 0;
        
        for (let i = 0; i < data.items.length; i++) {
          const item = data.items[i];
          console.log(`🔍 Step 2.${i + 1}: Validating item ${i + 1}/${data.items.length} - order_item_id=${item.order_item_id}, quantity=${item.quantity}`);

          // Basic validation
          if (!item.order_item_id || !item.quantity || item.quantity <= 0) {
            const error = createError(ERROR_CODES.VALIDATION_ERROR, 
              `Item ${i + 1}: Order item ID and quantity are required`);
            console.error(`❌ Step 2.${i + 1} FAILED:`, error);
            throw error;
          }

          // Validate order item belongs to the order
          const orderItem = this.db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(
            item.order_item_id,
            data.order_id
          );

          if (!orderItem) {
            const error = createError(ERROR_CODES.NOT_FOUND, 
              `Order item ${item.order_item_id} not found or does not belong to order ${data.order_id}`);
            console.error(`❌ Step 2.${i + 1} FAILED:`, error);
            throw error;
          }

          // CRITICAL: Validate return quantity doesn't exceed available quantity
          const currentReturnedQty = Number(orderItem.returned_quantity || 0);
          const originalQty = Number(orderItem.qty_sale ?? orderItem.quantity ?? 0);
          const availableQty = originalQty - currentReturnedQty;
          const returnQty = Number(item.quantity || 0);

          console.log(`[RETURNS] Step 2.${i + 1}: Return quantity validation:`, {
            order_item_id: item.order_item_id,
            original_quantity: originalQty,
            current_returned_quantity: currentReturnedQty,
            available_quantity: availableQty,
            requested_return_quantity: returnQty,
          });

          if (returnQty > availableQty) {
            const error = createError(ERROR_CODES.VALIDATION_ERROR,
              `Cannot return ${returnQty} items. Only ${availableQty} available (original: ${originalQty}, already returned: ${currentReturnedQty})`);
            console.error(`❌ Step 2.${i + 1} FAILED:`, error);
            throw error; // This will rollback the entire transaction
          }

          // Validate product exists
          const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(orderItem.product_id);
          if (!product) {
            const error = createError(ERROR_CODES.NOT_FOUND, `Product ${orderItem.product_id} not found`);
            console.error(`❌ Step 2.${i + 1} FAILED:`, error);
            throw error;
          }

          // Calculate net refundable amount (item discounts + proportional order discount)
          const soldQty = Number(orderItem.qty_sale ?? orderItem.quantity ?? 0);
          const unitPrice = Number(orderItem.unit_price || 0);
          const qtyBaseSold = Number(orderItem.qty_base ?? soldQty) || 0;
          const ratioToBase = soldQty > 0 ? qtyBaseSold / soldQty : 1;
          const hasFinalUnitPrice = this._hasOrderItemCol('final_unit_price');
          const hasFinalTotal = this._hasOrderItemCol('final_total');
          const finalUnitPrice = hasFinalUnitPrice ? Number(orderItem.final_unit_price || 0) : 0;
          const finalLineTotal = hasFinalTotal ? Number(orderItem.final_total || 0) : 0;
          let netUnitPrice = unitPrice;
          let lineTotal = 0;

          if (finalUnitPrice > 0) {
            netUnitPrice = finalUnitPrice;
            lineTotal = netUnitPrice * returnQty;
          } else {
            const itemLineTotal =
              Number(orderItem.line_total || 0) ||
              (unitPrice * soldQty - Number(orderItem.discount_amount || 0));
            const preDiscountLine = unitPrice * soldQty;
            const orderDiscountShare =
              orderDiscount > 0 && preDiscountTotal > 0 ? (preDiscountLine / preDiscountTotal) * orderDiscount : 0;
            const netLineTotal = Math.max(0, itemLineTotal - orderDiscountShare);
            netUnitPrice = soldQty > 0 ? netLineTotal / soldQty : unitPrice;
            lineTotal = netUnitPrice * returnQty;
          }
          const saleUnit = orderItem.sale_unit ?? orderItem.unit ?? product.unit ?? null;
          const returnQtyBase = returnQty * ratioToBase;
          totalAmount += lineTotal;

          // Store validated item for later processing
          validatedItems.push({
            item,
            orderItem,
            product,
            returnQty,
            returnQtyBase,
            saleUnit,
            ratioToBase,
            lineTotal,
            netUnitPrice,
            finalUnitPrice: finalUnitPrice > 0 ? finalUnitPrice : null,
            finalLineTotal: finalLineTotal > 0 ? finalLineTotal : null,
            basePrice: orderItem.base_price ?? null,
            ustaPrice: orderItem.usta_price ?? null,
            discountType: orderItem.discount_type ?? null,
            discountValue: orderItem.discount_value ?? null,
            priceSource: orderItem.price_source ?? null,
            currentReturnedQty,
            originalQty,
            availableQty,
          });
        }

        console.log(`✅ Step 2: All ${validatedItems.length} items validated successfully. Total amount: ${totalAmount}`);

        // Step 3: Determine cashier_id/user_id safely (must exist if FK is enforced)
        // IMPORTANT: Always use a user id that is guaranteed to exist.
        // Orders may contain legacy cashier_id/user_id values that don't exist anymore after wipes/migrations.
        const safeUserId = resolveSafeUserId();
        const cashierId = safeUserId;
        const userId = safeUserId;
        
        // Final validation: ensure cashier_id is never null/undefined
        if (!cashierId || cashierId.trim() === '') {
          const error = createError(ERROR_CODES.VALIDATION_ERROR, 
            'cashier_id is required but could not be determined. Order has no cashier_id and no user_id provided.');
          console.error('❌ Step 3 FAILED (cashier_id validation):', {
            order_id: data.order_id,
            order_cashier_id: order.cashier_id,
            data_user_id: data.user_id,
            data_cashier_id: data.cashier_id,
          });
          throw error;
        }
        
        console.log(`📝 Step 3: Using cashier_id=${cashierId}, user_id=${userId} for return`);

        // Resolve customer_id safely (customer can be deleted/wiped, while order still has customer_id)
        let customerId = order.customer_id || null;
        if (customerId) {
          try {
            const ok = this.db.prepare('SELECT id FROM customers WHERE id = ?').get(String(customerId));
            if (!ok?.id) customerId = null;
          } catch {
            // If customers table doesn't exist or query fails, don't block return creation.
            customerId = null;
          }
        }

        // Step 4: Insert Return Record (ONLY after all validations pass)
        const returnId = randomUUID();
        const returnNumber = `RET-${Date.now()}`;
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
        // Clean cutover rule: only enforce batch returns if the ORIGINAL SALE (order.created_at)
        // is on/after cutover. Pre-cutover sales have no allocations and should still be returnable.
        const orderCreatedAtSql = String(order.created_at || '').replace('T', ' ').replace('Z', '').substring(0, 19);
        const batchActive =
          !!this.batchService?.shouldEnforceAt?.(now) && !!this.batchService?.shouldEnforceAt?.(orderCreatedAtSql);

        // If the order's shift_id is orphaned (shift deleted), set it to NULL to avoid FK failures.
        let shiftId = order.shift_id || null;
        if (shiftId) {
          try {
            const ok = this.db.prepare('SELECT id FROM shifts WHERE id = ?').get(String(shiftId));
            if (!ok?.id) shiftId = null;
          } catch {
            // If shifts table doesn't exist or query fails, don't block return creation.
            shiftId = null;
          }
        }

        console.log(`📝 Step 4: Inserting return record - ${returnNumber} (${returnId})`);
        try {
          const hasReturnMode = this._hasSalesReturnCol('return_mode');
          const cols = [
            'id',
            'return_number',
            'order_id',
            'customer_id',
            'cashier_id',
            'user_id',
            'warehouse_id',
            'shift_id',
            'return_reason',
            'total_amount',
            'refund_amount',
            'refund_method',
            ...(hasReturnMode ? ['return_mode'] : []),
            'status',
            'notes',
            'created_at',
          ];
          const vals = [
            returnId,
            returnNumber,
            data.order_id,
            customerId,
            cashierId,
            userId,
            warehouseId,
            shiftId,
            data.return_reason.trim(),
            totalAmount,
            totalAmount,
            data.refund_method || 'cash',
            ...(hasReturnMode ? ['order'] : []),
            'completed',
            data.notes || null,
            now,
          ];
          const placeholders = cols.map(() => '?').join(', ');
          this.db.prepare(`
            INSERT INTO sales_returns (${cols.join(', ')})
            VALUES (${placeholders})
          `).run(...vals);
          console.log(`✅ Step 4: Return record inserted successfully with cashier_id=${cashierId}`);
        } catch (step4Error) {
          console.error('❌ Step 4 FAILED (Insert Return):', {
            message: step4Error.message,
            code: step4Error.code,
            stack: step4Error.stack,
            returnId,
            returnNumber,
            order_id: data.order_id,
            cashier_id: cashierId,
            user_id: userId,
            warehouse_id: warehouseId,
            shift_id: shiftId,
            customer_id: customerId,
          });
          throw step4Error;
        }

        // Step 5: Insert Return Items (using pre-validated items)
        console.log(`📦 Step 5: Processing ${validatedItems.length} validated return items`);
        const returnItems = [];
        
        for (let i = 0; i < validatedItems.length; i++) {
          const {
            item,
            orderItem,
            product,
            returnQty,
            returnQtyBase,
            saleUnit,
            lineTotal,
            netUnitPrice,
            currentReturnedQty,
            basePrice,
            ustaPrice,
            discountType,
            discountValue,
            priceSource,
          } = validatedItems[i];
          console.log(`📦 Step 5.${i + 1}: Processing validated item ${i + 1}/${validatedItems.length} - order_item_id=${item.order_item_id}, quantity=${returnQty}`);

          // Insert return item
          const returnItemId = randomUUID();
          try {
            const hasSaleUnit = this._hasReturnItemCol('sale_unit');
            const hasQtySale = this._hasReturnItemCol('qty_sale');
            const hasQtyBase = this._hasReturnItemCol('qty_base');
            const hasBasePrice = this._hasReturnItemCol('base_price');
            const hasUstaPrice = this._hasReturnItemCol('usta_price');
            const hasDiscountType = this._hasReturnItemCol('discount_type');
            const hasDiscountValue = this._hasReturnItemCol('discount_value');
            const hasFinalUnitPrice = this._hasReturnItemCol('final_unit_price');
            const hasFinalTotal = this._hasReturnItemCol('final_total');
            const hasPriceSource = this._hasReturnItemCol('price_source');
            const cols = [
              'id',
              'return_id',
              'order_item_id',
              'product_id',
              'product_name',
              'quantity',
              'unit_price',
              'line_total',
              'created_at',
              ...(hasSaleUnit ? ['sale_unit'] : []),
              ...(hasQtySale ? ['qty_sale'] : []),
              ...(hasQtyBase ? ['qty_base'] : []),
              ...(hasBasePrice ? ['base_price'] : []),
              ...(hasUstaPrice ? ['usta_price'] : []),
              ...(hasDiscountType ? ['discount_type'] : []),
              ...(hasDiscountValue ? ['discount_value'] : []),
              ...(hasFinalUnitPrice ? ['final_unit_price'] : []),
              ...(hasFinalTotal ? ['final_total'] : []),
              ...(hasPriceSource ? ['price_source'] : []),
            ];
            const vals = [
              returnItemId,
              returnId,
              item.order_item_id,
              orderItem.product_id,
              orderItem.product_name || product.name,
              returnQty,
              netUnitPrice,
              lineTotal,
              now,
              ...(hasSaleUnit ? [saleUnit] : []),
              ...(hasQtySale ? [returnQty] : []),
              ...(hasQtyBase ? [returnQtyBase] : []),
              ...(hasBasePrice ? [basePrice ?? null] : []),
              ...(hasUstaPrice ? [ustaPrice ?? null] : []),
              ...(hasDiscountType ? [discountType ?? null] : []),
              ...(hasDiscountValue ? [discountValue ?? 0] : []),
              ...(hasFinalUnitPrice ? [netUnitPrice] : []),
              ...(hasFinalTotal ? [lineTotal] : []),
              ...(hasPriceSource ? [priceSource ?? null] : []),
            ];
            const placeholders = cols.map(() => '?').join(', ');
            this.db
              .prepare(`INSERT INTO return_items (${cols.join(', ')}) VALUES (${placeholders})`)
              .run(...vals);
            console.log(`✅ Step 5.${i + 1}: Return item inserted - ${returnItemId}`);

            // CRITICAL: Update order_items.returned_quantity
            const newReturnedQty = currentReturnedQty + returnQty;
            this.db.prepare(`
              UPDATE order_items 
              SET returned_quantity = ?
              WHERE id = ? AND order_id = ?
            `).run(newReturnedQty, item.order_item_id, data.order_id);
            
            console.log(`✅ Step 5.${i + 1}: Updated order_items.returned_quantity: ${currentReturnedQty} -> ${newReturnedQty}`);

            returnItems.push({
              id: returnItemId,
              order_item_id: item.order_item_id,
              product_id: orderItem.product_id,
              quantity: returnQty, // Use validated returnQty
              unit_price: netUnitPrice,
              line_total: lineTotal
            });
          } catch (step5Error) {
            console.error(`❌ Step 5.${i + 1} FAILED (Insert Return Item):`, {
              message: step5Error.message,
              code: step5Error.code,
              stack: step5Error.stack,
              returnItemId,
              return_id: returnId,
              order_item_id: item.order_item_id,
              product_id: orderItem.product_id
            });
            throw step5Error;
          }

          // Batch mode: return must go back to the SAME batches that were used for this order_item.
          if (batchActive && this.batchService && product.track_stock) {
            this.batchService.allocateReturnForReturnItem(
              returnItemId,
              item.order_item_id,
              orderItem.product_id,
              warehouseId,
              returnQtyBase
            );
          }

          // Step 6: Update Inventory
          if (product.track_stock) {
            console.log(`📈 Step 6.${i + 1}: Updating inventory for product_id=${orderItem.product_id}, quantity=${returnQty}`);
            
            try {
              if (!this.inventoryService) {
                throw createError(ERROR_CODES.VALIDATION_ERROR, 'InventoryService is not available. Cannot update stock.');
              }

              // SINGLE SOURCE OF TRUTH: inventory_movements
              // Use InventoryService._updateBalance so both inventory_movements and legacy stock_balances/stock_moves stay consistent
              const stockUpdate = this.inventoryService._updateBalance(
                orderItem.product_id,
                warehouseId,
                returnQtyBase,
                'return',
                'return',
                returnId,
                `Return for order ${order.order_number}`,
                userId || SAFE_ADMIN_ID
              );
              
              console.log(`✅ Step 6.${i + 1}: Inventory updated via InventoryService: ${stockUpdate.beforeQuantity} -> ${stockUpdate.afterQuantity}`);
            } catch (step6Error) {
              console.error(`❌ Step 6.${i + 1} FAILED (Update Inventory):`, {
                message: step6Error.message,
                code: step6Error.code,
                stack: step6Error.stack,
                product_id: orderItem.product_id,
                warehouse_id: warehouseId,
                quantity: returnQty
              });
              throw step6Error;
            }
          } else {
            console.log(`⚠️ Step 6.${i + 1}: Product ${product.name} does not track stock, skipping inventory update`);
          }
        }

        // Update return record with calculated totals
        const refundAmount = totalAmount;
        try {
          this.db.prepare(`
            UPDATE sales_returns 
            SET total_amount = ?, refund_amount = ?
            WHERE id = ?
          `).run(totalAmount, refundAmount, returnId);
          console.log(`✅ Updated return totals: total_amount=${totalAmount}, refund_amount=${refundAmount}`);
        } catch (updateError) {
          console.error('❌ Failed to update return totals:', {
            message: updateError.message,
            code: updateError.code,
            returnId,
            totalAmount,
            refundAmount
          });
          throw updateError;
        }

        // Customer balance (system convention: negative = debt, see salesService.finalizeOrder).
        // - Refund to customer_account/credit: adjust balance (existing behaviour).
        // - Refund cash/card on an order that had unpaid credit (credit sale): must also reduce debt;
        //   otherwise qarz ayrilmaydi (bug) when user picks naqd/karta in the return form.
        const creditOnOrder = Number(order.credit_amount || 0);
        const ps = String(order.payment_status || '').toLowerCase();
        // `credit_amount` is authoritative; `on_credit` matches finalizeOrder when customer owes the remainder.
        const orderHadUnpaidCredit = creditOnOrder > 0.009 || ps === 'on_credit';
        const shouldAdjustBalance =
          customerId &&
          String(customerId) !== 'default-customer-001' &&
          refundAmount > 0 &&
          (this._isCustomerAccountRefund(data.refund_method) || orderHadUnpaidCredit);

        if (shouldAdjustBalance) {
          try {
            const balanceResult = this._applyCustomerRefund(customerId, refundAmount, {
              returnId,
              returnNumber,
              method: data.refund_method || 'customer_account',
              createdAt: now,
              createdBy: cashierId || userId || null,
              note:
                orderHadUnpaidCredit && !this._isCustomerAccountRefund(data.refund_method)
                  ? `Qaytarish — qarz kamaytirildi: ${returnNumber} (${refundAmount} so'm, ${data.refund_method || 'cash'})`
                  : undefined,
            });
            if (balanceResult) {
              console.log(
                `👥 Updated customer balance: ${balanceResult.customer.name} - ${balanceResult.oldBalance} -> ${balanceResult.newBalance} (refund: ${refundAmount}, method=${data.refund_method}, hadCreditOrder=${orderHadUnpaidCredit})`
              );
            }
          } catch (customerError) {
            console.warn('⚠️ Failed to update customer balance (non-critical):', customerError.message);
          }
        }

        console.log(`✅ Return transaction completed successfully: ${returnNumber} (${returnId})`);
        console.log(`📊 Return Summary: Total=${totalAmount}, Refund=${refundAmount}, Items=${returnItems.length}`);

        return {
          id: returnId,
          return_number: returnNumber,
          order_id: data.order_id,
          customer_id: customerId,
          return_reason: data.return_reason.trim(),
          total_amount: totalAmount,
          refund_amount: refundAmount,
          refund_method: data.refund_method || 'cash',
          return_mode: 'order',
          status: 'completed',
          notes: data.notes || null,
          items: returnItems,
          created_at: now
        };
      })();
    } catch (error) {
      // Error Handling: Log FULL error object
      console.error('❌ Return transaction FAILED:', {
        message: error.message,
        code: error.code,
        name: error.name,
        stack: error.stack,
        fullError: error
      });
      console.error('❌ Return Payload that failed:', JSON.stringify(data, null, 2));
      throw error;
    }
  }

  /**
   * Create return without an original order
   */
  createManualReturn(data) {
    const SAFE_ADMIN_ID = 'default-admin-001';
    const SAFE_WAREHOUSE_ID = 'main-warehouse-001';

    console.log('🔄 Processing Manual Return Payload:', JSON.stringify(data, null, 2));

    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Return items are required');
    }

    if (!data.return_reason || !data.return_reason.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Return reason is required');
    }

    const refundMethod = this._normalizeRefundMethod(data.refund_method);
    if (this._isCustomerAccountRefund(refundMethod) && !data.customer_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer is required for customer account refunds');
    }

    return this.db.transaction(() => {
      const resolveSafeUserId = () => {
        const byId = this.db.prepare('SELECT id FROM users WHERE id = ?').get(SAFE_ADMIN_ID);
        if (byId?.id) return String(byId.id);
        const byUsername = this.db.prepare("SELECT id FROM users WHERE username = 'admin@pos.com' LIMIT 1").get();
        if (byUsername?.id) return String(byUsername.id);
        const anyUser = this.db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
        if (anyUser?.id) return String(anyUser.id);
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'No users exist in DB. Cannot create return.');
      };

      const resolveSafeWarehouseId = () => {
        const byId = this.db.prepare('SELECT id FROM warehouses WHERE id = ?').get(SAFE_WAREHOUSE_ID);
        if (byId?.id) return String(byId.id);
        const anyWh = this.db.prepare('SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1').get();
        if (anyWh?.id) return String(anyWh.id);
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'No warehouses exist in DB. Cannot create return.');
      };

      const cashierId = resolveSafeUserId();
      const userId = cashierId;
      const warehouseId = resolveSafeWarehouseId();
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      const returnId = randomUUID();
      const returnNumber = `RET-${Date.now()}`;

      let customerId = data.customer_id || null;
      if (customerId) {
        const customer = this.db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
        if (!customer?.id) {
          throw createError(ERROR_CODES.NOT_FOUND, `Customer ${customerId} not found`);
        }
      }

      let totalAmount = 0;
      const validatedItems = [];

      for (let i = 0; i < data.items.length; i += 1) {
        const item = data.items[i];
        const productId = String(item.product_id || '').trim();
        const returnQty = Number(item.quantity || 0);
        const qtySale = Number(item.qty_sale || item.quantity || 0);
        const qtyBase = Number(item.qty_base || qtySale || returnQty);
        const unitPrice = Number(item.unit_price || 0);
        const lineTotal = Number(item.line_total || unitPrice * returnQty);

        if (!productId) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, `Item ${i + 1}: Product ID is required`);
        }
        if (!Number.isFinite(returnQty) || returnQty <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, `Item ${i + 1}: Quantity must be greater than 0`);
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, `Item ${i + 1}: Unit price is invalid`);
        }
        if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, `Item ${i + 1}: Line total is invalid`);
        }

        const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        if (!product) {
          throw createError(ERROR_CODES.NOT_FOUND, `Product ${productId} not found`);
        }

        validatedItems.push({
          product,
          returnQty,
          qtySale,
          qtyBase,
          unitPrice,
          lineTotal,
          saleUnit: item.sale_unit || product.unit || null,
          basePrice: item.base_price ?? product.sale_price ?? null,
          ustaPrice: item.usta_price ?? product.master_price ?? null,
          discountType: item.discount_type ?? null,
          discountValue: Number(item.discount_value ?? 0) || 0,
          finalUnitPrice: item.final_unit_price ?? unitPrice,
          finalTotal: item.final_total ?? lineTotal,
          priceSource: item.price_source ?? 'manual',
          productName: item.product_name || product.name,
        });

        totalAmount += lineTotal;
      }

      const hasReturnMode = this._hasSalesReturnCol('return_mode');
      const returnCols = [
        'id',
        'return_number',
        'order_id',
        'customer_id',
        'cashier_id',
        'user_id',
        'warehouse_id',
        'shift_id',
        'return_reason',
        'total_amount',
        'refund_amount',
        'refund_method',
        ...(hasReturnMode ? ['return_mode'] : []),
        'status',
        'notes',
        'created_at',
      ];
      const returnVals = [
        returnId,
        returnNumber,
        null,
        customerId,
        cashierId,
        userId,
        warehouseId,
        null,
        data.return_reason.trim(),
        totalAmount,
        totalAmount,
        refundMethod,
        ...(hasReturnMode ? ['manual'] : []),
        'completed',
        data.notes || null,
        now,
      ];
      const returnPlaceholders = returnCols.map(() => '?').join(', ');
      this.db.prepare(`
        INSERT INTO sales_returns (${returnCols.join(', ')})
        VALUES (${returnPlaceholders})
      `).run(...returnVals);

      const returnItems = [];
      for (const item of validatedItems) {
        const returnItemId = randomUUID();
        const hasSaleUnit = this._hasReturnItemCol('sale_unit');
        const hasQtySale = this._hasReturnItemCol('qty_sale');
        const hasQtyBase = this._hasReturnItemCol('qty_base');
        const hasBasePrice = this._hasReturnItemCol('base_price');
        const hasUstaPrice = this._hasReturnItemCol('usta_price');
        const hasDiscountType = this._hasReturnItemCol('discount_type');
        const hasDiscountValue = this._hasReturnItemCol('discount_value');
        const hasFinalUnitPrice = this._hasReturnItemCol('final_unit_price');
        const hasFinalTotal = this._hasReturnItemCol('final_total');
        const hasPriceSource = this._hasReturnItemCol('price_source');
        const cols = [
          'id',
          'return_id',
          'order_item_id',
          'product_id',
          'product_name',
          'quantity',
          'unit_price',
          'line_total',
          'created_at',
          ...(hasSaleUnit ? ['sale_unit'] : []),
          ...(hasQtySale ? ['qty_sale'] : []),
          ...(hasQtyBase ? ['qty_base'] : []),
          ...(hasBasePrice ? ['base_price'] : []),
          ...(hasUstaPrice ? ['usta_price'] : []),
          ...(hasDiscountType ? ['discount_type'] : []),
          ...(hasDiscountValue ? ['discount_value'] : []),
          ...(hasFinalUnitPrice ? ['final_unit_price'] : []),
          ...(hasFinalTotal ? ['final_total'] : []),
          ...(hasPriceSource ? ['price_source'] : []),
        ];
        const vals = [
          returnItemId,
          returnId,
          null,
          item.product.id,
          item.productName,
          item.returnQty,
          item.unitPrice,
          item.lineTotal,
          now,
          ...(hasSaleUnit ? [item.saleUnit] : []),
          ...(hasQtySale ? [item.qtySale] : []),
          ...(hasQtyBase ? [item.qtyBase] : []),
          ...(hasBasePrice ? [item.basePrice] : []),
          ...(hasUstaPrice ? [item.ustaPrice] : []),
          ...(hasDiscountType ? [item.discountType] : []),
          ...(hasDiscountValue ? [item.discountValue] : []),
          ...(hasFinalUnitPrice ? [item.finalUnitPrice] : []),
          ...(hasFinalTotal ? [item.finalTotal] : []),
          ...(hasPriceSource ? [item.priceSource] : []),
        ];
        const placeholders = cols.map(() => '?').join(', ');
        this.db.prepare(`INSERT INTO return_items (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);

        if (item.product.track_stock) {
          this.inventoryService._updateBalance(
            item.product.id,
            warehouseId,
            item.qtyBase,
            'return',
            'return',
            returnId,
            `Manual return ${returnNumber}`,
            userId || SAFE_ADMIN_ID
          );
        }

        returnItems.push({
          id: returnItemId,
          order_item_id: null,
          product_id: item.product.id,
          product_name: item.productName,
          quantity: item.returnQty,
          unit_price: item.unitPrice,
          line_total: item.lineTotal,
          sale_unit: item.saleUnit,
          qty_sale: item.qtySale,
          qty_base: item.qtyBase,
          base_price: item.basePrice,
          usta_price: item.ustaPrice,
          discount_type: item.discountType,
          discount_value: item.discountValue,
          final_unit_price: item.finalUnitPrice,
          final_total: item.finalTotal,
          price_source: item.priceSource,
        });
      }

      if (customerId) {
        this._applyCustomerRefund(customerId, totalAmount, {
          returnId,
          returnNumber,
          method: refundMethod,
          createdAt: now,
          createdBy: cashierId || userId || null,
          note: `Ordersiz qaytarish: ${returnNumber} (${totalAmount} so'm)`,
        });
      }

      return {
        id: returnId,
        return_number: returnNumber,
        order_id: null,
        customer_id: customerId,
        cashier_id: cashierId,
        return_reason: data.return_reason.trim(),
        total_amount: totalAmount,
        refund_amount: totalAmount,
        refund_method: refundMethod,
        return_mode: 'manual',
        status: 'completed',
        notes: data.notes || null,
        items: returnItems,
        created_at: now,
      };
    })();
  }

  /**
   * Get order details for return creation
   * CRITICAL: Uses orders + order_items tables (NOT sales + sale_items)
   * Input: { orderId: string } - UUID of the order
   */
  getOrderDetails(orderId) {
    console.log('[RETURNS] getOrderDetails called for orderId:', orderId);
    
    if (!orderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order ID is required');
    }
    
    // STEP 1: Get order from orders table
    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      console.warn('[RETURNS] Order not found:', orderId);
      throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
    }
    
    console.log('[RETURNS] Order found:', {
      id: order.id,
      order_number: order.order_number,
      total_amount: order.total_amount,
    });
    
    // STEP 2: Get order items with returned quantities calculated from return_items
    // CRITICAL: Join with return_items to calculate returned_quantity per order_item
    // Only count returns with status='completed'
    const orderItemsQuery = `
      SELECT 
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.product_sku,
        oi.quantity AS sold_quantity,
        oi.sale_unit,
        oi.qty_sale,
        oi.qty_base,
        oi.unit_price,
        oi.base_price,
        oi.usta_price,
        oi.discount_type,
        oi.discount_value,
        oi.final_unit_price,
        oi.final_total,
        oi.price_source,
        oi.line_total,
        oi.returned_quantity AS order_item_returned_qty, -- Legacy field (may be outdated)
        COALESCE(SUM(CASE WHEN sr.status = 'completed' THEN ri.quantity ELSE 0 END), 0) AS returned_quantity,
        (oi.quantity - COALESCE(SUM(CASE WHEN sr.status = 'completed' THEN ri.quantity ELSE 0 END), 0)) AS remaining_quantity
      FROM order_items oi
      LEFT JOIN return_items ri ON ri.order_item_id = oi.id
      LEFT JOIN sales_returns sr ON sr.id = ri.return_id AND sr.status = 'completed'
      WHERE oi.order_id = ?
      GROUP BY
        oi.id,
        oi.product_id,
        oi.product_name,
        oi.product_sku,
        oi.quantity,
        oi.sale_unit,
        oi.qty_sale,
        oi.qty_base,
        oi.unit_price,
        oi.base_price,
        oi.usta_price,
        oi.discount_type,
        oi.discount_value,
        oi.final_unit_price,
        oi.final_total,
        oi.price_source,
        oi.line_total,
        oi.returned_quantity
      ORDER BY oi.created_at ASC
    `;
    
    const orderItems = this.db.prepare(orderItemsQuery).all(orderId);
    console.log(`[RETURNS] Found ${orderItems.length} items for order ${orderId}`);
    
    if (orderItems.length === 0) {
      console.warn('[RETURNS] ⚠️ No items found for order:', orderId);
      // Don't throw - return empty items array, let frontend handle it
    }
    
    // STEP 3: Get customer if exists
    let customer = null;
    if (order.customer_id) {
      customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    }
    
    // STEP 4: Normalize response
    // CRITICAL: Return orderItemId (order_items.id) so frontend can send it as order_item_id
    // CRITICAL: Include sold_quantity, returned_quantity, and remaining_quantity
    const normalizedItems = orderItems.map(item => {
      const soldQty = Number(item.sold_quantity || 0);
      const returnedQty = Number(item.returned_quantity || 0);
      const remainingQty = Number(item.remaining_quantity || soldQty);
      
      console.log('[RETURNS] Normalizing item with return quantities:', {
        order_items_id: item.order_item_id,
        product_id: item.product_id,
        product_name: item.product_name,
        sold_quantity: soldQty,
        returned_quantity: returnedQty,
        remaining_quantity: remainingQty,
      });
      
      return {
        id: item.order_item_id, // Keep for compatibility
        orderItemId: item.order_item_id, // CRITICAL: This is order_items.id (NOT product_id)
        productId: item.product_id, // This is products.id
        name: item.product_name || 'Noma\'lum mahsulot',
        price: item.unit_price || 0,
        qty: soldQty, // Original sold quantity
        sold_quantity: soldQty, // Explicit field for sold quantity
        returned_quantity: returnedQty, // Calculated from return_items
        remaining_quantity: remainingQty, // sold - returned
        refundableQty: remainingQty, // Available to return = remaining
        lineTotal: item.line_total || (item.unit_price || 0) * soldQty,
        sale_unit: item.sale_unit,
        qty_sale: item.qty_sale,
        qty_base: item.qty_base,
        base_price: item.base_price,
        usta_price: item.usta_price,
        discount_type: item.discount_type,
        discount_value: item.discount_value,
        final_unit_price: item.final_unit_price,
        final_total: item.final_total,
        price_source: item.price_source,
        // Keep original fields for compatibility
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku,
        quantity: soldQty, // Original quantity (sold)
        unit_price: item.unit_price,
        line_total: item.line_total,
      };
    });
    
    const result = {
      order: {
        id: order.id,
        orderNumber: order.order_number,
        createdAt: order.created_at,
        total: order.total_amount,
        // Keep original fields for compatibility
        order_number: order.order_number,
        created_at: order.created_at,
        total_amount: order.total_amount,
        customer_id: order.customer_id,
        status: order.status,
      },
      items: normalizedItems,
      customer: customer || null,
    };
    
    console.log('[RETURNS] getOrderDetails returning:', {
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      itemsCount: result.items.length,
      hasCustomer: !!result.customer,
    });
    
    return result;
  }

  /**
   * Get return by ID
   * CRITICAL: Returns full return details with joined data (order, customer, cashier, items)
   * Input: id (UUID) - sales_returns.id
   */
  getById(id) {
    console.log('[RETURNS] getById called with id:', id);
    
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Return ID is required');
    }

    // Validate that id looks like a UUID (basic check)
    // UUIDs are typically 36 characters with hyphens, but we'll be lenient
    if (typeof id !== 'string' || id.trim().length === 0) {
      console.error('[RETURNS] Invalid return ID format:', id);
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid return ID format: ${id}`);
    }

    // Get return record with joined data (order, customer)
    const returnRecord = this.db.prepare(`
      SELECT 
        sr.id,
        sr.return_number,
        sr.order_id,
        sr.customer_id,
        sr.cashier_id,
        sr.user_id,
        sr.warehouse_id,
        sr.shift_id,
        sr.return_reason,
        sr.total_amount,
        sr.refund_amount,
        sr.refund_method,
        sr.return_mode,
        sr.status,
        sr.notes,
        sr.created_at,
        o.order_number as original_order_number,
        o.created_at as order_created_at,
        c.name as customer_name
      FROM sales_returns sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN customers c ON sr.customer_id = c.id
      WHERE sr.id = ?
    `).get(id);
    
    if (!returnRecord) {
      console.error('[RETURNS] Return not found with id:', id);
      // Try to find by return_number as fallback (for debugging)
      const byNumber = this.db.prepare('SELECT id, return_number FROM sales_returns WHERE return_number = ?').get(id);
      if (byNumber) {
        console.warn('[RETURNS] Found return by return_number instead of id:', byNumber);
        throw createError(ERROR_CODES.NOT_FOUND, `Return not found. ID provided (${id}) appears to be return_number (${byNumber.return_number}). Expected UUID: ${byNumber.id}`);
      }
      throw createError(ERROR_CODES.NOT_FOUND, `Return ${id} not found`);
    }

    console.log('[RETURNS] Return found:', {
      id: returnRecord.id,
      return_number: returnRecord.return_number,
      order_id: returnRecord.order_id,
      status: returnRecord.status,
    });

    const isManualReturn = String(returnRecord.return_mode || 'order') === 'manual';

    // STEP B: Verify DB relations - Check if return_items have order_item_id
    console.log('[RETURNS] STEP B: Verifying DB relations for return_id:', id);
    
    // Query 1: Check return_items rows
    const returnItemsCheck = this.db.prepare(`
      SELECT id, return_id, order_item_id, product_id, quantity
      FROM return_items
      WHERE return_id = ?
    `).all(id);
    
    console.log('[RETURNS] Query 1 - Return items check:', {
      count: returnItemsCheck.length,
      items: returnItemsCheck.map(ri => ({
        id: ri.id,
        return_id: ri.return_id,
        order_item_id: ri.order_item_id,
        has_order_item_id: !!ri.order_item_id,
        product_id: ri.product_id,
        quantity: ri.quantity,
      })),
    });
    
    // Check for NULL order_item_id
    const itemsWithNullOrderItemId = returnItemsCheck.filter(ri => !ri.order_item_id);
    if (!isManualReturn && itemsWithNullOrderItemId.length > 0) {
      console.error('[RETURNS] ⚠️ CRITICAL: Found return_items with NULL order_item_id:', itemsWithNullOrderItemId);
      throw createError(ERROR_CODES.VALIDATION_ERROR, 
        `Return has ${itemsWithNullOrderItemId.length} items with missing order_item_id. Cannot edit return.`);
    }
    
    // Query 2: Verify order_item_id links exist
    for (const ri of returnItemsCheck) {
      if (isManualReturn || !ri.order_item_id) continue;
      const orderItem = this.db.prepare('SELECT id, quantity FROM order_items WHERE id = ?').get(ri.order_item_id);
      if (!orderItem) {
        console.error('[RETURNS] ⚠️ CRITICAL: order_item_id does not exist in order_items:', ri.order_item_id);
        throw createError(ERROR_CODES.NOT_FOUND, 
          `Order item ${ri.order_item_id} not found for return item ${ri.id}`);
      }
      console.log('[RETURNS] Verified order_item link:', {
        return_item_id: ri.id,
        order_item_id: ri.order_item_id,
        order_item_quantity: orderItem.quantity,
      });
    }
    
    // STEP C2: Get return items with correct SQL query
    // CRITICAL: Use INNER JOIN for order_items to ensure we have valid order_item_id
    // CRITICAL: Count ALL returns (not just completed) when calculating already_returned_quantity
    console.log('[RETURNS] STEP C2: Executing main query for return items');
    const items = isManualReturn
      ? this.db.prepare(`
          SELECT
            ri.id,
            ri.return_id,
            ri.order_item_id,
            ri.product_id,
            ri.product_name,
            ri.quantity as current_return_quantity,
            ri.quantity as sold_quantity,
            0 as returned_quantity,
            ri.unit_price,
            ri.line_total,
            ri.created_at,
            ri.sale_unit,
            ri.qty_sale,
            ri.qty_base,
            ri.base_price,
            ri.usta_price,
            ri.discount_type,
            ri.discount_value,
            ri.final_unit_price,
            ri.final_total,
            ri.price_source,
            p.name as product_name_from_product,
            p.sku as product_sku,
            p.unit as product_unit
          FROM return_items ri
          LEFT JOIN products p ON ri.product_id = p.id
          WHERE ri.return_id = ?
          ORDER BY ri.created_at ASC
        `).all(id)
      : this.db.prepare(`
          SELECT 
            ri.id,
            ri.return_id,
            ri.order_item_id,
            ri.product_id,
            ri.product_name,
            ri.quantity as current_return_quantity,
            ri.unit_price,
            ri.line_total,
            ri.created_at,
            ri.sale_unit,
            ri.qty_sale,
            ri.qty_base,
            ri.base_price,
            ri.usta_price,
            ri.discount_type,
            ri.discount_value,
            ri.final_unit_price,
            ri.final_total,
            ri.price_source,
            p.name as product_name_from_product,
            p.sku as product_sku,
            p.unit as product_unit,
            oi.quantity as sold_quantity,
            COALESCE((
              SELECT SUM(ri2.quantity)
              FROM return_items ri2
              INNER JOIN sales_returns sr2 ON sr2.id = ri2.return_id
              WHERE ri2.order_item_id = ri.order_item_id
                AND sr2.id != ?
            ), 0) as returned_quantity
          FROM return_items ri
          INNER JOIN order_items oi ON oi.id = ri.order_item_id
          LEFT JOIN products p ON ri.product_id = p.id
          WHERE ri.return_id = ?
          ORDER BY ri.created_at ASC
        `).all(id, id);

    console.log(`[RETURNS] Found ${items.length} return items for return ${id}`);
    
    // Debug: Log raw query results
    console.log('[RETURNS] Raw query results (first item):', items.length > 0 ? {
      id: items[0].id,
      order_item_id: items[0].order_item_id,
      sold_quantity: items[0].sold_quantity,
      returned_quantity: items[0].returned_quantity,
      current_return_quantity: items[0].current_return_quantity,
      product_name: items[0].product_name_from_product || items[0].product_name,
    } : 'No items found');

    // Get cashier/user info if available
    let cashier = null;
    if (returnRecord.cashier_id || returnRecord.user_id) {
      const cashierId = returnRecord.cashier_id || returnRecord.user_id;
      cashier = this.db.prepare('SELECT id, username, full_name, email FROM profiles WHERE id = ?').get(cashierId);
    }

    // Build response with all joined data
    const result = {
      id: returnRecord.id,
      return_number: returnRecord.return_number,
      order_id: returnRecord.order_id,
      customer_id: returnRecord.customer_id,
      cashier_id: returnRecord.cashier_id,
      user_id: returnRecord.user_id,
      warehouse_id: returnRecord.warehouse_id,
      shift_id: returnRecord.shift_id,
      return_reason: returnRecord.return_reason,
      total_amount: returnRecord.total_amount,
      refund_amount: returnRecord.refund_amount,
      refund_method: returnRecord.refund_method,
      return_mode: returnRecord.return_mode || 'order',
      status: returnRecord.status,
      notes: returnRecord.notes || null,
      created_at: returnRecord.created_at,
      // Joined data
      order: returnRecord.original_order_number ? {
        id: returnRecord.order_id,
        order_number: returnRecord.original_order_number,
        created_at: returnRecord.order_created_at,
      } : null,
      customer: returnRecord.customer_name ? {
        id: returnRecord.customer_id,
        name: returnRecord.customer_name,
      } : null,
      cashier: cashier ? {
        id: cashier.id,
        username: cashier.username,
        full_name: cashier.full_name,
        email: cashier.email,
      } : null,
      items: items.map(item => {
        // CRITICAL: Use field names from SQL query (sold_quantity, returned_quantity, current_return_quantity)
        const soldQty = Number(item.sold_quantity || 0);
        const returnedQty = Number(item.returned_quantity || 0);
        const currentQty = Number(item.current_return_quantity || 0);
        const maxAllowedQty = soldQty - returnedQty;
        
        // Debug logging for each item
        console.log('[RETURNS] Mapping item:', {
          return_item_id: item.id,
          order_item_id: item.order_item_id,
          product_id: item.product_id,
          sold_quantity: soldQty,
          returned_quantity: returnedQty,
          current_return_quantity: currentQty,
          max_allowed_quantity: maxAllowedQty,
        });
        
        // Verify sold_quantity is not 0
        if (soldQty === 0) {
          console.error('[RETURNS] ⚠️ WARNING: sold_quantity is 0 for item:', {
            return_item_id: item.id,
            order_item_id: item.order_item_id,
            raw_sold_quantity: item.sold_quantity,
          });
        }
        
        return {
          id: item.id,
          return_id: item.return_id,
          order_item_id: item.order_item_id,
          product_id: item.product_id,
          product_name: item.product_name_from_product || item.product_name,
          product_sku: item.product_sku,
          quantity: currentQty,
          unit_price: item.unit_price,
          line_total: item.line_total,
          created_at: item.created_at,
          sale_unit: item.sale_unit || item.product_unit || null,
          qty_sale: item.qty_sale ?? currentQty,
          qty_base: item.qty_base ?? currentQty,
          base_price: item.base_price ?? null,
          usta_price: item.usta_price ?? null,
          discount_type: item.discount_type ?? null,
          discount_value: item.discount_value ?? null,
          final_unit_price: item.final_unit_price ?? item.unit_price,
          final_total: item.final_total ?? item.line_total,
          price_source: item.price_source ?? null,
          // CRITICAL: Use consistent field names - sold_quantity, returned_quantity, current_quantity
          sold_quantity: soldQty,
          returned_quantity: returnedQty,
          current_quantity: currentQty,
          // Aliases for backward compatibility
          original_sold_quantity: soldQty,
          already_returned_quantity: returnedQty,
          max_allowed_quantity: maxAllowedQty,
          // For compatibility
          product: item.product_name_from_product ? {
            id: item.product_id,
            name: item.product_name_from_product,
            sku: item.product_sku,
            unit: item.product_unit || null,
          } : null,
        };
      }),
    };

    console.log('[RETURNS] getById returning:', {
      id: result.id,
      return_number: result.return_number,
      items_count: result.items.length,
      has_order: !!result.order,
      has_customer: !!result.customer,
      has_cashier: !!result.cashier,
    });

    return result;
  }

  /**
   * Update return with new item quantities
   * CRITICAL: Validates max allowed quantity, updates items, recalculates totals, adjusts inventory
   * Input: { returnId, return_reason?, notes?, items: [{ return_item_id, order_item_id, quantity }] }
   */
  updateReturn(returnId, data) {
    const SAFE_ADMIN_ID = 'default-admin-001';
    const SAFE_WAREHOUSE_ID = 'default-warehouse-001';
    
    console.log('[RETURNS] updateReturn called:', {
      returnId,
      items_count: data.items?.length || 0,
      return_reason: data.return_reason ? 'provided' : 'not provided',
      notes: data.notes ? 'provided' : 'not provided',
    });
    
    if (!returnId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Return ID is required');
    }
    
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Return items are required');
    }
    
    try {
      return this.db.transaction(() => {
        // Step 1: Get existing return
        const returnRecord = this.db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(returnId);
        if (!returnRecord) {
          throw createError(ERROR_CODES.NOT_FOUND, `Return ${returnId} not found`);
        }
        
        if (returnRecord.status === 'completed') {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cannot edit completed returns');
        }
        
        console.log('[RETURNS] Step 1: Return found:', {
          id: returnRecord.id,
          return_number: returnRecord.return_number,
          status: returnRecord.status,
        });
        
        // Step 2: Get existing return items
        const existingItems = this.db.prepare('SELECT * FROM return_items WHERE return_id = ?').all(returnId);
        console.log(`[RETURNS] Step 2: Found ${existingItems.length} existing return items`);
        
        // Step 3: Validate and prepare updates
        const now = new Date().toISOString();
        let totalAmount = 0;
        const itemUpdates = [];
        const inventoryDeltas = [];
        
        for (const itemUpdate of data.items) {
          const existingItem = existingItems.find(ei => ei.id === itemUpdate.return_item_id);
          if (!existingItem) {
            throw createError(ERROR_CODES.NOT_FOUND, `Return item ${itemUpdate.return_item_id} not found`);
          }
          
          const newQuantity = Number(itemUpdate.quantity);
          if (!Number.isInteger(newQuantity) || newQuantity < 1) {
            throw createError(ERROR_CODES.VALIDATION_ERROR, `Quantity must be integer >= 1 for item ${itemUpdate.return_item_id}`);
          }
          
          // Get original sold quantity and already returned quantity (excluding current return)
          const orderItem = this.db.prepare('SELECT quantity FROM order_items WHERE id = ?').get(existingItem.order_item_id);
          if (!orderItem) {
            throw createError(ERROR_CODES.NOT_FOUND, `Order item ${existingItem.order_item_id} not found`);
          }
          
          const originalSoldQty = Number(orderItem.quantity || 0);
          // CRITICAL: Count ALL returns (not just completed) when calculating already_returned_quantity
          const alreadyReturnedQty = this.db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) as total
            FROM return_items ri
            INNER JOIN sales_returns sr ON sr.id = ri.return_id
            WHERE ri.order_item_id = ? AND sr.id != ?
          `).get(existingItem.order_item_id, returnId);
          
          const alreadyReturned = Number(alreadyReturnedQty?.total || 0);
          const maxAllowed = originalSoldQty - alreadyReturned;
          
          if (newQuantity > maxAllowed) {
            throw createError(ERROR_CODES.VALIDATION_ERROR, 
              `Quantity ${newQuantity} exceeds maximum allowed ${maxAllowed} for order_item ${existingItem.order_item_id} (sold: ${originalSoldQty}, already returned: ${alreadyReturned})`);
          }
          
          const oldQuantity = Number(existingItem.quantity || 0);
          const deltaQuantity = newQuantity - oldQuantity;
          const lineTotal = newQuantity * existingItem.unit_price;
          totalAmount += lineTotal;
          
          itemUpdates.push({
            return_item_id: existingItem.id,
            order_item_id: existingItem.order_item_id,
            product_id: existingItem.product_id,
            newQuantity,
            oldQuantity,
            deltaQuantity,
            lineTotal,
            unit_price: existingItem.unit_price,
          });
          
          // Track inventory delta (positive = more returned, negative = less returned)
          if (deltaQuantity !== 0) {
            inventoryDeltas.push({
              product_id: existingItem.product_id,
              deltaQuantity,
              order_item_id: existingItem.order_item_id,
            });
          }
          
          console.log(`[RETURNS] Step 3: Item ${existingItem.id} - old: ${oldQuantity}, new: ${newQuantity}, delta: ${deltaQuantity}, maxAllowed: ${maxAllowed}`);
        }
        
        // Step 4: Update return items
        console.log('[RETURNS] Step 4: Updating return items');
        for (const update of itemUpdates) {
          this.db.prepare(`
            UPDATE return_items 
            SET quantity = ?, line_total = ?
            WHERE id = ?
          `).run(update.newQuantity, update.lineTotal, update.return_item_id);
        }
        
        // Step 5: Update return totals
        console.log('[RETURNS] Step 5: Updating return totals:', totalAmount);
        this.db.prepare(`
          UPDATE sales_returns 
          SET total_amount = ?, refund_amount = ?, return_reason = ?, notes = ?
          WHERE id = ?
        `).run(
          totalAmount,
          totalAmount,
          data.return_reason || returnRecord.return_reason,
          data.notes !== undefined ? data.notes : returnRecord.notes,
          returnId
        );
        
        // Step 6: Adjust inventory for deltas
        console.log('[RETURNS] Step 6: Adjusting inventory for deltas');
        for (const delta of inventoryDeltas) {
          const product = this.db.prepare('SELECT track_stock FROM products WHERE id = ?').get(delta.product_id);
          if (product && product.track_stock) {
            if (!this.inventoryService) {
              throw createError(ERROR_CODES.VALIDATION_ERROR, 'InventoryService is not available. Cannot update stock.');
            }

            const stockUpdate = this.inventoryService._updateBalance(
                delta.product_id,
                SAFE_WAREHOUSE_ID,
                delta.deltaQuantity,
              'return_update',
                'return',
                returnId,
                `Return quantity updated for order_item ${delta.order_item_id}`,
              SAFE_ADMIN_ID
            );

            console.log(`[RETURNS] Step 6: Inventory adjusted via InventoryService for product ${delta.product_id}: ${stockUpdate.beforeQuantity} -> ${stockUpdate.afterQuantity}`);
          }
        }
        
        console.log('[RETURNS] updateReturn completed successfully');
        
        // Return updated return data
        return this.getById(returnId);
      })();
    } catch (error) {
      console.error('[RETURNS] updateReturn FAILED:', {
        message: error.message,
        code: error.code,
        returnId,
      });
      throw error;
    }
  }

  /**
   * List returns with JOIN to orders table for order_number
   * CRITICAL FIX: Do NOT select updated_at (column doesn't exist)
   */
  list(filters = {}) {
    console.log('[RETURNS] list called with filters:', filters);
    
    let query = `
      SELECT 
        sr.id,
        sr.return_number,
        sr.order_id,
        sr.customer_id,
        sr.cashier_id,
        sr.user_id,
        sr.warehouse_id,
        sr.shift_id,
        sr.return_reason,
        sr.total_amount,
        sr.refund_amount,
        sr.refund_method,
        sr.return_mode,
        sr.status,
        sr.notes,
        sr.created_at,
        o.order_number as original_order_number,
        o.created_at as order_created_at,
        c.name as customer_name
      FROM sales_returns sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN customers c ON sr.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // CRITICAL: Only filter by status if explicitly provided
    // Do NOT filter out 'completed' returns by default
    if (filters.status && filters.status !== 'all') {
      query += ' AND sr.status = ?';
      params.push(filters.status);
      console.log('[RETURNS] Filtering by status:', filters.status);
    }

    if (filters.order_id) {
      query += ' AND sr.order_id = ?';
      params.push(filters.order_id);
    }

    if (filters.customer_id) {
      query += ' AND sr.customer_id = ?';
      params.push(filters.customer_id);
    }

    // IMPORTANT: Our DB timestamps are stored as UTC-like strings without timezone.
    // For "Bugun/Shu hafta" style filters we need LOCAL day semantics.
    // Use DATE(..., 'localtime') comparisons to avoid "today shows 0" near midnight.
    if (filters.date_from) {
      query += " AND DATE(sr.created_at, 'localtime') >= DATE(?)";
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      query += " AND DATE(sr.created_at, 'localtime') <= DATE(?)";
      params.push(filters.date_to);
    }

    // CRITICAL: No default status filter - return all returns
    // New returns are created with status='completed', so they will appear

    query += ' ORDER BY sr.created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    } else {
      // Default limit to prevent huge result sets
      query += ' LIMIT 1000';
    }

    console.log('[RETURNS] Executing query with params:', params);
    const returns = this.db.prepare(query).all(params);
    console.log(`[RETURNS] ReturnsService.list returned ${returns.length} returns`);
    
    // Log first return to verify structure
    if (returns.length > 0) {
      console.log('[RETURNS] First return sample:', {
        id: returns[0].id,
        return_number: returns[0].return_number,
        status: returns[0].status,
        created_at: returns[0].created_at,
        order_id: returns[0].order_id,
      });
    } else {
      console.warn('[RETURNS] ⚠️ No returns found in database');
      // Debug: Check if any returns exist at all
      const totalCount = this.db.prepare('SELECT COUNT(*) as count FROM sales_returns').get();
      console.log('[RETURNS] Total returns in DB:', totalCount?.count || 0);
    }
    
    return returns;
  }
}

module.exports = ReturnsService;
