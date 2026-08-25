/**
 * Mock createCreditOrder debt-sign regression (NEGATIVE = debt).
 * Run: node --test src/db/__tests__/createCreditOrder.mock.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.resolve(__dirname, '../customerCredit.api.ts');

test('mock createCreditOrder source: subtracts total (debt negative), on_credit, no credit payment row', () => {
  const src = fs.readFileSync(apiPath, 'utf8');

  // Isolate the mock fallback branch (after hasPosApi early-return).
  const mockStart = src.indexOf('await delay();\n  \n  const orderId = generateId();');
  assert.ok(mockStart > 0, 'mock createCreditOrder branch not found');
  const mockBranch = src.slice(mockStart, src.indexOf('export const receiveCustomerPayment'));

  assert.match(mockBranch, /const newBalance = currentBalance - orderData\.total_amount/);
  assert.match(mockBranch, /new_balance: -orderData\.total_amount/);
  assert.match(mockBranch, /payment_status:\s*'on_credit'/);
  assert.doesNotMatch(mockBranch, /payment_method:\s*'credit'/);
  assert.doesNotMatch(mockBranch, /savePayments\(/);
});

test('mock balance math: credit sale decreases balance', () => {
  const currentBalance = 0;
  const totalAmount = 50000;
  const newBalance = currentBalance - totalAmount;
  assert.equal(newBalance, -50000);

  const missingCustomerBalance = -totalAmount;
  assert.equal(missingCustomerBalance, -50000);

  const secondSale = newBalance - 12000;
  assert.equal(secondSale, -62000);
});

test('mock completePOSOrder source: subtracts creditAmount (debt negative)', () => {
  const ordersApiPath = path.resolve(__dirname, '../orders.api.ts');
  const src = fs.readFileSync(ordersApiPath, 'utf8');
  // Mock branch after hasPosApi IPC early-return
  const mockStart = src.indexOf('// Fallback to mock/localStorage for dev/testing');
  assert.ok(mockStart > 0, 'mock completePOSOrder branch marker not found');
  const mockBranch = src.slice(mockStart);
  assert.match(mockBranch, /balance:\s*currentBalance\s*-\s*creditAmount/);
  assert.doesNotMatch(mockBranch, /balance:\s*currentBalance\s*\+\s*creditAmount/);
});
