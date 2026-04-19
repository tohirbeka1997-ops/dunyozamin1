/**
 * Smoke test — provisioned Grafana dashboard JSON (POS / Tenants).
 *   node electron/net/grafanaTenantsDashboard.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DASH = path.resolve(__dirname, '../../deploy/monitoring/grafana/dashboards/pos-tenants.json');

let passed = 0;
let failed = 0;
function run(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL - ${name}\n    ${e.message}`);
    failed++;
  }
}

(async () => {
  console.log('# Grafana pos-tenants dashboard');

  run('JSON parses', () => {
    const raw = fs.readFileSync(DASH, 'utf8');
    JSON.parse(raw);
  });

  /** @type {any} */
  let dash;
  run('has uid + title + tenant templating', () => {
    dash = JSON.parse(fs.readFileSync(DASH, 'utf8'));
    assert.strictEqual(dash.uid, 'pos-tenants');
    assert.ok(String(dash.title).includes('Tenants'));
    const list = dash.templating?.list || [];
    const t = list.find((x) => x.name === 'tenant');
    assert.ok(t, 'missing tenant variable');
    assert.strictEqual(t.type, 'query');
    assert.ok(String(t.query).includes('pos_tenant_db_size_bytes'), 'tenant query should use DB size metric');
    assert.strictEqual(t.allValue, '.*');
    assert.strictEqual(t.includeAll, true);
  });

  run('panels reference $tenant and tenant metrics', () => {
    const blob = JSON.stringify(dash.panels);
    assert.ok(blob.includes('pos_tenant_db_size_bytes'), 'panels should use pos_tenant_db_size_bytes');
    assert.ok(blob.includes('pos_tenant_rpc_calls_total'), 'panels should use pos_tenant_rpc_calls_total');
    assert.ok(blob.includes('$tenant'), 'panels should use $tenant variable');
    assert.ok(blob.includes('pos_tenants_total'), 'fleet stats should use pos_tenants_total');
  });

  console.log(`\n# results: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
