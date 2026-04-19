import { handleIpcResponse, isElectron } from '@/utils/electron';
import type { ReceiptLine } from './receiptTextBuilder';
import {
  getPrintAgentConfig,
  isPrintAgentAvailable,
  printReceiptViaAgent,
} from './printAgent';

type EscposPrintOptions = {
  charsPerLine?: number;
  feedLines?: number;
  cut?: boolean;
  retryCount?: number;
  timeoutMs?: number;
};

function readEnv(name: string): string | undefined {
  const metaEnv: Record<string, string | undefined> = (import.meta as any)?.env || {};
  return metaEnv[name];
}

// Has the user wired VITE_POS_RPC_URL? Then we are in web / SaaS mode
// and must prefer the local print agent over the (unavailable) Electron IPC.
function isRemoteRpcMode(): boolean {
  const url = readEnv('VITE_POS_RPC_URL');
  return typeof url === 'string' && url.trim().length > 0;
}

// In-memory cache so we don't probe the agent on every single print call.
let _agentAvailableCache: { ts: number; available: boolean } | null = null;
async function checkAgentCached(ttlMs = 30_000): Promise<boolean> {
  const now = Date.now();
  if (_agentAvailableCache && now - _agentAvailableCache.ts < ttlMs) {
    return _agentAvailableCache.available;
  }
  const available = await isPrintAgentAvailable(1000);
  _agentAvailableCache = { ts: now, available };
  return available;
}

export function invalidatePrintAgentCache(): void {
  _agentAvailableCache = null;
}

export { getPrintAgentConfig, isPrintAgentAvailable };

/**
 * Prints an ESC/POS receipt, automatically choosing the best available transport:
 *
 *   1. Web/SaaS mode (VITE_POS_RPC_URL is set)   -> always try the local print agent
 *   2. Electron desktop                           -> use the in-process printService
 *   3. Otherwise, probe the agent as a last hope (covers dev with `vite` + running agent)
 *
 * Fails with a clear error if none of the above can be reached.
 */
export async function printEscposReceipt(
  lines: ReceiptLine[],
  options?: EscposPrintOptions
): Promise<void> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Empty receipt');
  }

  const timeoutMs = Math.max(1000, Number(options?.timeoutMs ?? 12000));
  const remote = isRemoteRpcMode();
  const hasElectron = isElectron() && Boolean((window as any).posApi?.print?.receipt);

  // -----------------------------------------------------------------------
  // Transport: local Print Agent (HTTP daemon)
  // -----------------------------------------------------------------------
  const tryAgent = async (): Promise<boolean> => {
    const available = await checkAgentCached();
    if (!available) return false;
    await printReceiptViaAgent(lines, { ...options, timeoutMs });
    return true;
  };

  // -----------------------------------------------------------------------
  // Transport: Electron IPC (in-process printService.cjs)
  // -----------------------------------------------------------------------
  const tryElectron = async (): Promise<boolean> => {
    if (!hasElectron) return false;
    const request = handleIpcResponse<void>(
      (window as any).posApi.print.receipt({ lines, options })
    );
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error('Printer timeout'));
      }, timeoutMs);
    });
    try {
      await Promise.race([request, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
    return true;
  };

  let lastError: unknown = null;
  const order: Array<() => Promise<boolean>> = remote
    ? [tryAgent, tryElectron] // web/SaaS: agent first, Electron fallback only if somehow present
    : [tryElectron, tryAgent]; // desktop: Electron first, agent as last resort

  for (const fn of order) {
    try {
      const done = await fn();
      if (done) return;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  throw new Error(
    'Print agent is not running and Electron print API is not available. ' +
      'Install and start pos-print-agent on this PC (see print-agent/README.md) ' +
      'or run the desktop build.'
  );
}
