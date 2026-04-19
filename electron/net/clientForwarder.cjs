const { ipcMain } = require('electron');
const { POS_CHANNELS } = require('../ipc/posChannels.cjs');
const { createError, ERROR_CODES } = require('../lib/errors.cjs');

function normalizeHostUrl(hostUrl) {
  if (!hostUrl) return '';
  return String(hostUrl).replace(/\/+$/, '');
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
 * We keep `pos:files:*` local (OS dialogs), and `pos:appConfig:*` local.
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
      const { status, json } = await postJson(rpcUrl, { channel, args }, { secret });

      if (status === 401) {
        throw { code: ERROR_CODES.AUTH_ERROR, message: 'Unauthorized (check secret)', details: null };
      }

      if (!json || typeof json !== 'object') {
        throw { code: ERROR_CODES.INTERNAL_ERROR, message: 'Invalid response from host', details: { status } };
      }

      if (json.ok === true) {
        return json.data;
      }

      if (json.ok === false && json.error) {
        // Throw structured error for preload to wrap
        throw json.error;
      }

      throw { code: ERROR_CODES.INTERNAL_ERROR, message: 'Unexpected response from host', details: json };
    });
  }

  console.log(`[POSNET] CLIENT forwarders registered (${POS_CHANNELS.length} channels) -> ${base}`);
}

module.exports = { registerClientForwarders };






