'use strict';

const express = require('express');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/shifts]' });
}

/**
 * Staff shift routes. Reuses the canonical ShiftsService (same open/close math as
 * the Electron POS). A staff member's user id acts as the cashier id.
 */
function mountStaffShiftsRoutes() {
  const router = express.Router();

  function bundleForReq(req) {
    return getPosBundle(openTenantDatabase(req.staffUser.tenant));
  }

  function currentShift(shifts, userId) {
    return shifts.getOpenShiftForCashier(userId);
  }

  function shiftOwnedByUser(shift, userId) {
    const uid = String(userId || '').trim();
    if (!uid || !shift) return false;
    return String(shift.cashier_id || shift.user_id || '').trim() === uid;
  }

  /**
   * Resolve the shift the mobile app should display.
   * Prefer the logged-in cashier's open shift; if none, fall back to any store
   * open shift (same behaviour as desktop POS getActiveShift() without userId)
   * so summary totals match the live register session.
   */
  function resolveDisplayShift(shifts, userId) {
    const own = currentShift(shifts, userId);
    if (own) {
      return { shift: own, is_own_shift: true };
    }
    const store = shifts.getActiveShift();
    if (!store) {
      return { shift: null, is_own_shift: false };
    }
    return { shift: store, is_own_shift: shiftOwnedByUser(store, userId) };
  }

  // GET /v1/staff/shifts/current → open shift (+ summary) or null
  router.get('/current', (req, res) => {
    try {
      const { shifts } = bundleForReq(req);
      const { shift, is_own_shift: isOwnShift } = resolveDisplayShift(shifts, req.staffUser.id);
      if (!shift) {
        res.json({ data: null });
        return;
      }
      let summary = null;
      try {
        summary = shifts.getShiftSummary(shift.id);
      } catch (e) {
        console.warn('[staff/shifts] summary failed', e?.message || e);
      }
      res.json({ data: { shift, summary, is_own_shift: isOwnShift } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/shifts/open { opening_cash }
  router.post('/open', (req, res) => {
    try {
      const { shifts } = bundleForReq(req);
      const openingCash = Number(req.body?.opening_cash);
      const shift = shifts.openShift({
        cashier_id: req.staffUser.id,
        opening_cash: Number.isFinite(openingCash) && openingCash > 0 ? openingCash : 0,
      });
      res.status(201).json({ data: shift });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/shifts/close { closing_cash, notes }
  router.post('/close', (req, res) => {
    try {
      const { shifts } = bundleForReq(req);
      // Only the cashier who opened the shift may close it (not store-wide fallback).
      const open = currentShift(shifts, req.staffUser.id);
      if (!open) {
        res.status(400).json({ error: 'validation_error', message: 'No open shift to close' });
        return;
      }
      const closingCash = Number(req.body?.closing_cash);
      const notes = req.body?.notes != null ? String(req.body.notes).slice(0, 500) : null;
      const result = shifts.closeShift(open.id, {
        closing_cash: Number.isFinite(closingCash) && closingCash > 0 ? closingCash : 0,
        notes,
        closed_by: req.staffUser.id,
      });
      res.json({ data: result });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffShiftsRoutes };
