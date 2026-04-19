// =============================================================================
// Multi-tenant RPC dispatcher
// =============================================================================
// Wraps the existing single-tenant dispatcher with tenant resolution. The
// wrapper runs BEFORE `createRpcDispatcher(...)` so:
//
//   1. We handle MASTER-scope channels (`pos:tenants:*`, `pos:master:*`)
//      ourselves — they operate on the registry, not a tenant DB.
//   2. We handle `pos:health` and `pos:appConfig:get` as tenant-agnostic
//      public channels (public status info; same behavior as single-tenant).
//   3. For everything else we resolve the tenant (from the session token's
//      embedded tenantSlug, or from an explicit `tenant` field on the /rpc
//      payload when adminBypass is active), open per-tenant services via
//      the cache, and delegate to a per-tenant dispatcher instance.
//
// Per-tenant dispatcher instances are memoized in `_perTenantDispatchers`
// keyed by tenant id — their internal state (e.g. authorization closures) is
// cheap but we still avoid churning them on every request.
// =============================================================================
'use strict';

const { createRpcDispatcher } = require('./rpcDispatch.cjs');
const { metrics } = require('./metrics.cjs');

const ERR = {
  VALIDATION:  'VALIDATION_ERROR',
  AUTH:        'AUTH_ERROR',
  DENIED:      'PERMISSION_DENIED',
  NOT_FOUND:   'NOT_FOUND',
  CONFLICT:    'CONFLICT',
};

function rpcError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.message = message;
  return e;
}

// Public-before-tenant channels — callable without resolving a tenant.
// Note `pos:auth:login` is NOT here: in MT mode it MUST carry a tenant.
//
// Password reset channels are intentionally NOT here. They still need a
// tenant (users live in tenant DBs) and are routed through the tenant
// dispatcher using the payload `tenant` field — see dispatch() below.
const MASTER_PUBLIC = new Set([
  'pos:health',
  'pos:master:login',                       // super-admin login
  // Unauthenticated login page — logo + colours (no secrets).
  'pos:tenants:publicProfile',
]);

// Channels that ONLY the super-admin (user_scope='master' OR adminBypass)
// may call. These never touch a tenant DB.
const MASTER_ONLY = new Set([
  'pos:tenants:list',
  'pos:tenants:get',
  'pos:tenants:create',
  'pos:tenants:disable',
  'pos:tenants:enable',
  'pos:tenants:setBranding',
  'pos:master:me',
  'pos:master:sessions:list',
  'pos:master:sessions:revoke',
]);

/**
 * @param {{
 *   registry: ReturnType<typeof import('../db/tenantRegistry.cjs').createTenantRegistry>,
 *   servicesCache: ReturnType<typeof import('../services/tenantServices.cjs').createTenantServicesCache>,
 *   masterSessions: ReturnType<typeof import('./masterSessions.cjs').createMasterSessionStore>,
 *   hashPassword?: (plain: string) => string,   // injected by server bootstrap
 *   verifyPassword?: (plain: string, hash: string) => boolean,
 * }} opts
 */
function createMultiTenantDispatcher({
  registry,
  servicesCache,
  masterSessions,
  hashPassword,
  verifyPassword,
} = {}) {
  if (!registry)       throw new Error('registry required');
  if (!servicesCache)  throw new Error('servicesCache required');
  if (!masterSessions) throw new Error('masterSessions required');

  // Per-tenant memoized dispatcher instances. Services are the stateful part;
  // dispatcher is pure routing, but rebuilding on every call wastes closures.
  const perTenantDispatch = new Map(); // tenantId → dispatch fn

  function getTenantDispatcher(tenantId) {
    let fn = perTenantDispatch.get(tenantId);
    if (fn) return fn;
    const db = registry.openTenantDb(tenantId);
    const services = servicesCache.get(tenantId);
    // `sessions` is always the MASTER session store in MT mode — the
    // per-tenant dispatcher only uses it for logout (destroy) and
    // destroyAllForUser. We pass a thin adapter so its API matches what the
    // legacy single-tenant dispatcher expects.
    const sessionsAdapter = {
      destroy: (t) => masterSessions.destroy(t),
      destroyAllForUser: (uid) => masterSessions.destroyAllForUser(uid, 'tenant'),
      verify: (t) => masterSessions.verify(t),
    };
    fn = createRpcDispatcher({ services, db, sessions: sessionsAdapter });
    perTenantDispatch.set(tenantId, fn);
    return fn;
  }

  /**
   * Resolve which tenant a request targets. Priority:
   *   1. authContext.tenantId (stored on the session row) — authoritative.
   *   2. Explicit `tenant` string on the /rpc payload — only trusted when
   *      the request is adminBypass (shared secret). Otherwise ignored to
   *      prevent a tenant user from escaping their tenant via payload spoof.
   *
   * Returns `{ tenantId, slug }` or throws if unresolvable / mismatched.
   */
  function resolveTenant({ authContext, adminBypass, payloadTenant }) {
    if (authContext?.tenantId) {
      // Session-bound tenant always wins and is UNOVERRIDEABLE.
      const t = registry.getTenantById(authContext.tenantId);
      if (!t || !t.is_active) throw rpcError(ERR.AUTH, 'tenant disabled or missing');
      if (payloadTenant && payloadTenant !== t.slug) {
        throw rpcError(ERR.DENIED, 'session tenant does not match requested tenant');
      }
      return { tenantId: t.id, slug: t.slug };
    }
    if (adminBypass) {
      if (!payloadTenant) {
        throw rpcError(ERR.VALIDATION, 'tenant is required when using shared secret');
      }
      const t = registry.getTenantBySlug(payloadTenant);
      if (!t || !t.is_active) throw rpcError(ERR.NOT_FOUND, `unknown or disabled tenant: ${payloadTenant}`);
      return { tenantId: t.id, slug: t.slug };
    }
    throw rpcError(ERR.AUTH, 'tenant could not be determined');
  }

  // ---- Master-scope channel implementations ---------------------------------
  function handleMasterChannel(channel, args, { authContext, adminBypass, ip, userAgent }) {
    const allowed = adminBypass || authContext?.scope === 'master';
    if (MASTER_ONLY.has(channel) && !allowed) {
      throw rpcError(ERR.DENIED, 'master scope required');
    }
    switch (channel) {
      case 'pos:health':
        // Tenant-agnostic probe. Exposes `multi_tenant: true` so the web UI
        // can decide whether to show the tenant field on its login form.
        return { success: true, multi_tenant: true, tenants: registry.listTenants().length };

      case 'pos:tenants:list':
        return registry.listTenants({ includeInactive: !!args?.[0]?.includeInactive })
          .map(publicTenantShape);

      case 'pos:tenants:get': {
        const slug = args?.[0];
        if (!slug) throw rpcError(ERR.VALIDATION, 'slug required');
        const t = registry.getTenantBySlug(String(slug));
        if (!t) throw rpcError(ERR.NOT_FOUND, 'tenant not found');
        return publicTenantShape(t);
      }

      case 'pos:tenants:publicProfile': {
        const raw = args?.[0];
        const slug = raw != null ? String(raw).trim().toLowerCase() : '';
        if (!slug) throw rpcError(ERR.VALIDATION, 'slug required');
        const prof = registry.getPublicTenantProfile(slug);
        if (!prof) throw rpcError(ERR.NOT_FOUND, 'tenant not found');
        return prof;
      }

      case 'pos:tenants:setBranding': {
        const body = args?.[0] || {};
        const slug = body.slug != null ? String(body.slug).trim().toLowerCase() : '';
        const branding = body.branding;
        if (!slug) throw rpcError(ERR.VALIDATION, 'slug required');
        if (!branding || typeof branding !== 'object') {
          throw rpcError(ERR.VALIDATION, 'branding object required');
        }
        registry.mergeTenantBranding(slug, branding);
        const t = registry.getTenantBySlug(slug);
        return publicTenantShape(t);
      }

      case 'pos:tenants:create': {
        const { slug, display_name, admin_username, admin_password } = args?.[0] || {};
        if (!admin_username || !admin_password) {
          throw rpcError(ERR.VALIDATION, 'admin_username and admin_password required');
        }
        if (typeof hashPassword !== 'function') {
          throw rpcError(ERR.NOT_FOUND, 'password hashing is not configured on the server');
        }
        const tenant = registry.createTenant({ slug, display_name });
        // Seed first admin inside the freshly created tenant DB.
        const tdb = registry.openTenantDb(tenant.id);
        const { randomUUID } = require('crypto');
        const uid = randomUUID();
        const hash = hashPassword(String(admin_password));
        tdb.prepare(`
          INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at, full_name, email)
          VALUES (?, ?, ?, 'admin', 1, datetime('now'), datetime('now'), ?, NULL)
        `).run(uid, String(admin_username), hash, String(admin_username));
        return { tenant: publicTenantShape(tenant), admin_user_id: uid };
      }

      case 'pos:tenants:disable': {
        const slug = args?.[0];
        const t = registry.getTenantBySlug(String(slug));
        if (!t) throw rpcError(ERR.NOT_FOUND, 'tenant not found');
        const updated = registry.disableTenant(t.id);
        servicesCache.evict(t.id);
        perTenantDispatch.delete(t.id);
        masterSessions.destroyAllForTenant(t.id);
        return publicTenantShape(updated);
      }

      case 'pos:tenants:enable': {
        const slug = args?.[0];
        const t = registry.getTenantBySlug(String(slug));
        if (!t) throw rpcError(ERR.NOT_FOUND, 'tenant not found');
        return publicTenantShape(registry.enableTenant(t.id));
      }

      case 'pos:master:login': {
        // Arg shape: positional [username, password] OR { username, password }
        const first = args?.[0];
        const username = typeof first === 'string' ? first : first?.username;
        const password = typeof args?.[1] === 'string' ? args[1] : first?.password;
        if (!username || !password) throw rpcError(ERR.VALIDATION, 'username and password required');

        const row = registry.master.prepare(
          'SELECT id, username, password_hash, is_active FROM master_users WHERE username = ?',
        ).get(String(username));
        if (!row || row.is_active === 0) {
          return { success: false, error: 'Invalid credentials' };
        }
        if (typeof verifyPassword !== 'function') {
          throw rpcError(ERR.NOT_FOUND, 'password verification is not configured');
        }
        if (!verifyPassword(String(password), row.password_hash)) {
          return { success: false, error: 'Invalid credentials' };
        }
        registry.master.prepare(
          `UPDATE master_users SET last_login_at = datetime('now') WHERE id = ?`,
        ).run(row.id);
        const session = masterSessions.create({
          user: { id: row.id, username: row.username, role: 'master' },
          scope: 'master',
          ip, userAgent,
        });
        return {
          success: true,
          token: session.token,
          user: { id: row.id, username: row.username, role: 'master', scope: 'master' },
        };
      }

      case 'pos:master:me':
        if (!authContext || authContext.scope !== 'master') {
          throw rpcError(ERR.AUTH, 'master session required');
        }
        return { id: authContext.userId, username: authContext.username, scope: 'master' };

      default:
        throw rpcError(ERR.NOT_FOUND, `unknown master channel: ${channel}`);
    }
  }

  function publicTenantShape(t) {
    let meta = {};
    if (t.meta_json) {
      try { meta = JSON.parse(t.meta_json); } catch { meta = {}; }
    }
    const branding = registry.sanitizeBrandingForPublic(meta.branding);
    return {
      id: t.id, slug: t.slug, display_name: t.display_name,
      is_active: !!t.is_active,
      created_at: t.created_at, disabled_at: t.disabled_at || null,
      branding,
    };
  }

  /**
   * Tenant-scoped login wrapper. Creates a session bound to the resolved
   * tenant; the underlying `services.auth.login` is unchanged.
   */
  function handleTenantLogin({ tenantId, tenantSlug, args, ip, userAgent }) {
    const services = servicesCache.get(tenantId);
    const first = args?.[0];
    const username = typeof first === 'string' ? first : first?.username;
    const password = typeof args?.[1] === 'string' ? args[1] : first?.password;
    const result = services.auth.login(username, password);
    if (!result?.success || !result.user) {
      return { success: false, error: result?.error || 'Invalid credentials' };
    }
    const session = masterSessions.create({
      user: result.user,
      tenantId,
      scope: 'tenant',
      ip, userAgent,
    });
    return {
      success: true,
      token: session.token,
      user: {
        ...result.user,
        tenantSlug,
        tenantId,
      },
      tenant: { id: tenantId, slug: tenantSlug },
    };
  }

  /**
   * Main entry: called from hostServer for every /rpc request.
   *
   * @param {string} channel
   * @param {any[]} args
   * @param {{
   *   authContext: any,                       // from masterSessions.verify
   *   adminBypass: boolean,
   *   payloadTenant?: string,                 // `tenant` field on /rpc payload
   *   ip?: string, userAgent?: string,
   * }} ctx
   */
  async function dispatch(channel, args, ctx) {
    const { authContext, adminBypass, payloadTenant, ip, userAgent } = ctx;

    // 1) Master-scope channels (no tenant DB involved).
    if (MASTER_PUBLIC.has(channel) || MASTER_ONLY.has(channel)) {
      return handleMasterChannel(channel, args, { authContext, adminBypass, ip, userAgent });
    }

    // 2) Tenant-scoped login — resolve tenant explicitly (adminBypass OR
    //    payload tenant). Post-login, session carries tenantId forward.
    if (channel === 'pos:auth:login') {
      if (!payloadTenant && !authContext?.tenantId) {
        throw rpcError(ERR.VALIDATION, 'tenant is required for login');
      }
      const { tenantId, slug } = resolveTenant({
        authContext, adminBypass,
        payloadTenant: payloadTenant || authContext?.tenantSlug,
      });
      return handleTenantLogin({ tenantId, tenantSlug: slug, args, ip, userAgent });
    }

    // 2b) Password-reset flows — unauthenticated but tenant-scoped. The
    //     browser carries the tenant slug in the payload (single-tenant
    //     installs omit it and the server derives it from the only tenant).
    if (channel === 'pos:auth:requestPasswordReset' || channel === 'pos:auth:confirmPasswordReset') {
      let pt = payloadTenant;
      if (!pt) {
        const all = registry.listTenants();
        if (all.length === 1) pt = all[0].slug;
        else throw rpcError(ERR.VALIDATION, 'tenant is required for password reset');
      }
      const t = registry.getTenantBySlug(pt);
      if (!t || !t.is_active) throw rpcError(ERR.NOT_FOUND, `unknown or disabled tenant: ${pt}`);
      const tenantDispatch = getTenantDispatcher(t.id);
      return tenantDispatch(channel, args, {
        authContext: null,
        adminBypass,
        ip, userAgent,
        tenantId: t.id, tenantSlug: t.slug,
      });
    }

    // 3) Anything else needs a tenant context. Resolve from the session.
    const { tenantId, slug } = resolveTenant({ authContext, adminBypass, payloadTenant });
    const tenantDispatch = getTenantDispatcher(tenantId);
    try {
      const res = await tenantDispatch(channel, args, {
        authContext,
        adminBypass,
        ip, userAgent,
        tenantId, tenantSlug: slug,
      });
      try { metrics.tenantRpcCallsTotal.inc({ tenant: slug, outcome: 'ok' }); } catch { /* ignore */ }
      return res;
    } catch (err) {
      const outcome = err?.code === ERR.DENIED ? 'denied' : 'error';
      try { metrics.tenantRpcCallsTotal.inc({ tenant: slug, outcome }); } catch { /* ignore */ }
      throw err;
    }
  }

  function evictTenant(tenantId) {
    perTenantDispatch.delete(tenantId);
    servicesCache.evict(tenantId);
  }

  return {
    dispatch,
    evictTenant,
    MASTER_PUBLIC, MASTER_ONLY,
  };
}

module.exports = { createMultiTenantDispatcher };
