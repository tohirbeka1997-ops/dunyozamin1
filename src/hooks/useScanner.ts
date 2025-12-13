import { useCallback, useRef, useEffect } from 'react';

interface UseScannerOptions {
  onScan: (barcode: string) => void;
  delay?: number; // Delay between scans (ms)
}

/**
 * Hook for barcode scanner support
 * Detects rapid input (scanner) vs manual typing
 */
export const useScanner = ({ onScan, delay = 100 }: UseScannerOptions) => {
  const bufferRef = useRef<string>('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleInput = useCallback(
    (value: string) => {
      // Clear previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Add to buffer
      bufferRef.current += value;

      // Set timeout to process buffer
      timeoutRef.current = setTimeout(() => {
        const barcode = bufferRef.current.trim();
        if (barcode.length > 0) {
          // If buffer is long enough, treat as scanner input
          if (barcode.length >= 3) {
            onScan(barcode);
          }
          bufferRef.current = '';
        }
      }, delay);
    },
    [onScan, delay]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { handleInput };
};








