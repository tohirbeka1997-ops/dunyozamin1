#!/usr/bin/env node
/**
 * Smoke test for print-agent HTTP layer.
 *
 * We don't install node-thermal-printer here (the agent lazy-loads it),
 * so /print and /print/test will fail with a clean "not installed" error —
 * which is actually the exact behaviour we want to verify for the HTTP
 * layer itself (auth, CORS, routing, error envelope).
 *
 * Run:
 *   node print-agent/agent.test.js
 */

'use strict';

const http = require('http');
const { startAgent } = require('./agent');

const PORT = 9899; // avoid colliding with a real agent
const SECRET = 'test-secret-' + Date.now();

const config = {
  agent: {
    bind: '127.0.0.1',
    port: PORT,
    secret: SECRET,
    allowOrigins: ['http://example.test'],
    logFile: null,
  },
  printer: {
    type: 'epson',
    interface: 'printer:Mock',
    timeoutMs: 1000,
    charsPerLine: 48,
    textSize: { width: 0, height: 0 },
    usbVendorId: null,
    usbProductId: null,
    feedLines: 0,
    cut: false,
    retryCount: 0,
  },
};

function request(method, path, { headers = {}, body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      host: '127.0.0.1',
      port: PORT,
      path,
      headers: {
        'Content-Type': 'application/json',
        ...(origin ? { Origin: origin } : {}),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗', msg);
    process.exitCode = 1;
  } else {
    console.log('  ✓', msg);
  }
}

(async () => {
  console.log('Starting agent on 127.0.0.1:' + PORT);
  const server = startAgent({ config });
  // Give the event loop a tick to bind.
  await new Promise((r) => setTimeout(r, 150));

  try {
    console.log('\n1) GET /health is public');
    {
      const r = await request('GET', '/health');
      assert(r.status === 200, 'status 200');
      assert(r.body?.ok === true, 'ok=true');
      assert(r.body?.agent === 'pos-print-agent', 'agent name');
      assert(r.body?.version, 'has version');
    }

    console.log('\n2) Auth required for /config');
    {
      const r = await request('GET', '/config');
      assert(r.status === 401, '401 without bearer');
      assert(r.body?.error?.code === 'AUTH_ERROR', 'AUTH_ERROR code');
    }

    console.log('\n3) Bearer secret unlocks /config');
    {
      const r = await request('GET', '/config', { headers: { Authorization: `Bearer ${SECRET}` } });
      assert(r.status === 200, '200 with correct bearer');
      assert(r.body?.ok === true, 'ok=true');
      assert(r.body?.data?.printer?.interface === 'printer:Mock', 'printer echoed');
      assert(r.body?.data?.agent?.secret === '***', 'secret redacted');
    }

    console.log('\n4) Wrong bearer still rejected');
    {
      const r = await request('GET', '/config', { headers: { Authorization: 'Bearer nope' } });
      assert(r.status === 401, '401 on wrong bearer');
    }

    console.log('\n5) Unknown route returns 404 envelope');
    {
      const r = await request('GET', '/does-not-exist', { headers: { Authorization: `Bearer ${SECRET}` } });
      assert(r.status === 404, '404 status');
      assert(r.body?.error?.code === 'NOT_FOUND', 'NOT_FOUND code');
    }

    console.log('\n6) CORS — allowed origin');
    {
      const r = await request('OPTIONS', '/print', {
        origin: 'http://example.test',
        headers: { 'Access-Control-Request-Method': 'POST' },
      });
      assert(r.status === 204, 'preflight 204');
      assert(r.headers['access-control-allow-origin'] === 'http://example.test', 'ACAO echoes allowed origin');
      assert(/POST/.test(String(r.headers['access-control-allow-methods'] || '')), 'ACAM includes POST');
    }

    console.log('\n7) CORS — disallowed origin preflight rejected');
    {
      const r = await request('OPTIONS', '/print', {
        origin: 'http://evil.test',
        headers: { 'Access-Control-Request-Method': 'POST' },
      });
      assert(r.status === 403, 'preflight 403 for unlisted origin');
    }

    console.log('\n8) POST /print — empty receipt rejected as PRINT_FAILED');
    {
      const r = await request('POST', '/print', {
        headers: { Authorization: `Bearer ${SECRET}` },
        body: { lines: [] },
      });
      assert(r.status === 200, '200 with error envelope');
      assert(r.body?.ok === false, 'ok=false');
      assert(r.body?.error?.code === 'PRINT_FAILED', 'PRINT_FAILED code');
      assert(/empty receipt/i.test(r.body?.error?.message || ''), 'empty receipt message');
    }

    console.log('\n9) POST /print — surfaces missing-driver error cleanly');
    {
      const r = await request('POST', '/print', {
        headers: { Authorization: `Bearer ${SECRET}` },
        body: { lines: [{ text: 'Hi' }] },
      });
      assert(r.status === 200, '200 with error envelope');
      assert(r.body?.ok === false, 'ok=false (no node-thermal-printer in this env)');
      const msg = String(r.body?.error?.message || '');
      // Either the module is missing OR the mock printer interface fails to open.
      const expected = /node-thermal-printer/i.test(msg) || /spooler print failed/i.test(msg) || /printer/i.test(msg);
      assert(expected, `error message is meaningful (got: ${msg})`);
    }

    console.log('\n10) GET /scale/read when disabled returns SCALE_DISABLED');
    {
      const r = await request('GET', '/scale/read', { headers: { Authorization: `Bearer ${SECRET}` } });
      assert(r.status === 200, '200 with envelope');
      assert(r.body?.ok === false, 'ok=false when disabled');
      assert(r.body?.error?.code === 'SCALE_DISABLED', 'SCALE_DISABLED code');
    }

    console.log('\n11) GET /scale/ports returns clear error when serialport missing');
    {
      const r = await request('GET', '/scale/ports', { headers: { Authorization: `Bearer ${SECRET}` } });
      assert(r.status === 200, '200 with envelope');
      // Either serialport is installed (ok=true with array) OR we get a
      // meaningful SCALE_UNAVAILABLE error — both are acceptable.
      if (r.body?.ok === true) {
        assert(Array.isArray(r.body?.data), 'ports is an array');
      } else {
        assert(r.body?.error?.code === 'SCALE_UNAVAILABLE', 'SCALE_UNAVAILABLE code');
        assert(/serialport/i.test(r.body?.error?.message || ''), 'message mentions serialport');
      }
    }

    console.log('\n12) GET /config echoes scale config block');
    {
      const r = await request('GET', '/config', { headers: { Authorization: `Bearer ${SECRET}` } });
      assert(r.body?.data?.scale?.enabled === false, 'scale.enabled=false in config');
    }

    console.log('\n13) /scale/read rejects missing bearer');
    {
      const r = await request('GET', '/scale/read');
      assert(r.status === 401, '401 without bearer');
    }

    console.log('\n14) Parse ASCII scale frames');
    {
      const { parseAsciiLine } = require('./lib/scale');
      const a = parseAsciiLine('ST,+  0.245kg');
      assert(a && a.weight === 0.245 && a.unit === 'kg' && a.stable === true, 'basic stable frame');
      const b = parseAsciiLine('US,+  0.500kg');
      assert(b && b.stable === false, 'unstable frame');
      const c = parseAsciiLine('  1.234  ');
      assert(c && c.weight === 1.234 && c.unit === 'kg', 'bare number assumes kg');
      const d = parseAsciiLine('S S    12.50 lb');
      assert(d && d.weight === 12.5 && d.unit === 'lb', 'pounds');
      const e = parseAsciiLine('');
      assert(e === null, 'empty rejected');
      const f = parseAsciiLine('garbage');
      assert(f === null, 'non-numeric rejected');
    }

    console.log('\n15) Malformed JSON rejected');
    {
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            method: 'POST',
            host: '127.0.0.1',
            port: PORT,
            path: '/print',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SECRET}`,
            },
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              let parsed = null;
              try { parsed = JSON.parse(data); } catch { /* ignore */ }
              assert(res.statusCode === 500 || res.statusCode === 200, 'handled (500 or 200 envelope)');
              assert(parsed?.ok === false, 'error envelope');
              resolve();
            });
          }
        );
        req.on('error', reject);
        req.write('{not valid json');
        req.end();
      });
    }

    console.log('\nDone.');
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});
