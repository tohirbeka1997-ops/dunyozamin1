// =============================================================================
// Per-tenant services cache
// =============================================================================
// `createServices(db)` in ./index.cjs returns a bag of service instances all
// bound to one DB handle. In multi-tenant mode we need one such bag per
// tenant — created lazily on first access and cached for the process lifetime.
//
// Rules we preserve:
//   * A tenant's services are ONLY ever given that tenant's DB handle —
//     never cross-wired. The only cross-tenant surface is the admin
//     `pos:tenants:*` RPCs, which talk to the registry/master DB directly
//     and do NOT use tenant service instances.
//   * Services are stateful (caches, counters) — we MUST memoize by
//     tenant id, not create fresh bags per request.
// =============================================================================
'use strict';

const { createServices } = require('./index.cjs');

/**
 * @param {{
 *   registry: ReturnType<typeof import('../db/tenantRegistry.cjs').createTenantRegistry>,
 * }} opts
 */
function createTenantServicesCache({ registry }) {
  if (!registry) throw new Error('registry is required');

  /** tenantId → ReturnType<typeof createServices> */
  const cache = new Map();

  function get(tenantId) {
    let bag = cache.get(tenantId);
    if (bag) return bag;
    const db = registry.openTenantDb(tenantId);
    bag = createServices(db);
    cache.set(tenantId, bag);
    return bag;
  }

  /** Drop a tenant's services (call after disable/remove so caches aren't stale). */
  function evict(tenantId) {
    cache.delete(tenantId);
  }

  function clear() {
    cache.clear();
  }

  function size() { return cache.size; }

  return { get, evict, clear, size };
}

module.exports = { createTenantServicesCache };
