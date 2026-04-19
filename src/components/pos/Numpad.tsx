import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Delete } from 'lucide-react';
import { formatNumberDots } from '@/lib/money';

interface NumpadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Rendered below the header (e.g. mode toggles). */
  headerExtra?: ReactNode;
  initialValue?: number;
  onApply: (value: number) => void;
  max?: number;
  min?: number;
  allowDecimal?: boolean;
  /** If set, shown instead of raw `Max: {max}` under the input. */
  maxHint?: string;
  /** Input keyboard hint; default follows allowDecimal. */
  inputMode?: 'decimal' | 'numeric';
  /** Default: 'default'. Use 'payment' to show as a floating keypad without overlay (tablet-friendly). */
  mode?: 'default' | 'payment';
}

export default function Numpad({
  open,
  onOpenChange,
  title,
  description,
  headerExtra,
  initialValue = 0,
  onApply,
  max,
  min = 0,
  allowDecimal = true,
  maxHint,
  inputMode: inputModeProp,
  mode = 'default',
}: NumpadProps) {
  // For payment mode we keep a raw digits-only value, and display a formatted "1.000.000" string.
  const [valueRaw, setValueRaw] = useState('');
  const [isPristine, setIsPristine] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPayment = mode === 'payment';
  const inputModeResolved = inputModeProp ?? (isPayment || !allowDecimal ? 'numeric' : 'decimal');

  // Reset value when dialog opens, initial value changes, or input constraints change (e.g. kg ↔ so'm toggle without remounting).
  useEffect(() => {
    if (!open) return;
    if (isPayment) {
      const newRaw = String(initialValue ?? 0);
      setValueRaw(newRaw);
    } else {
      const initial = initialValue && initialValue > 0 ? String(initialValue) : '';
      setValueRaw(initial);
    }
    setIsPristine(true);
  }, [open, initialValue, isPayment, max, min, allowDecimal]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      const len = inputRef.current?.value?.length ?? 0;
      if (inputRef.current && typeof inputRef.current.setSelectionRange === 'function') {
        inputRef.current.setSelectionRange(len, len);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Keypad Logic: Ensure state updates instantly and synchronously
  const updateValueImmediately = (newRaw: string) => {
    setValueRaw(newRaw);
  };

  const displayValue = (() => {
    if (!isPayment) return valueRaw;
    const digits = (valueRaw || '').replace(/[^\d]/g, '');
    const n = digits ? Number(digits) : 0;
    return formatNumberDots(n);
  })();

  const handleNumberClick = (num: string) => {
    if (isPayment) {
      const newValue = (() => {
        const current = valueRaw || '';
        const cleaned = current.replace(/[^\d]/g, '');
        if (cleaned === '0' || cleaned === '') return num;
        return cleaned + num;
      })();
      updateValueImmediately(newValue);
      return;
    }

    const current = valueRaw || '';
    const newValue = (() => {
      if (isPristine) return num;
      if (current === '0' && !current.includes('.')) return num;
      return current + num;
    })();
    setIsPristine(false);
    updateValueImmediately(newValue);
  };

  const handleDecimalClick = () => {
    if (isPayment || !allowDecimal) return; // UZS payment keypad: integers only
    const newValue = (() => {
      const current = valueRaw || '';
      if (isPristine || current === '' || current === '0') {
        return '0.';
      }
      if (!current.includes('.')) {
        return current + '.';
      }
      return current;
    })();
    setIsPristine(false);
    updateValueImmediately(newValue);
  };

  const handleClear = () => {
    updateValueImmediately(isPayment ? '0' : '');
    setIsPristine(false);
  };

  const handleBackspace = () => {
    const newValue = (() => {
      const current = isPayment ? (valueRaw || '').replace(/[^\d]/g, '') : (valueRaw || '');
      if (current.length <= 1 || current === '0' || current === '') {
        return isPayment ? '0' : '';
      }
      return current.slice(0, -1);
    })();
    setIsPristine(false);
    updateValueImmediately(newValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPayment) return; // keep input read-only in payment mode (keypad only)
    const inputValue = e.target.value;
    // Allow empty string, numbers, and single decimal point
    const pattern = allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;
    if (inputValue === '' || pattern.test(inputValue)) {
      setValueRaw(inputValue);
      setIsPristine(false);
    }
  };

  const validationError = useMemo(() => {
    if (isPayment) return '';
    if (valueRaw === '') return '';
    const parsed = allowDecimal ? Number(valueRaw) : Number.parseInt(valueRaw, 10);
    if (!Number.isFinite(parsed)) return 'Qiymat noto‘g‘ri';
    if (parsed <= 0) return 'Qiymat 0 dan katta bo‘lishi kerak';
    if (min > 0 && parsed < min) return `Minimum: ${min}`;
    if (max !== undefined && parsed > max) return `Maximum: ${max}`;
    return '';
  }, [valueRaw, allowDecimal, min, max, isPayment]);

  const isApplyDisabled = isPayment ? false : valueRaw === '' || validationError !== '';

  const handleApply = () => {
    if (isApplyDisabled) return;
    const currentInputValue = isPayment ? valueRaw : (inputRef.current?.value || valueRaw);
    if (!currentInputValue || currentInputValue.trim() === '') return;
    const normalized = isPayment ? currentInputValue.replace(/[^\d.]/g, '') : currentInputValue;
    const parsed = allowDecimal ? Number(normalized) : Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed)) return;
    onApply(parsed);
    onOpenChange(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
    // Let the input handle number keys, decimal, backspace, delete naturally
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent) => {
    // Only handle Enter and Escape when focus is on dialog (not input)
    if (e.target === e.currentTarget || (e.target as HTMLElement).tagName !== 'INPUT') {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={mode !== 'payment'}>
      <DialogContent 
        hideOverlay={mode === 'payment'}
        className={
          mode === 'payment'
            ? // Float in bottom-right so it doesn't cover the payment actions behind it.
              "w-[360px] max-w-[calc(100%-1.5rem)] fixed top-20 right-3 left-auto bottom-auto translate-x-0 translate-y-0 p-4 z-[120] max-h-[calc(100vh-6rem)] overflow-auto"
            : "max-w-sm"
        }
        onKeyDown={handleDialogKeyDown}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {headerExtra ? <div className="mt-2">{headerExtra}</div> : null}
        <div className="space-y-4">
          <div className="bg-muted rounded-lg p-4 text-right">
            <input
              ref={inputRef}
              type="text"
              value={displayValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              className="w-full text-3xl font-bold bg-transparent border-none outline-none text-right focus:ring-0"
              autoFocus
              inputMode={inputModeResolved}
              readOnly={isPayment}
              placeholder={isPayment ? undefined : '0'}
            />
            {!isPayment && validationError !== '' && (
              <div className="text-xs text-destructive mt-1">{validationError}</div>
            )}
            {maxHint ? (
              <div className="text-xs text-muted-foreground mt-1">{maxHint}</div>
            ) : max !== undefined ? (
              <div className="text-xs text-muted-foreground mt-1">Max: {max}</div>
            ) : null}
            {min > 0 && (
              <div className="text-xs text-muted-foreground mt-1">Min: {min}</div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((num) => (
              <Button
                key={num}
                variant="outline"
                size="lg"
                className="h-14 text-xl font-semibold"
                onClick={() => handleNumberClick(num)}
              >
                {num}
              </Button>
            ))}
            <Button
              variant="outline"
              size="lg"
              className="h-14 text-xl font-semibold"
              onClick={handleDecimalClick}
              disabled={isPayment || !allowDecimal}
            >
              .
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-14 text-xl font-semibold"
              onClick={() => handleNumberClick('0')}
            >
              0
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-14"
              onClick={handleBackspace}
            >
              <Delete className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClear}>
            Clear
          </Button>
          <Button onClick={handleApply} className="flex-1" disabled={isApplyDisabled}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
