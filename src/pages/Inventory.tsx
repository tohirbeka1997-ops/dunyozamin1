import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInventoryStore } from "@/store/inventoryStore";
import { getProducts, getCategories } from "@/db/api";
import { useAuth } from "@/contexts/AuthContext";
import type { Product, Category } from "@/types/database";
import { useToast } from "@/hooks/use-toast";
import PageBreadcrumb from "@/components/common/PageBreadcrumb";
import { Search, Package, AlertTriangle } from "lucide-react";
import StockAdjustmentDialog from "@/components/inventory/StockAdjustmentDialog";
import { formatUnit } from "@/utils/formatters";
import { formatNumberUZ } from "@/lib/format";

export default function Inventory() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { getCurrentStockByProductId } = useInventoryStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<string>("all");
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const loadData = async () => {
    // Don't load if auth is still loading or user is not authenticated
    if (authLoading || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [productsData, categoriesData] = await Promise.all([getProducts(), getCategories()]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to load inventory data");
      console.error("Error loading data:", error);
      const { logSupabaseError } = await import("@/lib/supabaseErrorLogger");
      logSupabaseError(error, {
        table: "products/categories",
        operation: "select",
        queryKey: "loadInventory",
        userId: user?.id,
      });
      setError(error);
      toast({
        title: "Xatolik",
        description: error.message || "Ombor ma'lumotlarini yuklab bo'lmadi",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadData();
      // Load inventory from storage on mount
      useInventoryStore.getState().loadFromStorage();

      // Listen for product updates (e.g., when PO is received, stock is adjusted)
      // This ensures inventory page refreshes when stock changes
      const handleProductUpdate = () => {
        console.log("Product update detected, refreshing inventory...");
        loadData();
        // Also reload inventory store
        useInventoryStore.getState().loadFromStorage();
      };

      // Import productUpdateEmitter dynamically to avoid circular dependencies
      let unsubscribe: (() => void) | null = null;
      import("@/db/api").then(({ productUpdateEmitter }) => {
        unsubscribe = productUpdateEmitter.subscribe(handleProductUpdate);
      });

      // Cleanup listener on unmount
      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]); // Only depend on authLoading, loadData is stable

  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      !searchTerm ||
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.barcode && product.barcode.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesCategory = categoryFilter === "all" || product.category_id === categoryFilter;

    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "low" && product.current_stock <= product.min_stock_level) ||
      (stockFilter === "out" && product.current_stock <= 0);

    return matchesSearch && matchesCategory && matchesStock;
  });

  const handleAdjustStock = (product: Product) => {
    setSelectedProduct(product);
    setAdjustmentDialogOpen(true);
  };

  const handleStockAdjusted = () => {
    loadData();
    useInventoryStore.getState().loadFromStorage();
  };

  return (
    <div className="space-y-6">
      <PageBreadcrumb items={[{ label: "Ombor", href: "/inventory" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Ombor</h1>
          <p className="text-muted-foreground">Mahsulotlar ombori va zaxirasi</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrlar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Barcha kategoriyalar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha kategoriyalar</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={stockFilter} onValueChange={setStockFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Barcha zaxiralar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha zaxiralar</SelectItem>
                <SelectItem value="low">Past zaxira</SelectItem>
                <SelectItem value="out">Tugagan</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mahsulotlar ({filteredProducts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <p className="text-lg font-semibold mb-2">Xatolik</p>
              <p className="text-muted-foreground mb-4">
                {error.message || "Ombor ma'lumotlarini yuklab bo'lmadi"}
              </p>
              <Button onClick={() => loadData()} variant="outline">
                Qayta urinish
              </Button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Mahsulotlar topilmadi</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead>SKU / Barcode</TableHead>
                    <TableHead>Kategoriya</TableHead>
                    <TableHead>O'lchov birligi</TableHead>
                    <TableHead className="text-right">Sotish narxi</TableHead>
                    <TableHead className="text-right">Zaxira</TableHead>
                    <TableHead className="text-right">Harakatlar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => {
                    const currentStock =
                      getCurrentStockByProductId(product.id) ?? product.current_stock;
                    const isLowStock = currentStock <= product.min_stock_level;
                    const isOutOfStock = currentStock <= 0;

                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                              {product.image_url ? (
                                <img
                                  src={product.image_url}
                                  alt={product.name}
                                  className="h-full w-full object-cover rounded"
                                />
                              ) : (
                                <Package className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium">{product.name}</p>
                              {product.description && (
                                <p className="text-xs text-muted-foreground line-clamp-1">
                                  {product.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <p className="font-mono">{product.sku}</p>
                            {product.barcode && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {product.barcode}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {categories.find((c) => c.id === product.category_id)?.name || "-"}
                        </TableCell>
                        <TableCell>{formatUnit(product.unit)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {new Intl.NumberFormat("uz-UZ", {
                            style: "currency",
                            currency: "UZS",
                            minimumFractionDigits: 0,
                          }).format(product.sale_price)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isLowStock && !isOutOfStock && (
                              <AlertTriangle className="h-4 w-4 text-warning" />
                            )}
                            {isOutOfStock && <AlertTriangle className="h-4 w-4 text-destructive" />}
                            <span
                              className={`font-medium ${isOutOfStock ? "text-destructive" : isLowStock ? "text-warning" : ""}`}
                            >
                              {formatNumberUZ(currentStock)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatUnit(product.unit)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAdjustStock(product)}
                          >
                            Zaxirani tahrirlash
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <StockAdjustmentDialog
        open={adjustmentDialogOpen}
        onOpenChange={setAdjustmentDialogOpen}
        product={selectedProduct}
        onStockAdjusted={handleStockAdjusted}
      />
    </div>
  );
}
