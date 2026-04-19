import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Product } from '@/types/database';
import { Package } from 'lucide-react';
import { useCartStore } from '@/store/cart.store';
import { useInventoryStore } from '@/store/inventoryStore';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { formatUnit } from '@/utils/formatters';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';

interface ProductGridProps {
  products: Product[];
  onProductClick?: (product: Product) => void;
}

const ProductItem = memo(({ product, onClick }: { product: Product; onClick: () => void }) => {
  const { addItem } = useCartStore();
  const { getCurrentStockByProductId } = useInventoryStore();
  
  const currentStock = getCurrentStockByProductId(product.id);
  const isLowStock = currentStock < product.min_stock_level;
  const isOutOfStock = currentStock === 0;

  const handleClick = () => {
    if (!isOutOfStock) {
      addItem(product, 1);
      onClick();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isOutOfStock}
      className={`
        w-full p-4 rounded-lg border-2 transition-all text-left
        ${isOutOfStock 
          ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed dark:border-gray-800 dark:bg-gray-900' 
          : isLowStock
          ? 'border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950 dark:hover:border-orange-700'
          : 'border-gray-200 bg-card hover:border-primary hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-primary'
        }
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="h-12 w-12 rounded-lg bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
          {product.image_url ? (
            <img
              src={getProductImageDisplayUrl(product.image_url) || product.image_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <Package className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base mb-1 truncate">{product.name}</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>
            {isLowStock && !isOutOfStock && (
              <Badge variant="outline" className="text-xs border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400">
                Low Stock
              </Badge>
            )}
            {isOutOfStock && (
              <Badge variant="destructive" className="text-xs">
                Out of Stock
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-primary">
              {formatMoneyUZS(product.sale_price)}
            </span>
            <span className="text-sm text-muted-foreground">
              Stock: {formatNumberUZ(currentStock)} {formatUnit(product.unit)}
            </span>
          </div>
        </div>
        {!isOutOfStock && (
          <div className="flex-shrink-0">
            <Button size="sm" variant="outline" className="h-8 w-8 p-0">
              <Package className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </button>
  );
});

ProductItem.displayName = 'ProductItem';

export default function ProductGrid({ products, onProductClick }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
        <Package className="h-16 w-16 mb-4 opacity-50" />
        <p className="text-lg font-medium">No products found</p>
        <p className="text-sm">Try searching or selecting a different category</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 p-3">
      {products.map((product) => (
        <ProductItem
          key={product.id}
          product={product}
          onClick={() => onProductClick?.(product)}
        />
      ))}
    </div>
  );
}



