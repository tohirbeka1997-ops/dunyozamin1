import { useState, useEffect, useRef } from 'react';
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

interface NumpadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialValue?: number;
  onApply: (value: number) => void;
  max?: number;
  min?: number;
}

export default function Numpad({
  open,
  onOpenChange,
  title,
  description,
  initialValue = 0,
  onApply,
  max,
  min = 0,
}: NumpadProps) {
  const [value, setValue] = useState(initialValue.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset value when dialog opens or initialValue changes
  useEffect(() => {
    if (open) {
      const newValue = initialValue.toString();
      setValue(newValue);
      // Sync input ref immediately
      if (inputRef.current) {
        inputRef.current.value = newValue;
      }
    }
  }, [open, initialValue]);

  // Keypad Logic: Ensure state updates instantly and synchronously
  const updateValueImmediately = (newValue: string) => {
    setValue(newValue);
    // Also update input ref immediately to avoid stale reads
    if (inputRef.current) {
      inputRef.current.value = newValue;
    }
  };

  const handleNumberClick = (num: string) => {
    const newValue = (() => {
      const current = inputRef.current?.value || value;
      if (current === '0' || current === '') {
        return num;
      }
      return current + num;
    })();
    updateValueImmediately(newValue);
  };

  const handleDecimalClick = () => {
    const newValue = (() => {
      const current = inputRef.current?.value || value;
      if (current === '' || current === '0') {
        return '0.';
      }
      if (!current.includes('.')) {
        return current + '.';
      }
      return current;
    })();
    updateValueImmediately(newValue);
  };

  const handleClear = () => {
    updateValueImmediately('0');
  };

  const handleBackspace = () => {
    const newValue = (() => {
      const current = inputRef.current?.value || value;
      if (current.length <= 1 || current === '0') {
        return '0';
      }
      return current.slice(0, -1);
    })();
    updateValueImmediately(newValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    // Allow empty string, numbers, and single decimal point
    if (inputValue === '' || /^\d*\.?\d*$/.test(inputValue)) {
      const newValue = inputValue === '' ? '0' : inputValue;
      setValue(newValue);
      // Keep ref in sync
      if (inputRef.current) {
        inputRef.current.value = newValue;
      }
    }
  };

  const handleApply = () => {
    // CRITICAL FIX: Read value directly from input DOM to avoid stale state
    // This ensures we get the most current value even if state hasn't updated yet
    const currentInputValue = inputRef.current?.value || value;
    
    // Force type conversion: explicitly convert to number using Number() or parseInt()
    let numValue: number;
    
    // Handle empty string, null, or undefined
    if (!currentInputValue || currentInputValue.trim() === '' || currentInputValue === '0') {
      // For quantity (min >= 1), default to min. For discount (min = 0), default to 0
      numValue = min;
    } else {
      // Use parseInt for integers (quantity) or parseFloat for decimals (discount)
      // Force conversion: try parseInt first, then parseFloat if needed
      const intValue = parseInt(currentInputValue, 10);
      const floatValue = parseFloat(currentInputValue);
      
      // Use integer if it matches the float (no decimals), otherwise use float
      numValue = intValue === floatValue ? intValue : floatValue;
      
      // Final conversion using Number() to ensure proper type
      numValue = Number(numValue);
    }
    
    // Validate: Only proceed if value is a valid number
    if (isNaN(numValue) || !isFinite(numValue)) {
      setValue(min.toString());
      if (inputRef.current) {
        inputRef.current.value = min.toString();
      }
      return;
    }
    
    // Refactor validation: Ensure validation logic checks the converted number, not raw string
    // Ensure value meets minimum requirement (for quantity, min is 1)
    let validValue = numValue;
    if (validValue < min) {
      validValue = min;
    }
    
    // Ensure value doesn't exceed maximum if specified
    if (max !== undefined && validValue > max) {
      validValue = max;
    }
    
    // Final check: ensure validValue is a proper number
    if (isNaN(validValue) || !isFinite(validValue)) {
      setValue(min.toString());
      if (inputRef.current) {
        inputRef.current.value = min.toString();
      }
      return;
    }
    
    // Update state to match the validated value (for consistency)
    setValue(validValue.toString());
    if (inputRef.current) {
      inputRef.current.value = validValue.toString();
    }
    
    // Apply the validated value immediately
    onApply(validValue);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-sm" 
        onKeyDown={handleDialogKeyDown}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted rounded-lg p-4 text-right">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              className="w-full text-3xl font-bold bg-transparent border-none outline-none text-right focus:ring-0"
              autoFocus
              inputMode="decimal"
            />
            {max !== undefined && (
              <div className="text-xs text-muted-foreground mt-1">Max: {max}</div>
            )}
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
          <Button onClick={handleApply} className="flex-1">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
