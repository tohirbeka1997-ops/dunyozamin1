/**
 * Integer number input with Uzbek dot thousand separators (1.000.000).
 * Stores a plain number internally; display uses formatNumberDots / parseUZS.
 */

import { useState, useEffect, useRef, type ChangeEvent, type FocusEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNumberDots, parseUZS } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface NumberInputProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  allowZero?: boolean;
  min?: number;
  max?: number;
  label?: string;
  required?: boolean;
  className?: string;
  containerClassName?: string;
  id?: string;
  error?: string;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  title?: string;
  syncWhileFocused?: boolean;
}

export default function NumberInput({
  value,
  onValueChange,
  placeholder = '0',
  disabled = false,
  readOnly = false,
  allowZero = false,
  min = 0,
  max,
  label,
  required = false,
  className,
  containerClassName,
  id,
  error,
  onBlur,
  autoFocus,
  title,
  syncWhileFocused = false,
}: NumberInputProps) {
  const [displayValue, setDisplayValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isFocused || syncWhileFocused) {
      if (value === null || value === undefined) {
        setDisplayValue('');
      } else {
        setDisplayValue(formatNumberDots(value));
      }
    }
  }, [value, isFocused, syncWhileFocused]);

  const getCursorPositionAfterFormat = (oldValue: string, newValue: string, oldCursorPos: number): number => {
    const digitsBeforeCursor = oldValue
      .substring(0, Math.min(oldCursorPos, oldValue.length))
      .replace(/[^\d]/g, '').length;
    let digitCount = 0;
    for (let i = 0; i < newValue.length; i++) {
      if (/\d/.test(newValue[i])) {
        digitCount++;
        if (digitCount === digitsBeforeCursor) return i + 1;
      }
    }
    return newValue.length;
  };

  const applyParsed = (input: string, cursorPos: number) => {
    const numericValue = parseUZS(input);

    if (input.trim() === '' || (numericValue === 0 && !allowZero)) {
      setDisplayValue('');
      onValueChange(null);
      return;
    }
    if (numericValue < min) return;
    if (max !== undefined && numericValue > max) return;

    const formatted = formatNumberDots(numericValue);
    setDisplayValue(formatted);
    onValueChange(numericValue === 0 && !allowZero ? null : numericValue);

    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = getCursorPositionAfterFormat(input, formatted, cursorPos);
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    applyParsed(e.target.value, e.target.selectionStart || 0);
  };

  const handleFocus = () => {
    setIsFocused(true);
    if (value !== null && value !== undefined) {
      setDisplayValue(formatNumberDots(value));
    }
    if (Number(value ?? 0) === 0) {
      setTimeout(() => inputRef.current?.setSelectionRange(0, inputRef.current.value.length), 0);
    }
  };

  const handleBlurInternal = (e: FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    if (value !== null && value !== undefined) {
      setDisplayValue(formatNumberDots(value));
    }
    onBlur?.(e);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    applyParsed(e.clipboardData.getData('text'), displayValue.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End',
    ];
    if (allowedKeys.includes(e.key)) return;
    if (e.ctrlKey || e.metaKey) {
      if (['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;
    }
    if (/^\d$/.test(e.key)) return;
    if (e.key === '-' && min < 0) return;
    if (/^F\d{1,2}$/.test(e.key)) return;
    e.preventDefault();
  };

  return (
    <div className={containerClassName ?? 'space-y-2'}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      <Input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlurInternal}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        title={title}
        className={cn(error && 'border-destructive', className)}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
