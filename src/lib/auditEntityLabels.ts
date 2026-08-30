/** UI labels for audit log entity_type codes (backend keeps raw codes). */
const AUDIT_ENTITY_LABELS: Record<string, string> = {
  price: "Narx o'zgarishi",
  product: 'Mahsulot',
  purchase_order: 'Xarid buyurtmasi',
  return: 'Qaytarish',
  customer: 'Mijoz',
  supplier: 'Yetkazib beruvchi',
  order: 'Buyurtma',
  user: 'Foydalanuvchi',
  setting: 'Sozlama',
};

export function auditEntityTypeLabel(code: string | null | undefined): string {
  const key = String(code || '').trim();
  if (!key) return "Noma'lum";
  return AUDIT_ENTITY_LABELS[key] || key;
}

export const AUDIT_ENTITY_FILTER_OPTIONS = [
  { value: 'product', label: 'Mahsulot' },
  { value: 'price', label: "Narx o'zgarishi" },
  { value: 'purchase_order', label: 'Xarid buyurtmasi' },
  { value: 'return', label: 'Qaytarish' },
  { value: 'customer', label: 'Mijoz' },
  { value: 'supplier', label: 'Yetkazib beruvchi' },
  { value: 'order', label: 'Buyurtma' },
  { value: 'user', label: 'Foydalanuvchi' },
  { value: 'setting', label: 'Sozlama' },
] as const;
