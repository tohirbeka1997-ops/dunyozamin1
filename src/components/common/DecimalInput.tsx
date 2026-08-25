/**
 * Decimal number input for ratios and fractional quantities (e.g. 0.086 kg).
 * Keeps partial strings like "0." while typing — unlike type="number" + Number().
 */

import { useState, useEffect, useRef, type ChangeEvent, type FocusEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  isValidDecimalInput,
  normalizeQuantityInput,
  parseDecimalInput,
} from '@/utils/quantity';

export interface DecimalInputProps {
  value: number;
  onValueChange: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
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
  /** Max digits after decimal point. Default: 6 (suitable for unit ratios). */
  decimalPlaces?: number;
}

export default function DecimalInput({
  value,
  onValueChange,
  placeholder = '0',
  disabled = false,
  readOnly = false,
  min,
  max,
  label,
  required = false,
  className,
  containerClassName,
  id,
  error,
  onBlur,
  autoFocus,
  decimalPlaces = 6,
}: DecimalInputProps) {
  const [displayValue, setDisplayValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isFocused) {
      if (!Number.isFinite(value) || value === 0) {
        setDisplayValue(value === 0 ? '0' : '');
      } else {
        setDisplayValue(String(value));
      }
    }
  }, [value, isFocused]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = normalizeQuantityInput(e.target.value);
    if (!isValidDecimalInput(raw, decimalPlaces)) return;
    setDisplayValue(raw);
    const parsed = parseDecimalInput(raw);
    if (parsed === null) return;
    onValueChange(parsed);
  };

  const handleFocus = () => {
    setIsFocused(true);
    if (Number.isFinite(value)) {
      setDisplayValue(value === 0 ? '' : String(value));
    }
  };

  const handleBlurInternal = (e: FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    const parsed = parseDecimalInput(displayValue);
    if (parsed !== null) {
      let next = parsed;
      if (min !== undefined && next < min) next = min;
      if (max !== undefined && next > max) next = max;
      onValueChange(next);
      setDisplayValue(String(next));
    } else if (Number.isFinite(value)) {
      setDisplayValue(value === 0 ? '0' : String(value));
    } else {
      setDisplayValue('');
    }
    onBlur?.(e);
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
    if (e.key === '.' || e.key === ',') return;
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
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlurInternal}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        className={cn(error && 'border-destructive', className)}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
