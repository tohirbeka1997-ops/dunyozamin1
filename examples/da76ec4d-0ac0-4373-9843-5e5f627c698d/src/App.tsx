import React, { useState } from 'react';
import { ProductForm } from './components/ProductForm.tsx';
import { ProductList } from './components/ProductList.tsx';
import { Warehouse } from 'lucide-react';
import type { Product, ProductFormData } from './types.ts';

function App() {
  const [products, setProducts] = useState<Product[]>([]);

  const handleProductSubmit = (data: ProductFormData, type: 'in' | 'out') => {
    const now = new Date().toLocaleString('zh-CN');
    const existingProduct = products.find(p => p.name === data.name && p.unit === data.unit);

    if (existingProduct) {
      const newQuantity = type === 'in' 
        ? existingProduct.quantity + data.quantity
        : existingProduct.quantity - data.quantity;

      if (type === 'out' && newQuantity < 0) {
        alert('库存不足！');
        return;
      }

      setProducts(products.map(p => 
        p.id === existingProduct.id
          ? { ...p, quantity: newQuantity, lastUpdated: now }
          : p
      ).filter(p => p.quantity > 0));
    } else {
      if (type === 'out') {
        alert('产品不存在，无法出库！');
        return;
      }

      setProducts([
        ...products,
        {
          id: crypto.randomUUID(),
          name: data.name,
          quantity: data.quantity,
          unit: data.unit,
          lastUpdated: now
        }
      ]);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center p-3 bg-blue-50 rounded-2xl mb-4">
            <Warehouse className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900">
            仓库管理系统
          </h1>
          <p className="mt-3 text-gray-600 max-w-2xl mx-auto">
            高效管理您的库存，轻松实现产品出入库操作
          </p>
        </div>
        
        <div className="space-y-8">
          <ProductForm onSubmit={handleProductSubmit} />
          <ProductList products={products} />
        </div>
      </div>
    </div>
  );
}

export default App