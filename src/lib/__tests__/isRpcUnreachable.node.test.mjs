'use strict';

/** Inline copy of isRpcUnreachableError for node --test without TS build. */
function isRpcUnreachableError(err) {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const code = String(err.code || '').toUpperCase();
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') {
    return true;
  }
  const patterns = [
    'network', 'failed to fetch', 'fetch failed', 'network request failed', 'load failed',
    'aborterror', 'aborted', 'invalid response from host', 'unexpected response from host',
    'econnrefused', 'enotfound', 'etimedout', 'socket hang up', 'connection reset', 'timeout',
  ];
  return patterns.some((p) => msg.includes(p));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(isRpcUnreachableError(new Error('fetch failed')), 'fetch failed');
assert(isRpcUnreachableError(new Error('Invalid response from host')), 'invalid host');
assert(!isRpcUnreachableError(new Error('INSUFFICIENT_STOCK')), 'stock');
const err = new Error('connect failed');
err.code = 'ECONNREFUSED';
assert(isRpcUnreachableError(err), 'econnrefused');

console.log('isRpcUnreachable.node.test: OK');
