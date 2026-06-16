/**
 * True when an IPC/RPC call failed because the HOST server is unreachable,
 * not because of a business-rule rejection (stock, auth, validation, etc.).
 */
export function isRpcUnreachableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const msg = err.message.toLowerCase();
  const code = String((err as Error & { code?: string }).code || '').toUpperCase();

  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') {
    return true;
  }

  const patterns = [
    'network',
    'failed to fetch',
    'fetch failed',
    'network request failed',
    'load failed',
    'aborterror',
    'aborted',
    'invalid response from host',
    'unexpected response from host',
    'econnrefused',
    'enotfound',
    'etimedout',
    'socket hang up',
    'connection reset',
    'timeout',
  ];

  return patterns.some((p) => msg.includes(p));
}
