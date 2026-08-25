'use strict';

/**
 * Smoke: public-api/lib modules resolve deps inside pos-server Docker layout.
 * Run after `docker build` or inside a running container:
 *   node scripts/docker-public-api-deps.smoke.cjs
 *   docker run --rm pos-server:latest node scripts/docker-public-api-deps.smoke.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function requireFromApp(relativePath) {
  const full = path.join(ROOT, relativePath);
  assert.ok(fs.existsSync(full), `missing ${relativePath}`);
  return require(full);
}

// Same chain as rpcDispatch → creditReminder → smsGateway → logger → pino
const { logger } = requireFromApp('public-api/lib/logger.cjs');
assert.equal(typeof logger.info, 'function');

requireFromApp('public-api/lib/smsGateway.cjs');
requireFromApp('public-api/lib/creditReminder.cjs');

console.log('[docker-public-api-deps] OK — pino and creditReminder chain load');
