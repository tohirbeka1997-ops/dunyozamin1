'use strict';

const express = require('express');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');
const { staffCanAccessArea } = require('../../lib/staffRoles.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/products]' });
}

/** Cost / batch history: admin, manager, sales — not cashier. */
function canSeeCost(req) {
  return staffCanAccessArea(req.staffUser?.role, 'cost');
}

/**
 * Map a raw `inventory_batches` row (from BatchService.listBatchesByProduct)
 * to the stable batch DTO the mobile app consumes.
 */
function mapBatch(b) {
  const sourceType = b.source_type || null;
  return {
    batch_id: b.id,
    quantity: Number(b.initial_qty || 0),
    remaining_quantity: Number(b.remaining_qty || 0),
    unit_cost: Number(b.unit_cost || 0),
    received_at: b.opened_at || b.created_at || null,
    supplier_name: b.supplier_name || null,
    supplier_id: b.supplier_id || null,
    purchase_order_id: sourceType === 'purchase_receive' ? b.source_id || null : null,
    doc_no: b.doc_no || null,
    source_type: sourceType,
    status: b.status || null,
  };
}

/**
 * Derive a cost summary from a product's batches. `batches` is expected newest
 * first (BatchService orders by opened_at DESC). The average is weighted by the
 * quantity still on hand so it reflects the cost of current stock.
 */
function buildCostSummary(batches) {
  if (!Array.isArray(batches) || batches.length === 0) {
    return { avg_cost: null, latest_cost: null, min_cost: null, max_cost: null, batch_count: 0 };
  }
  let remainingQty = 0;
  let remainingCost = 0;
  let min = null;
  let max = null;
  for (const b of batches) {
    const cost = Number(b.unit_cost || 0);
    const rem = Number(b.remaining_qty || 0);
    if (rem > 0) {
      remainingQty += rem;
      remainingCost += rem * cost;
    }
    if (min == null || cost < min) min = cost;
    if (max == null || cost > max) max = cost;
  }
  return {
    avg_cost: remainingQty > 0 ? remainingCost / remainingQty : null,
    latest_cost: Number(batches[0].unit_cost || 0),
    min_cost: min,
    max_cost: max,
    batch_count: batches.length,
  };
}

/**
 * Best-effort batch fetch. Returns [] when batch tables/warehouse are missing
 * so the cost summary degrades gracefully instead of 500-ing the detail screen.
 */
function safeListBatches(batch, productId) {
  try {
    return batch.listBatchesByProduct(productId) || [];
  } catch {
    return [];
  }
}

/**
 * Staff catalog routes for POS selling. Reuses ProductsService.searchScreen (the
 * same thin POS DTO the Electron POS uses) and InventoryService.getCurrentStock.
 *
 * The "Mahsulotlar" (Products) screens additionally surface cost price
 * (tan narx) and batch/partiya history via BatchService — see COST_VISIBLE_ROLES.
 */
function mountStaffProductsRoutes() {
  const router = express.Router();

  function bundleForReq(req) {
    return getPosBundle(openTenantDatabase(req.staffUser.tenant));
  }

  // GET /v1/staff/products/search?q=&limit=
  router.get('/search', (req, res) => {
    try {
      const q = req.query.q != null ? String(req.query.q).trim() : '';
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;

      const { products } = bundleForReq(req);
      const rows = products.searchScreen({
        search: q || undefined,
        status: 'active',
        limit,
      });
      const showCost = canSeeCost(req);
      const data = rows.map((row) => {
        const cost = Number(row.purchase_price || 0);
        return { ...row, cost_price: showCost ? cost : null };
      });
      res.json({ data });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/products/:id/batches  → batch/partiya history (newest first)
  router.get('/:id/batches', (req, res) => {
    try {
      if (!canSeeCost(req)) {
        res.status(403).json({ error: 'forbidden', message: 'Cost data not allowed for this role' });
        return;
      }
      const { products, batch } = bundleForReq(req);
      const product = products.getById(req.params.id);
      if (!product) {
        res.status(404).json({ error: 'not_found', message: 'Product not found' });
        return;
      }
      const rows = safeListBatches(batch, product.id);
      res.json({ data: rows.map(mapBatch), summary: buildCostSummary(rows) });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/products/:id  → product + live stock + cost summary
  router.get('/:id', (req, res) => {
    try {
      const { products, inventory, batch } = bundleForReq(req);
      const product = products.getById(req.params.id);
      if (!product) {
        res.status(404).json({ error: 'not_found', message: 'Product not found' });
        return;
      }
      const currentStock = inventory.getCurrentStock(product.id);
      const showCost = canSeeCost(req);
      const costPrice = showCost ? Number(product.purchase_price || 0) : null;
      const costSummary = showCost ? buildCostSummary(safeListBatches(batch, product.id)) : null;
      res.json({
        data: {
          ...product,
          current_stock: currentStock,
          cost_price: costPrice,
          cost_summary: costSummary,
        },
      });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffProductsRoutes };
