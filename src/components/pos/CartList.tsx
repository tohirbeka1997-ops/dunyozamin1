import { memo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useCartStore } from '@/store/cart.store';
import { formatMoneyUZS } from '@/lib/format';
import { formatUnit } from '@/utils/formatters';
import { Trash2, Plus, Minus, Tag, Package } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';

const CartItemRow = memo(({ item }: { item: ReturnType<typeof useCartStore>['items'][0] }) => {
  const { updateQuantity, removeItem, setLineDiscount } = useCartStore();
  const [discountInput, setDiscountInput] = useState('');
  const [discountPopoverOpen, setDiscountPopoverOpen] = useState(false);

  const handleQuantityChange = (delta: number) => {
    const newQuantity = item.quantity + delta;
    if (newQuantity > 0) {
      updateQuantity(item.id, newQuantity);
    }
  };

  const handleDiscountSubmit = () => {
    const discount = parseFloat(discountInput);
    if (!isNaN(discount) && discount >= 0) {
      setLineDiscount(item.id, discount);
      setDiscountInput('');
      setDiscountPopoverOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h4 className="font-medium text-sm truncate">{item.product.name}</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
            onClick={() => removeItem(item.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span>{formatMoneyUZS(item.unit_price)}</span>
          <span>×</span>
          <span>{item.quantity}</span>
          <span>{formatUnit(item.product.unit)}</span>
        </div>
        <div className="flex items-center justify-between">
          <Popover open={discountPopoverOpen} onOpenChange={setDiscountPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <Tag className="h-3 w-3 mr-1" />
                Discount: {formatMoneyUZS(item.line_discount)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <div className="space-y-3">
                <Label className="text-xs">Line Discount (Amount)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={item.line_subtotal}
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  placeholder="Enter discount amount"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleDiscountSubmit();
                    }
                  }}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleDiscountSubmit} className="flex-1">
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setLineDiscount(item.id, 0);
                      setDiscountInput('');
                      setDiscountPopoverOpen(false);
                    }}
                  >
                    Clear
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Max: {formatMoneyUZS(item.line_subtotal)}
                </p>
              </div>
            </PopoverContent>
          </Popover>
          <span className="font-semibold text-sm">
            {formatMoneyUZS(item.line_total)}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => handleQuantityChange(1)}
        >
          <Plus className="h-3 w-3" />
        </Button>
        <span className="text-sm font-medium min-w-[2ch] text-center">
          {item.quantity}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => handleQuantityChange(-1)}
        >
          <Minus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
});

CartItemRow.displayName = 'CartItemRow';

export default function CartList() {
  const { items } = useCartStore();

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
        <Package className="h-12 w-12 mb-3 opacity-50" />
        <p className="text-sm font-medium">Cart is empty</p>
        <p className="text-xs">Add products to get started</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {items.map((item) => (
          <CartItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

