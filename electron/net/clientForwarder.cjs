const { ipcMain } = require('electron');
const { POS_CHANNELS } = require('../ipc/posChannels.cjs');
const { createError, ERROR_CODES } = require('../lib/errors.cjs');
const { setCurrentUserSession } = require('../lib/currentUser.cjs');

function defaultClientRpcTimeoutMs() {
  const n = Number(process.env.POS_CLIENT_RPC_TIMEOUT_MS || 120000);
  return Number.isFinite(n) && n >= 5000 ? n : 120000;
}

function normalizeHostUrl(hostUrl) {
  if (!hostUrl) return '';
  return String(hostUrl).replace(/\/+$/, '');
}

/** Electron `invoke` oddiy obyektni rad etganda xabarni `[object Object]` qiladi — har doim Error. */
function throwRemoteError(errLike, fallbackMessage = 'Remote error') {
  if (errLike instanceof Error) throw errLike;
  if (errLike && typeof errLike === 'object') {
    const msg =
      (typeof errLike.message === 'string' && errLike.message.trim()) ||
      (typeof errLike.error === 'string' && errLike.error) ||
      fallbackMessage;
    const e = new Error(msg);
    if (errLike.code) e.code = errLike.code;
    if (errLike.details !== undefined) e.details = errLike.details;
    throw e;
  }
  throw new Error(typeof errLike === 'string' ? errLike : fallbackMessage);
}

/** Read-only pricing lookups: on 429 return null instead of throwing (POS scan bursts). */
const SOFT_RATE_LIMIT_CHANNELS = new Set([
  'pos:pricing:getPrice',
  'pos:pricing:getTiers',
]);

function isRateLimited(status, json) {
  return (
    status === 429 ||
    (json && typeof json === 'object' && json.ok === false && json.error?.code === 'RATE_LIMITED')
  );
}

async function postJson(url, payload, { bearer, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer || ''}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Bootstrap channels are the only ones a CLIENT terminal may call with the
 * shared host secret (transport auth). `pos:auth:login` needs the secret to
 * mint a session; the rest are public/pre-login. EVERY other channel is sent
 * with the logged-in user's session token so the HOST enforces ROLE_RULES
 * against that user's role instead of granting blanket admin via the secret
 * (audit #1).
 */
const BOOTSTRAP_CHANNELS = new Set([
  'pos:auth:login',
  'pos:auth:requestPasswordReset',
  'pos:auth:confirmPasswordReset',
  'pos:health',
  'pos:appConfig:get',
]);

/**
 * CLIENT mode: forward all `pos:*` invoke channels to HOST via HTTP RPC.
 *
 * `pos:files:*` (OS), `pos:appConfig:*` (userData) va `pos:print:*` (main.cjs) mahalliy.
 */
function registerClientForwarders({ hostUrl, secret }) {
  const base = normalizeHostUrl(hostUrl);
  if (!base) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'client.hostUrl is required');
  }

  const rpcUrl = `${base}/rpc`;

  // The session token of the user currently logged in ON THIS TERMINAL. It is
  // captured from the `pos:auth:login` response and used as the Bearer for all
  // non-bootstrap forwarded calls, so the HOST applies that user's role (NOT
  // the shared-secret admin bypass).
  let sessionToken = null;

  async function callRpc(channel, args = []) {
    const isBootstrap = BOOTSTRAP_CHANNELS.has(channel);
    const bearer = isBootstrap ? secret : (sessionToken || secret);

    const { status, json } = await postJson(rpcUrl, { channel, args }, {
      bearer,
      timeoutMs: defaultClientRpcTimeoutMs(),
    });

    if (status === 401) {
      if (!isBootstrap) sessionToken = null;
      throwRemoteError({
        code: ERROR_CODES.AUTH_ERROR,
        message: 'Unauthorized (check secret / session)',
        details: null,
      });
    }

    if (isRateLimited(status, json) && SOFT_RATE_LIMIT_CHANNELS.has(channel)) {
      return null;
    }

    if (!json || typeof json !== 'object') {
      throwRemoteError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Invalid response from host',
        details: { status },
      });
    }

    if (json.ok === true) {
      if (channel === 'pos:auth:login' && json.data) {
        if (json.data.token) sessionToken = json.data.token;
        const uid = json.data.user?.id || json.data.userId || null;
        const role = json.data.user?.role || json.data.role || null;
        if (uid) setCurrentUserSession(uid, role);
      } else if (channel === 'pos:auth:logout') {
        sessionToken = null;
        setCurrentUserSession(null, null);
      }
      return json.data;
    }

    if (json.ok === false && json.error) {
      throwRemoteError(json.error, 'Host returned an error');
    }

    throwRemoteError({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Unexpected response from host',
      details: json,
    });
  }

  for (const channel of POS_CHANNELS) {
    // Keep local-only channels local (they are not included in POS_CHANNELS by design)
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, ...args) => callRpc(channel, args));
  }

  console.log(`[POSNET] CLIENT forwarders registered (${POS_CHANNELS.length} channels) -> ${base}`);
  return { callRpc };
}

module.exports = { registerClientForwarders };






