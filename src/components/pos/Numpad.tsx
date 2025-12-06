import { useState } from 'react';
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

  const handleNumberClick = (num: string) => {
    if (value === '0') {
      setValue(num);
    } else {
      setValue(value + num);
    }
  };

  const handleDecimalClick = () => {
    if (!value.includes('.')) {
      setValue(value + '.');
    }
  };

  const handleClear = () => {
    setValue('0');
  };

  const handleBackspace = () => {
    if (value.length === 1) {
      setValue('0');
    } else {
      setValue(value.slice(0, -1));
    }
  };

  const handleApply = () => {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      setValue('0');
      return;
    }
    
    let validValue = numValue;
    if (validValue < min) validValue = min;
    if (max !== undefined && validValue > max) validValue = max;
    
    onApply(validValue);
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleApply();
    } else if (e.key === 'Escape') {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted rounded-lg p-4 text-right">
            <div className="text-3xl font-bold">{value}</div>
            {max !== undefined && (
              <div className="text-xs text-muted-foreground mt-1">Max: {max}</div>
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
