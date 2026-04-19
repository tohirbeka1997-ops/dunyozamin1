import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Star } from 'lucide-react';
import type { Product } from '@/types/database';

interface FavoriteProductsProps {
  products: Product[];
  onAddToCart: (product: Product) => void;
}

export default function FavoriteProducts({ products, onAddToCart }: FavoriteProductsProps) {
  if (products.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
          Favorite Products
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {products.slice(0, 8).map((product, index) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onAddToCart(product)}
              className="relative h-24 p-3 flex flex-col items-start justify-between rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:from-blue-700 active:to-blue-800 transition-all border border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 shadow-md hover:shadow-lg"
            >
              <div className="absolute top-2 right-2">
                <Badge
                  variant="outline"
                  className="text-xs px-1.5 py-0.5 bg-white/20 text-white border-white/30 backdrop-blur-sm"
                >
                  ALT+{index + 1}
                </Badge>
              </div>
              <div className="flex-1 flex flex-col items-start gap-1">
                <span className="font-semibold text-sm text-white leading-tight line-clamp-2">
                  {product.name}
                </span>
              </div>
              <div className="w-full flex items-center justify-between">
                <span className="text-xs text-slate-100 font-medium">
                  {Number(product.sale_price).toFixed(2)} UZS
                </span>
                <Badge variant="outline" className="text-xs bg-white/20 text-white border-white/30">
                  Hot
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
