import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { formatNumberDots } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Delete, X } from 'lucide-react';

type Props = {
  open: boolean;
  title: string;
  value: number;
  max?: number;
  onClose: () => void;
  /** Live preview: called as user types. Does NOT auto-close. */
  onChange?: (value: number) => void;
  onApply: (value: number) => void;
};

export default function PaymentNumpadPanel({ open, title, value, max, onClose, onChange, onApply }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState<string>('0'); // digits only

  useEffect(() => {
    if (!open) return;
    setRaw(String(Math.max(0, Math.floor(value || 0))));
  }, [open, value]);

  const formatted = useMemo(() => {
    const n = Number((raw || '0').replace(/[^\d]/g, '')) || 0;
    return formatNumberDots(n);
  }, [raw]);

  const commit = (nextRaw: string) => {
    const cleaned = (nextRaw || '').replace(/[^\d]/g, '');
    const n = cleaned === '' ? 0 : Number(cleaned);
    if (!Number.isFinite(n)) return;
    const intN = Math.max(0, Math.floor(n));
    const capped = max !== undefined ? Math.min(intN, Math.floor(max)) : intN;
    setRaw(String(capped));
    // Live preview update (keeps underlying input in sync while typing)
    onChange?.(capped);
  };

  const append = (d: string) => {
    const cleaned = (raw || '').replace(/[^\d]/g, '');
    const next = cleaned === '0' ? d : cleaned + d;
    commit(next);
  };

  const backspace = () => {
    const cleaned = (raw || '').replace(/[^\d]/g, '');
    if (cleaned.length <= 1) return commit('0');
    return commit(cleaned.slice(0, -1));
  };

  const clear = () => commit('0');

  const apply = () => {
    const n = Number((raw || '0').replace(/[^\d]/g, '')) || 0;
    const intN = Math.max(0, Math.floor(n));
    const capped = max !== undefined ? Math.min(intN, Math.floor(max)) : intN;
    onApply(capped);
  };

  // Keyboard support: allow typing digits/backspace/enter even when the on-screen numpad is open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        apply();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
        return;
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        clear();
        return;
      }
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        append(e.key);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, apply, backspace, clear, append]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-payment-numpad="true"
      className={cn(
        // Place at top-right so it doesn't cover the bottom payment actions/buttons on tablet.
        // IMPORTANT: We render ONLY the panel (no full-screen overlay) so taps outside can both
        // close the panel and still interact with the underlying UI.
        'fixed z-[300] right-3 top-20 w-[360px] max-w-[calc(100%-1.5rem)] rounded-xl border bg-card shadow-xl p-4',
        'max-h-[calc(100vh-6rem)] overflow-auto'
      )}
      onPointerDown={(e) => {
        // Prevent any parent "outside click" logic from reacting to interactions inside the panel.
        e.stopPropagation();
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold">{title}</div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="bg-muted rounded-lg p-4 text-right">
        <div className="text-3xl font-bold tabular-nums">{formatted}</div>
        {max !== undefined && (
          <div className="text-xs text-muted-foreground mt-1">Max: {formatNumberDots(Math.floor(max))}</div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((num) => (
          <Button
            key={num}
            variant="outline"
            size="lg"
            className="h-14 text-xl font-semibold"
            onClick={() => append(num)}
          >
            {num}
          </Button>
        ))}
        <Button variant="outline" size="lg" className="h-14 text-base font-semibold" onClick={clear}>
          Clear
        </Button>
        <Button variant="outline" size="lg" className="h-14 text-xl font-semibold" onClick={() => append('0')}>
          0
        </Button>
        <Button variant="outline" size="lg" className="h-14" onClick={backspace}>
          <Delete className="h-5 w-5" />
        </Button>
      </div>

      <Button className="w-full h-12 text-lg mt-3" onClick={apply}>
        Apply
      </Button>
    </div>,
    document.body
  );
}


