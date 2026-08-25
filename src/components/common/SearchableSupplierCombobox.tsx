import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import SearchableCombobox, { type SearchableComboboxOption } from './SearchableCombobox';
import type { Supplier, SupplierWithBalance } from '@/types/database';

type SupplierLike = Pick<Supplier, 'id' | 'name' | 'phone'> | SupplierWithBalance;

export type SearchableSupplierComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  suppliers: SupplierLike[];
  prefixOptions?: SearchableComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
};

export default function SearchableSupplierCombobox({
  value,
  onValueChange,
  suppliers,
  prefixOptions = [],
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  id,
  className,
  triggerClassName,
}: SearchableSupplierComboboxProps) {
  const { t } = useTranslation();

  const options = useMemo<SearchableComboboxOption[]>(() => {
    const supplierOptions = [...suppliers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((supplier) => ({
        value: supplier.id,
        label: supplier.name,
        sublabel: supplier.phone || undefined,
        keywords: supplier.phone || undefined,
      }));
    return [...prefixOptions, ...supplierOptions];
  }, [prefixOptions, suppliers]);

  return (
    <SearchableCombobox
      id={id}
      value={value}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder ?? t('combobox.select_supplier', 'Yetkazib beruvchini tanlang...')}
      searchPlaceholder={
        searchPlaceholder ?? t('combobox.search_supplier', "Ism yoki telefon bo'yicha qidirish...")
      }
      emptyMessage={emptyMessage ?? t('combobox.no_supplier', 'Yetkazib beruvchi topilmadi')}
      disabled={disabled}
      className={className}
      triggerClassName={triggerClassName}
    />
  );
}
