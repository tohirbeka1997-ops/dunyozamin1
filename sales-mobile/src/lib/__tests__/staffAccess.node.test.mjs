/**
 * Unit tests for staffAccess contract (cashier matrix).
 * Run: node --test src/lib/__tests__/staffAccess.node.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}
function canAccessWebOrders(role) {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'manager' || r === 'sales';
}

test('cashier cannot access web orders / purchasing / expenses', () => {
  assert.equal(canAccessWebOrders('cashier'), false);
  assert.equal(canAccessWebOrders('admin'), true);
  assert.equal(canAccessWebOrders('sales'), true);
  assert.equal(canAccessWebOrders('manager'), true);
});

test('role normalize is case-insensitive', () => {
  assert.equal(canAccessWebOrders('Cashier'), false);
  assert.equal(canAccessWebOrders('ADMIN'), true);
});

test('staffAccess.ts exports expected helpers', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, '..', 'staffAccess.ts'), 'utf8');
  for (const name of [
    'isCashierRole',
    'canAccessWebOrders',
    'canAccessPurchasing',
    'canAccessSuppliers',
    'canAccessExpenses',
    'canSeeCost',
  ]) {
    assert.match(src, new RegExp(`export function ${name}`));
  }
});
