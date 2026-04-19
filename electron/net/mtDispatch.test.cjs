/* eslint-disable no-console */
// =============================================================================
// mtDispatch.test.cjs — routing tests for the multi-tenant dispatcher
// =============================================================================
// Goal: exercise the tenant-resolution and master-channel branches WITHOUT
// touching better-sqlite3 (whose binary is ABI-tied to the local Node). We
// inject a fake registry, a fake per-tenant dispatcher factory, and a fake
// services cache so every assertion is deterministic.
// =============================================================================
'use strict';

// We need to replace createRpcDispatcher BEFORE requiring mtDispatch. Use a
// tiny module-interception trick via Module._cache.
const Module = require('module');
const path = require('path');

// Build the per-tenant fake that records the channel + tenant it receives.
const perTenantCalls = [];
const fakePerTenantDispatch = (channel, args, ctx) => {
  perTenantCalls.push({ channel, args, ctx });
  return { channel, tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug };
};

const rpcDispatchPath = require.resolve('./rpcDispatch.cjs');
require.cache[rpcDispatchPath] = {
  id: rpcDispatchPath,
  filename: rpcDispatchPath,
  loaded: true,
  exports: { createRpcDispatcher: () => fakePerTenantDispatch },
};

const metricsPath = require.resolve('./metrics.cjs');
const metricsStub = {
  metrics: {
    tenantRpcCallsTotal: {
      inc: () => {},
    },
  },
};
require.cache[metricsPath] = {
  id: metricsPath,
  filename: metricsPath,
  loaded: true,
  exports: metricsStub,
};

const assert = require('assert');
const { createMultiTenantDispatcher } = require('./mtDispatch.cjs');

// ---- Fake registry ---------------------------------------------------------
function makeRegistry() {
  const tenants = new Map();
  const masterUsers = new Map();
  function addTenant(row) {
    tenants.set(row.id, {
      is_active: 1, disabled_at: null,
      created_at: new Date().toISOString(),
      ...row,
    });
    return tenants.get(row.id);
  }
  // Minimal master DB impl — only what the master channels touch.
  const master = {
    prepare(sql) {
      const s = String(sql);
      if (/SELECT id, username, password_hash, is_active FROM master_users WHERE username/i.test(s)) {
        return { get: (u) => masterUsers.get(u) || null };
      }
      if (/UPDATE master_users SET last_login_at/i.test(s)) {
        return { run: () => ({ changes: 1 }) };
      }
      throw new Error('unexpected SQL: ' + s);
    },
  };

  function sanitizeBrandingForPublic(branding) {
    const out = {};
    const b = branding && typeof branding === 'object' ? branding : {};
    if (typeof b.logoUrl === 'string') {
      const u = b.logoUrl.trim().slice(0, 512);
      if (/^https:\/\//i.test(u)) out.logoUrl = u;
    }
    for (const key of ['primaryColor', 'accentColor']) {
      const v = b[key];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())) {
        out[key] = v.trim().toLowerCase();
      }
    }
    return out;
  }

  return {
    master,
    masterPath: ':memory:',
    tenants,
    masterUsers,
    listTenants: ({ includeInactive = false } = {}) =>
      [...tenants.values()].filter((t) => includeInactive || t.is_active),
    getTenantBySlug: (s) => [...tenants.values()].find((t) => t.slug === s) || null,
    getTenantById:   (id) => tenants.get(id) || null,
    createTenant: ({ slug, display_name }) => addTenant({ id: 'id-' + slug, slug, display_name, db_path: '/fake' }),
    disableTenant: (id) => {
      const t = tenants.get(id); if (t) { t.is_active = 0; t.disabled_at = new Date().toISOString(); }
      return t;
    },
    enableTenant: (id) => { const t = tenants.get(id); if (t) t.is_active = 1; return t; },
    openTenantDb: (id) => {
      // Return a fake DB that supports prepare('INSERT INTO users ...').run(...)
      return {
        prepare: (sql) => ({
          run: (..._args) => ({ changes: 1 }),
          get: () => null, all: () => [],
        }),
      };
    },
    sanitizeBrandingForPublic,
    getPublicTenantProfile(slug) {
      const t = [...tenants.values()].find((x) => x.slug === slug && x.is_active);
      if (!t) return null;
      let meta = {};
      if (t.meta_json) try { meta = JSON.parse(t.meta_json); } catch { meta = {}; }
      return {
        slug: t.slug,
        display_name: t.display_name,
        branding: sanitizeBrandingForPublic(meta.branding),
      };
    },
    mergeTenantBranding(slug, patch) {
      const t = [...tenants.values()].find((x) => x.slug === slug);
      if (!t) throw new Error(`unknown tenant: ${slug}`);
      let meta = {};
      if (t.meta_json) try { meta = JSON.parse(t.meta_json); } catch { meta = {}; }
      const prev = meta.branding && typeof meta.branding === 'object' ? { ...meta.branding } : {};
      meta.branding = { ...prev, ...patch };
      t.meta_json = JSON.stringify(meta);
      return t;
    },
    addTenant,
  };
}

function makeServicesCache() {
  const store = new Map();
  return {
    get(id) {
      if (!store.has(id)) {
        store.set(id, {
          auth: {
            login(username, password) {
              if (username === 'cash' && password === 'secret') {
                return { success: true, user: { id: 'u-' + id, username: 'cash', role: 'cashier' } };
              }
              return { success: false, error: 'Invalid credentials' };
            },
          },
        });
      }
      return store.get(id);
    },
    evict: (id) => store.delete(id),
    clear: () => store.clear(),
    size: () => store.size,
  };
}

function makeMasterSessions() {
  const tokens = new Map();
  let n = 0;
  return {
    create({ user, tenantId = null, scope = 'tenant' }) {
      const token = 't_' + (++n);
      const ctx = {
        userId: String(user.id),
        username: user.username, role: user.role,
        tenantId, tenantSlug: null, scope,
        expiresAtMs: Date.now() + 60_000,
      };
      tokens.set(token, ctx);
      return { token, expiresAt: '...', ...ctx };
    },
    verify: (t) => tokens.get(t) || null,
    destroy: (t) => tokens.delete(t),
    destroyAllForUser: () => 0,
    destroyAllForTenant: () => 0,
  };
}

function hashPassword(p) {
  return require('crypto').createHash('sha256').update(String(p)).digest('hex');
}
function verifyPassword(p, h) { return hashPassword(p) === h; }

// ---- Tests -----------------------------------------------------------------
const results = [];
async function run(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓', name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗', name, '\n    ', e.message); }
}

(async () => {
  await run('pos:health is public (no tenant needed) and advertises MT mode', async () => {
    const reg = makeRegistry();
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    // Bosqich 16: pos:health now responds from the master handler with a
    // tenant-agnostic payload advertising multi_tenant=true so the browser
    // can gate tenant UI without a separate config endpoint.
    const res = await d.dispatch('pos:health', [], { authContext: null, adminBypass: false });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.multi_tenant, true);
    assert.strictEqual(typeof res.tenants, 'number');
  });

  await run('pos:tenants:publicProfile is public and returns sanitized branding', async () => {
    const reg = makeRegistry();
    reg.addTenant({
      id: 'id-a', slug: 'a', display_name: 'Shop A', db_path: '/x',
      meta_json: JSON.stringify({
        branding: {
          logoUrl: 'https://cdn.example.com/logo.png',
          primaryColor: '#AABBCC',
          accentColor: 'not-a-color',
        },
      }),
    });
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    const prof = await d.dispatch('pos:tenants:publicProfile', ['a'], {
      authContext: null, adminBypass: false,
    });
    assert.strictEqual(prof.slug, 'a');
    assert.strictEqual(prof.display_name, 'Shop A');
    assert.strictEqual(prof.branding.logoUrl, 'https://cdn.example.com/logo.png');
    assert.strictEqual(prof.branding.primaryColor, '#aabbcc');
    assert.strictEqual(prof.branding.accentColor, undefined);
  });

  await run('pos:tenants:setBranding requires master scope', async () => {
    const reg = makeRegistry();
    reg.addTenant({ id: 'id-a', slug: 'a', display_name: 'A', db_path: '/x' });
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    await assert.rejects(
      () => d.dispatch('pos:tenants:setBranding', [{ slug: 'a', branding: { primaryColor: '#112233' } }], {
        authContext: { scope: 'tenant', tenantId: 'id-a' },
        adminBypass: false,
      }),
      /master scope required/,
    );
    const out = await d.dispatch('pos:tenants:setBranding', [{ slug: 'a', branding: { primaryColor: '#112233' } }], {
      authContext: null, adminBypass: true,
    });
    assert.strictEqual(out.slug, 'a');
    assert.strictEqual(out.branding.primaryColor, '#112233');
  });

  await run('pos:tenants:list requires master scope', async () => {
    const reg = makeRegistry();
    reg.addTenant({ id: 'id-a', slug: 'a', display_name: 'A', db_path: '/x' });
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    // As a tenant user — denied.
    await assert.rejects(
      () => d.dispatch('pos:tenants:list', [], { authContext: { scope: 'tenant', tenantId: 'id-a' }, adminBypass: false }),
      /master scope required/,
    );
    // With adminBypass — allowed.
    const list = await d.dispatch('pos:tenants:list', [], { authContext: null, adminBypass: true });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].slug, 'a');
  });

  await run('pos:tenants:create seeds an admin user and returns tenant shape', async () => {
    const reg = makeRegistry();
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    const out = await d.dispatch('pos:tenants:create', [{
      slug: 'b', display_name: 'B',
      admin_username: 'admin', admin_password: 'secret123',
    }], { authContext: null, adminBypass: true });
    assert.strictEqual(out.tenant.slug, 'b');
    assert.ok(out.admin_user_id);
  });

  await run('pos:auth:login requires tenant in adminBypass mode', async () => {
    const reg = makeRegistry();
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    await assert.rejects(
      () => d.dispatch('pos:auth:login', ['cash', 'secret'], {
        authContext: null, adminBypass: true, payloadTenant: null,
      }),
      /tenant is required/,
    );
  });

  await run('pos:auth:login with tenant succeeds → returns token bound to that tenant', async () => {
    const reg = makeRegistry();
    reg.addTenant({ id: 'id-x', slug: 'x', display_name: 'X', db_path: '/x' });
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    const out = await d.dispatch('pos:auth:login', ['cash', 'secret'], {
      authContext: null, adminBypass: true, payloadTenant: 'x',
    });
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.tenant.slug, 'x');
    assert.ok(out.token);
  });

  await run('payload tenant CANNOT override session tenant (anti-spoof)', async () => {
    const reg = makeRegistry();
    reg.addTenant({ id: 'id-x', slug: 'x', display_name: 'X', db_path: '/x' });
    reg.addTenant({ id: 'id-y', slug: 'y', display_name: 'Y', db_path: '/y' });
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    await assert.rejects(
      () => d.dispatch('pos:products:list', [], {
        authContext: { scope: 'tenant', tenantId: 'id-x', tenantSlug: 'x' },
        adminBypass: false,
        payloadTenant: 'y',
      }),
      /session tenant does not match/,
    );
  });

  await run('regular channel routes to per-tenant dispatcher with correct tenantId', async () => {
    const reg = makeRegistry();
    reg.addTenant({ id: 'id-x', slug: 'x', display_name: 'X', db_path: '/x' });
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    perTenantCalls.length = 0;
    const res = await d.dispatch('pos:products:list', [], {
      authContext: { scope: 'tenant', tenantId: 'id-x', tenantSlug: 'x' },
      adminBypass: false,
    });
    assert.strictEqual(perTenantCalls.length, 1);
    assert.strictEqual(perTenantCalls[0].channel, 'pos:products:list');
    assert.strictEqual(perTenantCalls[0].ctx.tenantId, 'id-x');
    assert.strictEqual(res.tenantSlug, 'x');
  });

  await run('disabled tenant blocks all tenant-scoped RPCs', async () => {
    const reg = makeRegistry();
    const t = reg.addTenant({ id: 'id-z', slug: 'z', display_name: 'Z', db_path: '/z' });
    t.is_active = 0;
    const d = createMultiTenantDispatcher({
      registry: reg, servicesCache: makeServicesCache(),
      masterSessions: makeMasterSessions(), hashPassword, verifyPassword,
    });
    await assert.rejects(
      () => d.dispatch('pos:products:list', [], {
        authContext: { scope: 'tenant', tenantId: 'id-z', tenantSlug: 'z' },
        adminBypass: false,
      }),
      /tenant disabled/,
    );
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
  if (failed) process.exit(1);
  console.log('\nOK — mtDispatch routing tests passed');
})();
