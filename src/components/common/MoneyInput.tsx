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
import { formatNumberDots, parseUZS } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface MoneyInputProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowZero?: boolean;
  max?: number;
  label?: string;
  required?: boolean;
  className?: string;
  id?: string;
  min?: number;
  error?: string;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}

export default function MoneyInput({
  value,
  onValueChange,
  placeholder = '0',
  disabled = false,
  allowZero = false,
  max,
  label,
  required = false,
  className,
  id,
  min = 0,
  error,
  onBlur,
  autoFocus,
}: MoneyInputProps) {
  const [displayValue, setDisplayValue] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorPositionRef = useRef<number>(0);

  // Update display value when prop value changes (external updates)
  useEffect(() => {
    if (!isFocused) {
      if (value === null || value === undefined) {
        setDisplayValue('');
      } else {
        // Format the number for display (no suffix in input)
        setDisplayValue(formatNumberDots(value));
      }
    }
  }, [value, isFocused]);

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
    const input = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    // Store cursor position
    cursorPositionRef.current = cursorPos;

    // Parse input (handles dots, spaces, and other formatting)
    const numericValue = parseUZS(input);

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

    // Format with dots
    const formatted = formatNumberDots(numericValue);

    // Update display
    setDisplayValue(formatted);

    // Update parent with numeric value (null if zero and not allowed)
    if (numericValue === 0 && !allowZero) {
      onValueChange(null);
    } else {
      onValueChange(numericValue);
    }

    // Restore cursor position after a brief delay
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
  };

  const handleFocus = () => {
    setIsFocused(true);
    // On focus, keep formatted display (user can still edit)
    if (value !== null && value !== undefined) {
      setDisplayValue(formatNumberDots(value));
    }
  };

  const handleBlurInternal = (e: FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    
    // On blur, keep formatted (no change needed, already formatted)
    if (value !== null && value !== undefined) {
      setDisplayValue(formatNumberDots(value));
    }

    // Call parent onBlur if provided
    if (onBlur) {
      onBlur(e);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    
    // Parse pasted text (handles dots, spaces, etc.)
    const numericValue = parseUZS(pastedText);
    
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
    const formatted = formatNumberDots(numericValue);
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

    // Block everything else
    e.preventDefault();
  };

  return (
    <div className="space-y-2">
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
        autoFocus={autoFocus}
        className={cn(error && 'border-destructive', className)}
      />
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
