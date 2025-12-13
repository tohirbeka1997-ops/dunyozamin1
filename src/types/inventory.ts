export type InventoryMovementType =
  | 'initial'
  | 'sale'
  | 'sale_return'
  | 'manual_in'
  | 'manual_out';

export type InventoryMovement = {
  id: string;
  product_id: string;
  quantity: number; // positive for IN, negative for OUT
  type: InventoryMovementType;
  reason: string | null;
  created_at: string; // ISO string
};

export type ProductStock = {
  product_id: string;
  current_stock: number;
  min_stock_level: number;
};








