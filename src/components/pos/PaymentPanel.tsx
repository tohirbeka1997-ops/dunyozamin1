import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCartStore } from '@/store/cart.store';
import { useCustomerStore } from '@/store/customer.store';
import { formatCurrency } from '@/utils/totals';
import { DollarSign, ShoppingCart } from 'lucide-react';

interface PaymentPanelProps {
  onPaymentClick: () => void;
  onClearCart: () => void;
  vatRate?: number;
}

export default memo(function PaymentPanel({
  onPaymentClick,
  onClearCart,
  vatRate = 0,
}: PaymentPanelProps) {
  const { items, calculateTotals, getTotalItems, clearCart } = useCartStore();
  const { selectedCustomer } = useCustomerStore();
  
  const totals = calculateTotals(vatRate);
  const totalItems = getTotalItems();

  const handleClearCart = () => {
    if (items.length === 0) return;
    if (confirm('Are you sure you want to clear the cart?')) {
      clearCart();
      onClearCart();
    }
  };

  return (
    <div className="h-[250px] border-t bg-card flex flex-col">
      {/* Summary Section */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Items:</span>
          <span className="font-medium">{totalItems}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal:</span>
          <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
        </div>
        {totals.total_discount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Discount:</span>
            <span className="font-medium text-green-600 dark:text-green-400">
              -{formatCurrency(totals.total_discount)}
            </span>
          </div>
        )}
        {totals.vat_amount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">VAT:</span>
            <span className="font-medium">{formatCurrency(totals.vat_amount)}</span>
          </div>
        )}
        <div className="border-t pt-2 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">Total:</span>
            <span className="text-2xl font-bold text-primary">
              {formatCurrency(totals.total)}
            </span>
          </div>
        </div>
        {selectedCustomer && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Customer:</span>
              <Badge variant="outline">{selectedCustomer.name}</Badge>
            </div>
            {selectedCustomer.allow_debt && (
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-muted-foreground">Credit Limit:</span>
                <span className="font-medium">
                  {formatCurrency(selectedCustomer.credit_limit)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t space-y-2">
        <Button
          className="w-full h-12 text-lg font-semibold"
          onClick={onPaymentClick}
          disabled={items.length === 0}
        >
          <DollarSign className="h-5 w-5 mr-2" />
          Pay {formatCurrency(totals.total)}
        </Button>
        {items.length > 0 && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleClearCart}
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            Clear Cart
          </Button>
        )}
      </div>
    </div>
  );
});









