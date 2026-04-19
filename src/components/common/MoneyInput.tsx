/**
 * MoneyInput Component
 * 
 * A controlled input component for entering money amounts in UZS.
 * Auto-formats with dot separators while typing (e.g. 1000000 -> "1.000.000")
 * Internally stores numeric value, never formatted string.
 * 
 * Features:
 * - Visual formatting with dots while typing
 * - Handles pasting with dots/spaces
 * - Maintains cursor position during formatting
 * - Supports empty value (null)
 * - Disallows negative numbers (unless explicitly allowed)
 */

import { useState, useEffect, useRef, type ChangeEvent, type FocusEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNumberDots, formatNumberDotsWithDecimals, parseMoneyFlexible, parseUZS } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface MoneyInputProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  allowZero?: boolean;
  max?: number;
  label?: string;
  required?: boolean;
  className?: string;
  containerClassName?: string;
  id?: string;
  min?: number;
  error?: string;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  /** If true, reflect external `value` updates even while the input is focused (useful for on-screen numpads). */
  syncWhileFocused?: boolean;
  /** Allow fractional values (supports ',' or '.' as decimal separator). Default: false (UZS integer-style). */
  allowDecimals?: boolean;
  /** Maximum decimal places when allowDecimals is true. Default: 2 */
  decimalScale?: number;
}

export default function MoneyInput({
  value,
  onValueChange,
  placeholder = '0',
  disabled = false,
  readOnly = false,
  allowZero = false,
  max,
  label,
  required = false,
  className,
  containerClassName,
  id,
  min = 0,
  error,
  onBlur,
  autoFocus,
  syncWhileFocused = false,
  allowDecimals = false,
  decimalScale = 2,
}: MoneyInputProps) {
  const [displayValue, setDisplayValue] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorPositionRef = useRef<number>(0);

  const normalizeDecimalInput = (input: string) => {
    let next = input;

    // Make both separators behave the same while typing.
    if (next === '.' || next === ',') {
      return `0${next}`;
    }

    // When the field currently shows 0, typing a new integer should replace it.
    if (/^0\d+$/.test(next)) {
      return String(parseInt(next, 10));
    }

    return next;
  };

  // Update display value when prop value changes (external updates)
  useEffect(() => {
    if (!isFocused || syncWhileFocused) {
      if (value === null || value === undefined) {
        setDisplayValue('');
      } else {
        // Format the number for display (no suffix in input)
        setDisplayValue(
          allowDecimals
            ? formatNumberDotsWithDecimals(value, decimalScale)
            : formatNumberDots(value)
        );
      }
    }
  }, [value, isFocused, syncWhileFocused, allowDecimals, decimalScale]);

  // Calculate cursor position after formatting
  const getCursorPositionAfterFormat = (
    oldValue: string,
    newValue: string,
    oldCursorPos: number
  ): number => {
    // Count digits before cursor in old value
    const digitsBeforeCursor = oldValue
      .substring(0, Math.min(oldCursorPos, oldValue.length))
      .replace(/[^\d]/g, '').length;

    // Find position in new value where we have the same number of digits
    let digitCount = 0;
    for (let i = 0; i < newValue.length; i++) {
      if (/\d/.test(newValue[i])) {
        digitCount++;
        if (digitCount === digitsBeforeCursor) {
          // Position cursor after this digit
          return i + 1;
        }
      }
    }

    // If we didn't find the exact position, place at end
    return newValue.length;
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawInput = e.target.value;
    const input = allowDecimals ? normalizeDecimalInput(rawInput) : rawInput;
    const cursorPos = e.target.selectionStart || 0;

    // Store cursor position
    cursorPositionRef.current = cursorPos;

    // Parse input
    const numericValue = allowDecimals ? parseMoneyFlexible(input, decimalScale) : parseUZS(input);

    // Handle empty input
    if (input.trim() === '' || numericValue === 0 && !allowZero) {
      setDisplayValue('');
      onValueChange(null);
      return;
    }

    // Check minimum (default 0, but can be overridden)
    if (numericValue < min) {
      // Don't update if below minimum
      return;
    }

    // Check maximum
    if (max !== undefined && numericValue > max) {
      // Don't update if above maximum
      return;
    }

    // Format with dots (or keep raw while focused for decimals to avoid cursor jump)
    const formatted = allowDecimals
      ? input // keep as typed while editing
      : formatNumberDots(numericValue);

    setDisplayValue(formatted);

    // Update parent with numeric value (null if zero and not allowed)
    if (numericValue === 0 && !allowZero) {
      onValueChange(null);
    } else {
      onValueChange(numericValue);
    }

    // Restore cursor position after formatting (only needed when we auto-format)
    if (!allowDecimals) {
      setTimeout(() => {
        if (inputRef.current) {
          const newCursorPos = getCursorPositionAfterFormat(
            input,
            formatted,
            cursorPos
          );
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    // On focus, keep formatted display (user can still edit)
    if (value !== null && value !== undefined) {
      setDisplayValue(
        allowDecimals
          ? formatNumberDotsWithDecimals(value, decimalScale)
          : formatNumberDots(value)
      );
    }

    // If the field only contains zero, select it so typing replaces it.
    if (Number(value ?? 0) === 0) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(0, inputRef.current.value.length);
        }
      }, 0);
    }
  };

  const handleBlurInternal = (e: FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    
    // On blur, keep formatted (no change needed, already formatted)
    if (value !== null && value !== undefined) {
      setDisplayValue(
        allowDecimals
          ? formatNumberDotsWithDecimals(value, decimalScale)
          : formatNumberDots(value)
      );
    }

    // Call parent onBlur if provided
    if (onBlur) {
      onBlur(e);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    
    // Parse pasted text
    const numericValue = allowDecimals ? parseMoneyFlexible(pastedText, decimalScale) : parseUZS(pastedText);
    
    if (numericValue === 0 && !allowZero) {
      setDisplayValue('');
      onValueChange(null);
      return;
    }

    // Check bounds
    if (numericValue < min) {
      return;
    }
    if (max !== undefined && numericValue > max) {
      return;
    }

    // Format and update
    const formatted = allowDecimals
      ? formatNumberDotsWithDecimals(numericValue, decimalScale)
      : formatNumberDots(numericValue);
    setDisplayValue(formatted);
    
    if (numericValue === 0 && !allowZero) {
      onValueChange(null);
    } else {
      onValueChange(numericValue);
    }

    // Move cursor to end after paste
    setTimeout(() => {
      if (inputRef.current) {
        const length = formatted.length;
        inputRef.current.setSelectionRange(length, length);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow: backspace, delete, tab, escape, enter, arrow keys, home, end
    const allowedKeys = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End'
    ];
    
    if (allowedKeys.includes(e.key)) {
      return;
    }

    // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
    if (e.ctrlKey || e.metaKey) {
      if (['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) {
        return;
      }
    }

    // Allow digits
    if (/^\d$/.test(e.key)) {
      return;
    }

    // Allow decimal separators when enabled
    if (allowDecimals && (e.key === '.' || e.key === ',' || e.code === 'NumpadDecimal')) {
      return;
    }

    // Allow minus sign only if negative is allowed via min < 0
    if (e.key === '-' && min < 0) {
      return;
    }

    // Block everything else
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
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
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
        className={cn(error && 'border-destructive', className)}
      />
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
