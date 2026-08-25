#!/usr/bin/env node
/**
 * One-time reconciliation: per-customer aging total vs stored balance.
 *
 * Usage:
 *   node electron/scripts/reconcile-customer-aging.cjs
 *   node electron/scripts/reconcile-customer-aging.cjs --csv /path/out.csv
 *   POS_DATA_DIR=/data node electron/scripts/reconcile-customer-aging.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('../services/index.cjs');

function parseArgs(argv) {
  const out = { csv: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--csv' && argv[i + 1]) {
      out.csv = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function toCsv(rows) {
  const header = [
    'customer_id',
    'customer_name',
    'phone',
    'stored_uzs',
    'computed_uzs',
    'diff_uzs',
    'stored_usd',
    'computed_usd',
    'diff_usd',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.customer_id,
        `"${String(r.customer_name || '').replace(/"/g, '""')}"`,
        `"${String(r.phone || '').replace(/"/g, '""')}"`,
        r.stored_uzs,
        r.computed_uzs,
        r.diff_uzs,
        r.stored_usd,
        r.computed_usd,
        r.diff_usd,
      ].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  open();
  const db = getDb();
  const { reports } = createServices(db);

  const result = reports.reconcileCustomerAging({});
  const diffs = result.diffs || [];

  console.log('=== Customer Aging Reconciliation ===');
  console.log(`As of: ${result.as_of_date}`);
  console.log(`Aging total (UZS): ${result.aging_total_uzs}`);
  console.log(`Independent calc (UZS): ${result.independent_total_uzs}`);
  console.log(`Independent diff (UZS): ${result.independent_diff_uzs}`);
  console.log(`Per-customer diffs: ${diffs.length}`);

  for (const d of diffs.slice(0, 50)) {
    console.log(
      `  ${d.customer_id} | stored=${d.stored_uzs} computed=${d.computed_uzs} diff=${d.diff_uzs}`
    );
  }
  if (diffs.length > 50) {
    console.log(`  ... and ${diffs.length - 50} more`);
  }

  if (args.csv) {
    const abs = path.resolve(args.csv);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, toCsv(diffs), 'utf8');
    console.log(`CSV written: ${abs}`);
  } else if (diffs.length > 0) {
    const defaultPath = path.join(
      process.env.POS_DATA_DIR || process.cwd(),
      `aging-reconcile-${result.as_of_date}.csv`
    );
    fs.writeFileSync(defaultPath, toCsv(diffs), 'utf8');
    console.log(`CSV written: ${defaultPath}`);
  }

  close();
  process.exit(diffs.length > 0 ? 2 : 0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

module.exports = { toCsv };
