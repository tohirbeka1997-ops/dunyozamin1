import test from 'node:test';
import assert from 'node:assert/strict';

function resolveReportStatus(data, isEmpty) {
  return isEmpty(data) ? 'empty' : 'success';
}

function createReportCorrelationId(page) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `rpt-${page}-${Date.now()}-${suffix}`;
}

test('resolveReportStatus distinguishes empty from success', () => {
  assert.equal(resolveReportStatus([], (r) => r.length === 0), 'empty');
  assert.equal(resolveReportStatus([1], (r) => r.length === 0), 'success');
});

test('createReportCorrelationId is unique and prefixed', () => {
  const a = createReportCorrelationId('stock');
  const b = createReportCorrelationId('stock');
  assert.notEqual(a, b);
  assert.match(a, /^rpt-stock-/);
});
