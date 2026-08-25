'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const { validate } = require('../middleware/validate.cjs');
const { staffSaleCreateBodySchema } = require('./staff.schema.cjs');

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

test('staff sale schema rejects empty items with validation_error + issues', async () => {
  const app = express();
  app.use(express.json());
  app.post('/sales', validate({ body: staffSaleCreateBodySchema }), (_req, res) => res.json({ ok: true }));

  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [], payment_method: 'cash' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'validation_error');
    assert.ok(Array.isArray(body.issues));
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
