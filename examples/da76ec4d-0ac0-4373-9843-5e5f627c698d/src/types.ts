export interface Product {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  lastUpdated: string;
}

export interface ProductFormData {
  name: string;
  quantity: number;
  unit: string;
}