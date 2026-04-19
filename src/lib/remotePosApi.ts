/**
 * Browser / Telegram WebView: mirror `electron/preload.cjs` `window.posApi` via HOST HTTP RPC.
 *
 * Auth model:
 *   - Bootstrap token  = `VITE_POS_RPC_SECRET`
 *       * used ONLY for `pos:auth:login`, `pos:auth:requestPasswordReset`,
 *         `pos:auth:confirmPasswordReset`, `pos:health`, `pos:appConfig:get`.
 *       * All other calls require a session token.
 *   - Session token    = returned by `pos:auth:login` and stored in
 *       `localStorage["pos_session_token"]`. All subsequent requests send it
 *       as `Authorization: Bearer <session-token>`.
 *   - On 401 the stored token is cleared and a `pos:auth:required` DOM event
 *     is dispatched so the app can redirect to /login.
 */

const STORAGE_KEY = 'pos_session_token';
const STORAGE_EXP_KEY = 'pos_session_expires_at';
// Multi-tenant additions (Bosqich 16):
//   * pos_tenant_slug     — tenant the current session is pinned to (informational;
//                           server enforces tenant binding via the token itself).
//   * pos_auth_scope      — "tenant" (default) or "master" when signed in via
//                           pos:master:login. Drives admin UI gating.
const STORAGE_TENANT_KEY = 'pos_tenant_slug';
const STORAGE_SCOPE_KEY  = 'pos_auth_scope';

const PUBLIC_CHANNELS = new Set<string>([
  'pos:auth:login',
  'pos:auth:requestPasswordReset',
  'pos:auth:confirmPasswordReset',
  'pos:health',
  'pos:appConfig:get',
  // Login page — tenant logo + colours (https URLs and #RRGGBB only server-side).
  'pos:tenants:publicProfile',
  // Master-scope login is callable without any credential (it IS the credential
  // gate). It must NOT use a stale tenant session token — pin it to the
  // bootstrap secret bearer instead.
  'pos:master:login',
]);

// Channels that route to the MASTER DB (super-admin scope). They never target
// a tenant — the `tenant` payload field is ignored for them server-side, but
// the client should also avoid attaching a stale tenantSlug so the intent is
// unambiguous in audit logs.
const MASTER_CHANNELS = new Set<string>([
  'pos:master:login',
  'pos:master:me',
  'pos:tenants:list',
  'pos:tenants:get',
  'pos:tenants:create',
  'pos:tenants:disable',
  'pos:tenants:enable',
  'pos:tenants:setBranding',
]);

export function getSessionToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return null;
    const expAt = localStorage.getItem(STORAGE_EXP_KEY);
    if (expAt) {
      const ms = Date.parse(String(expAt).replace(' ', 'T') + 'Z');
      if (Number.isFinite(ms) && ms > 0 && ms <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_EXP_KEY);
        return null;
      }
    }
    return token;
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null, expiresAt?: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
      if (expiresAt) localStorage.setItem(STORAGE_EXP_KEY, String(expiresAt));
      else localStorage.removeItem(STORAGE_EXP_KEY);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_EXP_KEY);
      // When the session is cleared (logout, 401) tenant + scope become
      // stale. Drop them together so no UI can reach back to stale admin
      // views without a fresh login.
      localStorage.removeItem(STORAGE_TENANT_KEY);
      localStorage.removeItem(STORAGE_SCOPE_KEY);
    }
  } catch {
    // ignore
  }
}

// --- Tenant slug + auth scope --------------------------------------------
// Kept separate from token storage because the token is enough for the
// server — these two values exist purely to drive the CLIENT UI (which tab
// to show, which route to redirect to). They are NOT trusted on the
// server: the server re-derives everything from the token.

export function getTenantSlug(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_TENANT_KEY);
  } catch { return null; }
}

export function setTenantSlug(slug: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (slug) localStorage.setItem(STORAGE_TENANT_KEY, slug);
    else localStorage.removeItem(STORAGE_TENANT_KEY);
  } catch { /* ignore */ }
}

export type AuthScope = 'tenant' | 'master';

export function getAuthScope(): AuthScope | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(STORAGE_SCOPE_KEY);
    return v === 'master' || v === 'tenant' ? v : null;
  } catch { return null; }
}

export function setAuthScope(scope: AuthScope | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (scope) localStorage.setItem(STORAGE_SCOPE_KEY, scope);
    else localStorage.removeItem(STORAGE_SCOPE_KEY);
  } catch { /* ignore */ }
}

/**
 * Best-effort subdomain → tenant slug extraction.
 *
 * Rule: `<slug>.<anything>` where `<slug>` matches the server-side regex
 * (`[a-z0-9][a-z0-9_-]{1,39}`). Two-label domains like `example.com`, bare
 * IPs, and `localhost` return null so the UI falls back to a manual field.
 *
 * This runs on every page load — it must stay cheap and dependency-free.
 */
export function extractTenantSlugFromHost(host?: string | null): string | null {
  const h = (host ?? (typeof window !== 'undefined' ? window.location?.hostname : null) ?? '').toLowerCase();
  if (!h) return null;
  if (h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  const parts = h.split('.');
  if (parts.length < 3) return null;
  const slug = parts[0];
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(slug)) return null;
  // Reserved subdomains — server rejects them as slugs anyway; bail early
  // so the UI doesn't light up a misleading "active tenant" badge.
  if (['www', 'admin', 'api', 'app'].includes(slug)) return null;
  return slug;
}

function dispatchAuthRequired(reason: string) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('pos:auth:required', { detail: { reason } }));
    }
  } catch {
    // ignore
  }
}

async function remoteInvoke(
  baseUrl: string,
  bootstrapSecret: string,
  channel: string,
  ...args: unknown[]
): Promise<
  | { success: true; data: unknown }
  | { success: false; error: { code: string; message: string; details?: unknown } }
> {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/rpc`;

  // Pick the correct bearer:
  //   - public/bootstrap channels use the shared secret (login, health, ...)
  //   - everything else uses the session token; if none we still try the
  //     shared secret as a fallback so single-user / legacy installs keep
  //     working (admin-only channels are blocked server-side anyway).
  const sessionToken = getSessionToken();
  const bearer = PUBLIC_CHANNELS.has(channel) ? bootstrapSecret : (sessionToken || bootstrapSecret);

  // Multi-tenant payload field. Rules:
  //   * pos:auth:login — tenant MUST be in the payload (server can't guess).
  //     We take it from the FIRST positional argument if it's `{ tenant }`,
  //     otherwise from localStorage / env / subdomain (in that order).
  //   * Master channels — never send tenant (intent must be unambiguous).
  //   * Any other call — send the stored tenant slug as a hint; the server
  //     ignores it unless using adminBypass (it cross-checks with the
  //     session-bound tenant to prevent payload spoofing).
  let payloadTenant: string | undefined;
  if (!MASTER_CHANNELS.has(channel)) {
    if (channel === 'pos:auth:login' && args.length > 0 && args[0] && typeof args[0] === 'object') {
      const first = args[0] as { tenant?: unknown };
      if (typeof first.tenant === 'string' && first.tenant) {
        payloadTenant = first.tenant;
        // Strip tenant from args — server expects positional [username, password].
        const { tenant: _tenant, username, password } = first as { tenant?: string; username?: string; password?: string };
        args = [username, password];
      }
    }
    if (!payloadTenant) {
      const stored = getTenantSlug();
      if (stored) payloadTenant = stored;
    }
  }

  const body: Record<string, unknown> = { channel, args };
  if (payloadTenant) body.tenant = payloadTenant;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
        // ngrok free: HTML sahifada "Visit Site" chiqadi; RPC fetch uchun ogohlantirishni aylanib o'tish
        'ngrok-skip-browser-warning': '1',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // HTTP 401 => token is invalid / expired. Clear local state and notify app.
    if (res.status === 401 && !PUBLIC_CHANNELS.has(channel)) {
      setSessionToken(null);
      dispatchAuthRequired('expired_or_invalid');
    }

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json || typeof json !== 'object') {
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: `Invalid RPC response (HTTP ${res.status})`,
          details: null,
        },
      };
    }
    if (json.ok === false && json.error && typeof json.error === 'object') {
      const e = json.error as { code?: string; message?: string; details?: unknown };
      if (e.code === 'AUTH_ERROR' && !PUBLIC_CHANNELS.has(channel)) {
        setSessionToken(null);
        dispatchAuthRequired('auth_error');
      }
      return {
        success: false,
        error: {
          code: String(e.code || 'ERROR'),
          message: String(e.message || 'RPC error'),
          details: e.details,
        },
      };
    }
    if (json.ok === true) {
      // Transparently capture the session token + tenant + scope from the
      // login flows so the rest of the app (stores, router guards) can
      // observe them via localStorage without manually threading them.
      if (channel === 'pos:auth:login') {
        const data = json.data as
          | {
              success?: boolean;
              token?: string;
              expiresAt?: string | null;
              tenant?: { slug?: string } | null;
              user?: { tenantSlug?: string | null } | null;
            }
          | null
          | undefined;
        if (data?.success && typeof data.token === 'string' && data.token.length > 0) {
          setSessionToken(data.token, data.expiresAt ?? null);
          const slug = data.tenant?.slug || data.user?.tenantSlug || null;
          setTenantSlug(slug);
          setAuthScope('tenant');
        }
      }
      if (channel === 'pos:master:login') {
        const data = json.data as
          | { success?: boolean; token?: string; expiresAt?: string | null }
          | null
          | undefined;
        if (data?.success && typeof data.token === 'string' && data.token.length > 0) {
          setSessionToken(data.token, data.expiresAt ?? null);
          // Master sessions are NOT pinned to a tenant — clear any leftover slug.
          setTenantSlug(null);
          setAuthScope('master');
        }
      }
      // On logout, always clear local state regardless of server response shape.
      if (channel === 'pos:auth:logout') {
        setSessionToken(null);
      }
      return { success: true, data: json.data };
    }
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected RPC payload', details: json },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: { code: 'NETWORK_ERROR', message: msg, details: null },
    };
  } finally {
    clearTimeout(t);
  }
}

function createInvoker(baseUrl: string, secret: string) {
  return (channel: string) =>
    (...args: unknown[]) =>
      remoteInvoke(baseUrl, secret, channel, ...args);
}

/** Same nested shape as `electron/preload.cjs` (channels must match POS IPC). */
export function createRemotePosApi(baseUrl: string, secret: string) {
  const inv = createInvoker(baseUrl, secret);

  return {
    appConfig: {
      get: inv('pos:appConfig:get'),
      set: inv('pos:appConfig:set'),
      reset: inv('pos:appConfig:reset'),
    },
    products: {
      list: inv('pos:products:list'),
      searchScreen: inv('pos:products:searchScreen'),
      count: inv('pos:products:count'),
      get: inv('pos:products:get'),
      getBySku: inv('pos:products:getBySku'),
      getByBarcode: inv('pos:products:getByBarcode'),
      getNextSku: inv('pos:products:getNextSku'),
      getNextBarcode: inv('pos:products:getNextBarcode'),
      getNextBarcodeForUnit: inv('pos:products:getNextBarcodeForUnit'),
      create: inv('pos:products:create'),
      update: inv('pos:products:update'),
      delete: inv('pos:products:delete'),
      exportScaleRongtaTxt: inv('pos:products:exportScaleRongtaTxt'),
      exportScaleSharqTxt: inv('pos:products:exportScaleSharqTxt'),
      exportScaleCsv3: inv('pos:products:exportScaleCsv3'),
      exportScaleLegacyTxt: inv('pos:products:exportScaleLegacyTxt'),
      getImages: inv('pos:products:getImages'),
      addImage: inv('pos:products:addImage'),
      removeImage: inv('pos:products:removeImage'),
      setImages: inv('pos:products:setImages'),
    },
    categories: {
      list: inv('pos:categories:list'),
      get: inv('pos:categories:get'),
      create: inv('pos:categories:create'),
      update: inv('pos:categories:update'),
      delete: inv('pos:categories:delete'),
    },
    warehouses: {
      list: inv('pos:warehouses:list'),
      get: inv('pos:warehouses:get'),
      create: inv('pos:warehouses:create'),
      update: inv('pos:warehouses:update'),
      delete: inv('pos:warehouses:delete'),
    },
    customers: {
      list: inv('pos:customers:list'),
      get: inv('pos:customers:get'),
      create: inv('pos:customers:create'),
      update: inv('pos:customers:update'),
      delete: inv('pos:customers:delete'),
      updateBalance: inv('pos:customers:updateBalance'),
      receivePayment: inv('pos:customers:receivePayment'),
      getPayments: inv('pos:customers:getPayments'),
      getLedger: inv('pos:customers:getLedger'),
      getLedgerCount: inv('pos:customers:getLedgerCount'),
      exportCsv: inv('pos:customers:exportCsv'),
      getBonusLedger: inv('pos:customers:getBonusLedger'),
      adjustBonusPoints: inv('pos:customers:adjustBonusPoints'),
    },
    suppliers: {
      list: inv('pos:suppliers:list'),
      get: inv('pos:suppliers:get'),
      create: inv('pos:suppliers:create'),
      update: inv('pos:suppliers:update'),
      delete: inv('pos:suppliers:delete'),
      getLedger: inv('pos:suppliers:getLedger'),
      createPayment: inv('pos:suppliers:createPayment'),
      deletePayment: inv('pos:suppliers:deletePayment'),
      getPayments: inv('pos:suppliers:getPayments'),
      getPurchaseSummary: inv('pos:suppliers:getPurchaseSummary'),
      createReturn: inv('pos:suppliers:createReturn'),
      getReturn: inv('pos:suppliers:getReturn'),
      listReturns: inv('pos:suppliers:listReturns'),
    },
    pricing: {
      getTiers: inv('pos:pricing:getTiers'),
      getPrice: inv('pos:pricing:getPrice'),
      setPrice: inv('pos:pricing:setPrice'),
    },
    promotions: {
      list: inv('pos:promotions:list'),
      get: inv('pos:promotions:get'),
      create: inv('pos:promotions:create'),
      update: inv('pos:promotions:update'),
      delete: inv('pos:promotions:delete'),
      activate: inv('pos:promotions:activate'),
      pause: inv('pos:promotions:pause'),
      applyToCart: inv('pos:promotions:applyToCart'),
    },
    inventory: {
      getBalances: inv('pos:inventory:getBalances'),
      getMoves: inv('pos:inventory:getMoves'),
      getProductLedger: inv('pos:inventory:getProductLedger'),
      adjustStock: inv('pos:inventory:adjustStock'),
      getProductPurchaseHistory: inv('pos:inventory:getProductPurchaseHistory'),
      getProductSalesHistory: inv('pos:inventory:getProductSalesHistory'),
      getProductDetail: inv('pos:inventory:getProductDetail'),
      getCurrentStock: inv('pos:inventory:getCurrentStock'),
      getDeadStock: inv('pos:inventory:getDeadStock'),
      getStockTurnover: inv('pos:inventory:getStockTurnover'),
      getReorderSuggestions: inv('pos:inventory:getReorderSuggestions'),
      getBatchesByProduct: inv('pos:inventory:getBatchesByProduct'),
      getBatchReconcile: inv('pos:inventory:getBatchReconcile'),
      runBatchCutoverSnapshot: inv('pos:inventory:runBatchCutoverSnapshot'),
    },
    sales: {
      createDraftOrder: inv('pos:sales:createDraftOrder'),
      addItem: inv('pos:sales:addItem'),
      removeItem: inv('pos:sales:removeItem'),
      updateItemQuantity: inv('pos:sales:updateItemQuantity'),
      setCustomer: inv('pos:sales:setCustomer'),
      finalizeOrder: inv('pos:sales:finalizeOrder'),
      getOrder: inv('pos:sales:getOrder'),
      completePOSOrder: inv('pos:sales:completePOSOrder'),
      refund: inv('pos:sales:refund'),
      list: inv('pos:sales:list'),
    },
    returns: {
      create: inv('pos:returns:create'),
      get: inv('pos:returns:get'),
      list: inv('pos:returns:list'),
      getOrderDetails: inv('pos:returns:getOrderDetails'),
      update: inv('pos:returns:update'),
    },
    purchases: {
      createOrder: inv('pos:purchases:createOrder'),
      updateOrder: inv('pos:purchases:updateOrder'),
      approve: inv('pos:purchases:approve'),
      receiveGoods: inv('pos:purchases:receiveGoods'),
      createReceipt: inv('pos:purchases:createReceipt'),
      deleteOrder: inv('pos:purchases:deleteOrder'),
      get: inv('pos:purchases:get'),
      list: inv('pos:purchases:list'),
      listExpenses: inv('pos:purchases:listExpenses'),
      addExpense: inv('pos:purchases:addExpense'),
      deleteExpense: inv('pos:purchases:deleteExpense'),
    },
    expenses: {
      listCategories: inv('pos:expenses:listCategories'),
      createCategory: inv('pos:expenses:createCategory'),
      updateCategory: inv('pos:expenses:updateCategory'),
      deleteCategory: inv('pos:expenses:deleteCategory'),
      list: inv('pos:expenses:list'),
      create: inv('pos:expenses:create'),
      update: inv('pos:expenses:update'),
      delete: inv('pos:expenses:delete'),
    },
    shifts: {
      open: inv('pos:shifts:open'),
      close: inv('pos:shifts:close'),
      get: inv('pos:shifts:get'),
      getActive: inv('pos:shifts:getActive'),
      getCurrent: inv('pos:shifts:getCurrent'),
      getSummary: inv('pos:shifts:getSummary'),
      getStatus: inv('pos:shifts:getStatus'),
      require: inv('pos:shifts:require'),
      list: inv('pos:shifts:list'),
    },
    reports: {
      dailySales: inv('pos:reports:dailySales'),
      dailySalesSQL: inv('pos:reports:dailySalesSQL'),
      topProducts: inv('pos:reports:topProducts'),
      productSales: inv('pos:reports:productSales'),
      promotionUsage: inv('pos:reports:promotionUsage'),
      stock: inv('pos:reports:stock'),
      returns: inv('pos:reports:returns'),
      profit: inv('pos:reports:profit'),
      profitAndLossSQL: inv('pos:reports:profitAndLossSQL'),
      inventoryValuation: inv('pos:reports:inventoryValuation'),
      inventoryValuationSummary: inv('pos:reports:inventoryValuationSummary'),
      batchReconciliation: inv('pos:reports:batchReconciliation'),
      actSverka: inv('pos:reports:actSverka'),
      customerActSverka: inv('pos:reports:customerActSverka'),
      supplierActSverka: inv('pos:reports:supplierActSverka'),
      productTraceability: inv('pos:reports:productTraceability'),
      supplierProductSales: inv('pos:reports:supplierProductSales'),
      cashFlow: inv('pos:reports:cashFlow'),
      cashDiscrepancies: inv('pos:reports:cashDiscrepancies'),
      aging: inv('pos:reports:aging'),
      customerAging: inv('pos:reports:customerAging'),
      supplierAging: inv('pos:reports:supplierAging'),
      vipCustomers: inv('pos:reports:vipCustomers'),
      loyaltyPointsSummary: inv('pos:reports:loyaltyPointsSummary'),
      lostCustomers: inv('pos:reports:lostCustomers'),
      customerProfitability: inv('pos:reports:customerProfitability'),
      deliveryAccuracy: inv('pos:reports:deliveryAccuracy'),
      deliveryDetails: inv('pos:reports:deliveryDetails'),
      priceHistory: inv('pos:reports:priceHistory'),
      productPriceSummary: inv('pos:reports:productPriceSummary'),
      purchasePlanning: inv('pos:reports:purchasePlanning'),
      purchaseSaleSpread: inv('pos:reports:purchaseSaleSpread'),
      spreadTimeSeries: inv('pos:reports:spreadTimeSeries'),
      latestPurchaseCosts: inv('pos:reports:getLatestPurchaseCosts'),
      cashierErrors: inv('pos:reports:cashierErrors'),
      cashierErrorDetails: inv('pos:reports:cashierErrorDetails'),
      shiftProductivity: inv('pos:reports:shiftProductivity'),
      productivitySummary: inv('pos:reports:productivitySummary'),
      fraudSignals: inv('pos:reports:fraudSignals'),
      fraudIncidents: inv('pos:reports:fraudIncidents'),
      deviceHealth: inv('pos:reports:deviceHealth'),
      deviceIncidents: inv('pos:reports:deviceIncidents'),
      auditLog: inv('pos:reports:auditLog'),
      priceChangeHistory: inv('pos:reports:priceChangeHistory'),
      executiveKPI: inv('pos:reports:executiveKPI'),
      executiveTrends: inv('pos:reports:executiveTrends'),
    },
    dashboard: {
      getStats: inv('pos:dashboard:getStats'),
      getAnalytics: inv('pos:dashboard:getAnalytics'),
      getLowStock: inv('pos:dashboard:getLowStock'),
    },
    settings: {
      get: inv('pos:settings:get'),
      set: inv('pos:settings:set'),
      getAll: inv('pos:settings:getAll'),
      delete: inv('pos:settings:delete'),
      resetDatabase: inv('pos:settings:resetDatabase'),
    },
    exchangeRates: {
      getLatest: inv('pos:exchangeRates:getLatest'),
      list: inv('pos:exchangeRates:list'),
      upsert: inv('pos:exchangeRates:upsert'),
    },
    auth: {
      login: inv('pos:auth:login'),
      logout: inv('pos:auth:logout'),
      me: inv('pos:auth:me'),
      getUser: inv('pos:auth:getUser'),
      checkPermission: inv('pos:auth:checkPermission'),
      requestPasswordReset: inv('pos:auth:requestPasswordReset'),
      confirmPasswordReset: inv('pos:auth:confirmPasswordReset'),
    },
    // Multi-tenant surface (Bosqich 16). Server returns errors for these when
    // POS_MULTI_TENANT=0 — the frontend uses pos:health.multi_tenant to gate
    // access to the admin UI so users don't hit dead endpoints.
    master: {
      login: inv('pos:master:login'),
      me: inv('pos:master:me'),
    },
    tenants: {
      list: inv('pos:tenants:list'),
      get: inv('pos:tenants:get'),
      create: inv('pos:tenants:create'),
      disable: inv('pos:tenants:disable'),
      enable: inv('pos:tenants:enable'),
      publicProfile: inv('pos:tenants:publicProfile'),
      setBranding: inv('pos:tenants:setBranding'),
    },
    users: {
      list: inv('pos:users:list'),
      get: inv('pos:users:get'),
      create: inv('pos:users:create'),
      update: inv('pos:users:update'),
      delete: inv('pos:users:delete'),
      resetPassword: inv('pos:users:resetPassword'),
    },
    quotes: {
      list: inv('pos:quotes:list'),
      get: inv('pos:quotes:get'),
      create: inv('pos:quotes:create'),
      update: inv('pos:quotes:update'),
      delete: inv('pos:quotes:delete'),
      generateNumber: inv('pos:quotes:generateNumber'),
      convertToSale: inv('pos:quotes:convertToSale'),
    },
    orders: {
      list: inv('pos:orders:list'),
      get: inv('pos:orders:get'),
      getByNumber: inv('pos:orders:getByNumber'),
      getByCustomer: inv('pos:orders:getByCustomer'),
      cancel: inv('pos:orders:cancel'),
    },
    files: {
      selectSavePath: inv('pos:files:selectSavePath'),
      writeFile: inv('pos:files:writeFile'),
      readFile: inv('pos:files:readFile'),
      exists: inv('pos:files:exists'),
      saveTextFile: inv('pos:files:saveTextFile'),
      openTextFile: inv('pos:files:openTextFile'),
      selectImageFile: inv('pos:files:selectImageFile'),
      saveProductImage: inv('pos:files:saveProductImage'),
      pathToFileUrl: inv('pos:files:pathToFileUrl'),
    },
    print: {
      receipt: inv('pos:print:receipt'),
    },
    health: inv('pos:health'),
    debug: {
      tableCounts: inv('pos:debug:tableCounts'),
    },
    // Non-channel helpers for the renderer layer.
    _session: {
      getToken: getSessionToken,
      setToken: setSessionToken,
      hasToken: () => !!getSessionToken(),
      getTenantSlug,
      setTenantSlug,
      getAuthScope,
      setAuthScope,
      extractTenantSlugFromHost,
    },
  };
}

export type RemotePosApi = ReturnType<typeof createRemotePosApi>;

export function installRemotePosApiIfConfigured(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { posApi?: unknown };
  if (w.posApi) return;

  const base = import.meta.env.VITE_POS_RPC_URL;
  const secret = import.meta.env.VITE_POS_RPC_SECRET;
  if (!base || !secret) return;

  w.posApi = createRemotePosApi(String(base), String(secret));
}
