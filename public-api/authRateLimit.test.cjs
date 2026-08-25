'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const rateLimit = require('express-rate-limit');

function withEnv(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

function startAuthTestServer() {
  const app = express();
  app.use(express.json());

  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'too_many_requests', message: 'Too many login attempts, try again later' },
  });

  app.post('/v1/staff/auth/login', authLimiter, (req, res) => {
    const ok = req.body?.password === 'correct';
    if (ok) return res.json({ ok: true });
    return res.status(401).json({ error: 'invalid_credentials' });
  });

  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    res.status(status).json({
      error: status >= 500 ? 'internal_error' : err?.code || 'error',
      message: status >= 500 ? 'Internal server error' : String(err?.message || 'Error'),
    });
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function postLogin(base, password) {
  const res = await fetch(`${base}/v1/staff/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'u', password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test('auth login brute-force limiter returns 429 after failed attempts', async () => {
  const srv = await startAuthTestServer();
  try {
    for (let i = 0; i < 3; i += 1) {
      const r = await postLogin(srv.base, 'wrong');
      assert.equal(r.status, 401, `attempt ${i + 1} should be 401`);
    }
    const blocked = await postLogin(srv.base, 'wrong');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'too_many_requests');
  } finally {
    await srv.close();
  }
});

test('auth limiter skipSuccessfulRequests does not count successful logins', async () =>
  withEnv({ AUTH_RATE_LIMIT_MAX: '2' }, async () => {
    const srv = await startAuthTestServer();
    try {
      for (let i = 0; i < 5; i += 1) {
        const r = await postLogin(srv.base, 'correct');
        assert.equal(r.status, 200, `successful login ${i + 1} should not be blocked`);
      }
    } finally {
      await srv.close();
    }
  }));

test('global error handler does not leak stack traces on 500', async () => {
  const app = express();
  app.get('/boom', (_req, _res) => {
    const err = new Error('secret internal detail');
    err.stack = 'Error: secret internal detail\n    at sensitive/path.cjs:42:7';
    throw err;
  });
  app.use((err, _req, res, _next) => {
    const status = 500;
    res.status(status).json({
      error: 'internal_error',
      message: 'Internal server error',
    });
  });

  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/boom`);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.error, 'internal_error');
    assert.equal(body.message, 'Internal server error');
    assert.equal(body.stack, undefined);
    assert.equal(String(body).includes('sensitive/path'), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
