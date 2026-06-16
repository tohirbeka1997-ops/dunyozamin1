'use strict';

const express = require('express');
const { formatYmdInTimeZone } = require('../../../electron/lib/timezone.cjs');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/reports]' });
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

/**
 * Staff reports — minimal daily sales summary for mobile.
 */
function mountStaffReportsRoutes() {
  const router = express.Router();

  function bundleForReq(req) {
    return getPosBundle(openTenantDatabase(req.staffUser.tenant));
  }

  // GET /v1/staff/reports/daily?date=YYYY-MM-DD
  router.get('/daily', (req, res) => {
    try {
      const rawDate = req.query.date != null ? String(req.query.date).trim() : '';
      const date = isYmd(rawDate) ? rawDate : formatYmdInTimeZone(new Date());
      const { reports, shifts } = bundleForReq(req);
      const daily = reports.getDailySales(date);

      let open_shift = null;
      try {
        const shift = shifts.getActiveShift();
        if (shift) {
          let summary = null;
          try {
            summary = shifts.getShiftSummary(shift.id);
          } catch {
            /* optional */
          }
          open_shift = {
            id: shift.id,
            shift_number: shift.shift_number,
            opened_at: shift.opened_at,
            summary,
          };
        }
      } catch {
        /* optional */
      }

      res.json({
        data: {
          date: daily.date,
          order_count: daily.order_count,
          total_sales: daily.total_sales,
          cash_total: daily.cash_total,
          card_total: daily.card_total,
          credit_total: daily.credit_total,
          open_shift,
        },
      });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffReportsRoutes };
