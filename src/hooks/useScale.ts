/**
 * useScale — thin React wrapper around the scale agent endpoint.
 *
 * Exposes a `read()` function and the latest reading/error. Does NOT poll;
 * call `read()` only when the cashier clicks the "Tortish" button or when
 * a scalable item is added to the cart.
 *
 * In Electron desktop mode you can still use this — as long as the agent
 * daemon is running on the same PC, the endpoint responds identically.
 *
 * Usage:
 *   const { read, reading, isReading, error, reset } = useScale();
 *   <Button onClick={async () => {
 *     const r = await read();
 *     addLineWithWeight(selectedProduct, r.weight);
 *   }}>Tortish</Button>
 */
import { useCallback, useRef, useState } from 'react';
import { readScaleWeight, type ScaleReading } from '@/lib/devices/scaleAgent';

export type UseScaleResult = {
  read: (timeoutMs?: number) => Promise<ScaleReading>;
  reading: ScaleReading | null;
  isReading: boolean;
  error: { code?: string; message: string } | null;
  reset: () => void;
};

export function useScale(): UseScaleResult {
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<UseScaleResult['error']>(null);
  // Prevents overlapping reads if the button is clicked twice quickly.
  const inFlightRef = useRef<Promise<ScaleReading> | null>(null);

  const read = useCallback(async (timeoutMs?: number): Promise<ScaleReading> => {
    if (inFlightRef.current) return inFlightRef.current;
    setIsReading(true);
    setError(null);
    const p = (async () => {
      try {
        const r = await readScaleWeight(timeoutMs);
        setReading(r);
        return r;
      } catch (err) {
        const e = err as Error & { code?: string };
        setError({ code: e.code, message: e.message || 'Scale read failed' });
        throw err;
      } finally {
        setIsReading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, []);

  const reset = useCallback(() => {
    setReading(null);
    setError(null);
  }, []);

  return { read, reading, isReading, error, reset };
}
