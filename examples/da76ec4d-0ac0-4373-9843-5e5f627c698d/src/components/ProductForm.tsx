import React, { useState } from 'react';
import { Plus, Minus, Package2 } from 'lucide-react';
import type { ProductFormData } from '../types.ts';

interface ProductFormProps {
  onSubmit: (data: ProductFormData, type: 'in' | 'out') => void;
}

export function ProductForm({ onSubmit }: ProductFormProps) {
  const [formData, setFormData] = useState<ProductFormData>({
    name: '',
    quantity: 0,
    unit: '个'
  });

  const handleSubmit = (type: 'in' | 'out') => (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.quantity <= 0) {
      alert('数量必须大于0');
      return;
    }
    onSubmit(formData, type);
    setFormData({ name: '', quantity: 0, unit: '个' });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-xl font-semibold text-gray-900 flex items-center">
          <Package2 className="w-6 h-6 mr-2 text-blue-600" />
          产品操作
        </h2>
      </div>
      
      <form className="p-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              产品名称
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="form-input"
              placeholder="请输入产品名称"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              数量
            </label>
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: Math.max(0, parseInt(e.target.value) || 0) })}
              className="form-input"
              placeholder="请输入数量"
              required
              min="0"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              单位
            </label>
            <select
              value={formData.unit}
              onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              className="form-input"
            >
              <option value="个">个</option>
              <option value="箱">箱</option>
              <option value="件">件</option>
              <option value="kg">千克</option>
              <option value="吨">吨</option>
            </select>
          </div>
        </div>
        
        <div className="mt-6 flex justify-end space-x-4">
          <button
            type="submit"
            onClick={handleSubmit('in')}
            className="btn btn-success"
          >
            <Plus className="w-5 h-5 mr-2" />
            入库
          </button>
          <button
            type="submit"
            onClick={handleSubmit('out')}
            className="btn btn-danger"
          >
            <Minus className="w-5 h-5 mr-2" />
            出库
          </button>
        </div>
      </form>
    </div>
  );
}