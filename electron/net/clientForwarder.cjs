const { ipcMain } = require('electron');
const { POS_CHANNELS } = require('../ipc/posChannels.cjs');
const { createError, ERROR_CODES } = require('../lib/errors.cjs');

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

async function postJson(url, payload, { secret, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret || ''}`,
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

  for (const channel of POS_CHANNELS) {
    // Keep local-only channels local (they are not included in POS_CHANNELS by design)
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, ...args) => {
      const { status, json } = await postJson(rpcUrl, { channel, args }, {
        secret,
        timeoutMs: defaultClientRpcTimeoutMs(),
      });

      if (status === 401) {
        throwRemoteError({
          code: ERROR_CODES.AUTH_ERROR,
          message: 'Unauthorized (check secret / session)',
          details: null,
        });
      }

      if (!json || typeof json !== 'object') {
        throwRemoteError({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Invalid response from host',
          details: { status },
        });
      }

      if (json.ok === true) {
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
    });
  }

  console.log(`[POSNET] CLIENT forwarders registered (${POS_CHANNELS.length} channels) -> ${base}`);
}

module.exports = { registerClientForwarders };






