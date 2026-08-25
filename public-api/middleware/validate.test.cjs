'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const { z } = require('zod');
const { validate } = require('./validate.cjs');

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server));
  });
}

test('validate middleware returns 400 + issues for invalid body', async () => {
  const app = express();
  app.use(express.json());
  app.post(
    '/test',
    validate({
      body: z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }),
    }),
    (_req, res) => res.json({ ok: true }),
  );

  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: '' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'validation_error');
    assert.ok(Array.isArray(body.issues));
    assert.ok(body.issues.length >= 1);
    assert.ok(body.issues[0].path);
    assert.ok(body.issues[0].message);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('validate middleware passes parsed body to handler', async () => {
  const app = express();
  app.use(express.json());
  app.post(
    '/test',
    validate({
      body: z.object({
        order_id: z.union([z.number(), z.string()]).transform((v) => Number.parseInt(String(v), 10)),
      }),
    }),
    (req, res) => res.json({ orderId: req.body.order_id }),
  );

  const server = await listen(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: '42' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.orderId, 42);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
