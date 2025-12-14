/**
 * Export functions for Export Manager page
 * Handles exports for all report types
 * Libraries are lazy-loaded to reduce initial bundle size
 */

import { formatMoneyUZS } from './format';
import { downloadBlob, downloadCSV } from './exportHelpers';
import { getOrders, getProfiles, getCustomers, getCategories, getProducts, getPurchaseOrders, getExpenses } from '@/db/api';
import type { OrderWithDetails, Profile, Customer, Category, Product, SalesReturnWithDetails } from '@/types/database';

/**
 * Helper to lazy load XLSX with timeout
 */
const loadXLSX = async (): Promise<typeof import('xlsx')> => {
  const XLSX = await import('xlsx');
  return XLSX;
};

/**
 * Helper to lazy load PDF libraries with timeout
 */
const loadPDF = async (): Promise<{ jsPDF: typeof import('jspdf').default; autoTable: typeof import('jspdf-autotable') }> => {
  const [{ default: jsPDF }, autoTable] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
};

/**
 * Format number to UZS string (1.000.000 so'm)
 */
const formatUzs = (n: number): string => {
  return formatMoneyUZS(n);
};

/**
 * Export Daily Sales Report
 */
export const exportDailySales = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const [ordersData, profilesData] = await Promise.all([
    getOrders(),
    getProfiles(),
  ]);

  // Use today's date range by default
  const today = new Date().toISOString().split('T')[0];
  const filtered = ordersData.filter((order) => {
    const orderDate = new Date(order.created_at).toISOString().split('T')[0];
    return orderDate === today && order.status === 'completed';
  });

  const calculateProfit = (order: OrderWithDetails) => {
    const items = order.items || [];
    const totalCost = items.reduce((sum, item) => {
      const product = item.product;
      const cost = product?.purchase_price || 0;
      return sum + (cost * Number(item.quantity));
    }, 0);
    return Number(order.total_amount) - totalCost;
  };

  const getPaymentType = (order: OrderWithDetails) => {
    const payments = order.payments || [];
    if (payments.length === 0) return 'N/A';
    if (payments.length > 1) return 'Mixed';
    return payments[0].payment_method.charAt(0).toUpperCase() + payments[0].payment_method.slice(1);
  };

  const totalSales = filtered.reduce((sum, o) => sum + Number(o.total_amount), 0);
  const totalProfit = filtered.reduce((sum, o) => sum + calculateProfit(o), 0);
  const totalReturns = ordersData.filter((o) => o.status === 'returned').reduce((sum, o) => sum + Number(o.total_amount), 0);
  const avgOrderValue = filtered.length > 0 ? totalSales / filtered.length : 0;

  const exportData = filtered.map((order) => ({
    order_number: order.order_number,
    created_at: order.created_at,
    cashier: order.cashier,
    payment_type: getPaymentType(order),
    total_amount: order.total_amount,
    profit: calculateProfit(order),
    status: order.status === 'completed' ? 'Tugallangan' : order.status === 'returned' ? 'Qaytarilgan' : order.status === 'hold' ? 'Kutilmoqda' : order.status,
  }));

  const filters = {
    dateFrom: today,
    dateTo: today,
    cashierFilter: 'all',
    paymentFilter: 'all',
    statusFilter: 'all',
  };

  const summary = {
    totalSales,
    totalProfit,
    totalReturns,
    avgOrderValue,
  };

  if (format === 'excel') {
    // Use existing export function
    const { exportDailySalesToExcel } = await import('./export');
    await exportDailySalesToExcel(exportData, filters, summary, profilesData);
  } else if (format === 'pdf') {
    const { exportDailySalesToPDF } = await import('./export');
    await exportDailySalesToPDF(exportData, filters, summary, profilesData);
  } else {
    // CSV
    const headers = ['Hisob-faktura raqami', 'Sana/Vaqt', 'Kassir', 'To\'lov turi', 'Jami sotuv', 'Foyda', 'Holat'];
    const rows = exportData.map((order) => [
      order.order_number,
      new Date(order.created_at).toLocaleString('uz-UZ'),
      order.cashier?.username || order.cashier?.full_name || '-',
      order.payment_type,
      formatUzs(order.total_amount),
      formatUzs(order.profit),
      order.status,
    ]);
    downloadCSV(headers, rows, `daily-sales-report_${today}.csv`);
  }
};

/**
 * Export Product Sales Report
 */
export const exportProductSales = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const [ordersData, categoriesData] = await Promise.all([
    getOrders(),
    getCategories(),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const filtered = ordersData.filter((order) => {
    const orderDate = new Date(order.created_at).toISOString().split('T')[0];
    return orderDate === today && order.status === 'completed';
  });

  interface ProductSalesData {
    product_id: string;
    product_name: string;
    sku: string;
    category: string;
    quantity_sold: number;
    revenue: number;
    cost: number;
    profit: number;
    profit_margin: number;
  }

  const productMap = new Map<string, ProductSalesData>();

  filtered.forEach((order) => {
    order.items?.forEach((item) => {
      const product = item.product;
      if (!product) return;

      const key = product.id;
      const existing = productMap.get(key);
      
      const quantity = Number(item.quantity);
      const revenue = Number(item.subtotal);
      const cost = Number(product.purchase_price || 0) * quantity;
      const profit = revenue - cost;

      if (existing) {
        existing.quantity_sold += quantity;
        existing.revenue += revenue;
        existing.cost += cost;
        existing.profit += profit;
        existing.profit_margin = (existing.profit / existing.revenue) * 100;
      } else {
        productMap.set(key, {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          category: product.category?.name || 'Uncategorized',
          quantity_sold: quantity,
          revenue,
          cost,
          profit,
          profit_margin: (profit / revenue) * 100,
        });
      }
    });
  });

  const salesData = Array.from(productMap.values()).sort((a, b) => b.quantity_sold - a.quantity_sold);

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headers = ['Mahsulot nomi', 'SKU', 'Kategoriya', 'Sotilgan miqdor', 'Daromad', 'Xarajat', 'Foyda', 'Foyda foizi (%)'];
    const rows = salesData.map((item) => [
      item.product_name,
      item.sku,
      item.category,
      item.quantity_sold,
      formatUzs(item.revenue),
      formatUzs(item.cost),
      formatUzs(item.profit),
      `${item.profit_margin.toFixed(2)}%`,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `product-sales-report_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Mahsulotlar bo\'yicha sotuvlar', 14, 15);
    
    const tableData = salesData.map((item) => [
      item.product_name,
      item.sku,
      item.category,
      String(item.quantity_sold),
      formatUzs(item.revenue),
      formatUzs(item.cost),
      formatUzs(item.profit),
      `${item.profit_margin.toFixed(2)}%`,
    ]);

    autoTable(doc, {
      head: [['Mahsulot nomi', 'SKU', 'Kategoriya', 'Miqdor', 'Daromad', 'Xarajat', 'Foyda', 'Foyda %']],
      body: tableData,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`product-sales-report_${today}.pdf`);
  } else {
    // CSV
    const headers = ['Mahsulot nomi', 'SKU', 'Kategoriya', 'Sotilgan miqdor', 'Daromad', 'Xarajat', 'Foyda', 'Foyda foizi (%)'];
    const rows = salesData.map((item) => [
      item.product_name,
      item.sku,
      item.category,
      String(item.quantity_sold),
      formatUzs(item.revenue),
      formatUzs(item.cost),
      formatUzs(item.profit),
      `${item.profit_margin.toFixed(2)}%`,
    ]);
    downloadCSV(headers, rows, `product-sales-report_${today}.csv`);
  }
};

/**
 * Export Customer Sales Report
 */
export const exportCustomerSales = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const [ordersData, customersData] = await Promise.all([
    getOrders(),
    getCustomers(),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const filtered = ordersData.filter((order) => {
    const orderDate = new Date(order.created_at).toISOString().split('T')[0];
    return orderDate === today && order.status === 'completed';
  });

  interface CustomerSalesData {
    customer_id: string;
    customer_name: string;
    total_purchases: number;
    order_count: number;
    average_order_value: number;
    outstanding_balance: number;
  }

  const customerMap = new Map<string, CustomerSalesData>();

  filtered.forEach((order) => {
    const customerId = order.customer_id || 'walk-in';
    const customerName = order.customer?.name || 'Tasodifiy mijoz';
    const existing = customerMap.get(customerId);
    
    const amount = Number(order.total_amount);

    if (existing) {
      existing.total_purchases += amount;
      existing.order_count += 1;
      existing.average_order_value = existing.total_purchases / existing.order_count;
    } else {
      const customer = customersData.find((c) => c.id === customerId);
      customerMap.set(customerId, {
        customer_id: customerId,
        customer_name: customerName,
        total_purchases: amount,
        order_count: 1,
        average_order_value: amount,
        outstanding_balance: customer ? Number(customer.balance || 0) : 0,
      });
    }
  });

  const salesData = Array.from(customerMap.values()).sort((a, b) => b.total_purchases - a.total_purchases);

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headers = ['Mijoz nomi', 'Buyurtmalar soni', 'Jami xaridlar', 'O\'rtacha buyurtma', 'Qarz balansi'];
    const rows = salesData.map((item) => [
      item.customer_name,
      item.order_count,
      formatUzs(item.total_purchases),
      formatUzs(item.average_order_value),
      formatUzs(item.outstanding_balance),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `customer-sales-report_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Mijozlar bo\'yicha sotuvlar', 14, 15);
    
    const tableData = salesData.map((item) => [
      item.customer_name,
      String(item.order_count),
      formatUzs(item.total_purchases),
      formatUzs(item.average_order_value),
      formatUzs(item.outstanding_balance),
    ]);

    autoTable(doc, {
      head: [['Mijoz nomi', 'Buyurtmalar soni', 'Jami xaridlar', 'O\'rtacha buyurtma', 'Qarz balansi']],
      body: tableData,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`customer-sales-report_${today}.pdf`);
  } else {
    // CSV
    const headers = ['Mijoz nomi', 'Buyurtmalar soni', 'Jami xaridlar', 'O\'rtacha buyurtma', 'Qarz balansi'];
    const rows = salesData.map((item) => [
      item.customer_name,
      String(item.order_count),
      formatUzs(item.total_purchases),
      formatUzs(item.average_order_value),
      formatUzs(item.outstanding_balance),
    ]);
    downloadCSV(headers, rows, `customer-sales-report_${today}.csv`);
  }
};

/**
 * Export Stock Levels Report
 */
export const exportStockLevels = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const products = await getProducts();
  const today = new Date().toISOString().split('T')[0];

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headers = ['Mahsulot nomi', 'SKU', 'Kategoriya', 'Qoldiq', 'Minimal qoldiq', 'Holati'];
    const rows = products.map((product) => [
      product.name,
      product.sku,
      product.category?.name || '-',
      product.stock_quantity || 0,
      product.min_stock_level || 0,
      (product.stock_quantity || 0) <= (product.min_stock_level || 0) ? 'Past' : 'Normal',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 15 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `stock-levels-report_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Ombor qoldiq hisobotlari', 14, 15);
    
    const tableData = products.map((product) => [
      product.name,
      product.sku,
      product.category?.name || '-',
      String(product.stock_quantity || 0),
      String(product.min_stock_level || 0),
      (product.stock_quantity || 0) <= (product.min_stock_level || 0) ? 'Past' : 'Normal',
    ]);

    autoTable(doc, {
      head: [['Mahsulot nomi', 'SKU', 'Kategoriya', 'Qoldiq', 'Minimal qoldiq', 'Holati']],
      body: tableData,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`stock-levels-report_${today}.pdf`);
  } else {
    // CSV
    const headers = ['Mahsulot nomi', 'SKU', 'Kategoriya', 'Qoldiq', 'Minimal qoldiq', 'Holati'];
    const rows = products.map((product) => [
      product.name,
      product.sku,
      product.category?.name || '-',
      String(product.stock_quantity || 0),
      String(product.min_stock_level || 0),
      (product.stock_quantity || 0) <= (product.min_stock_level || 0) ? 'Past' : 'Normal',
    ]);
    downloadCSV(headers, rows, `stock-levels-report_${today}.csv`);
  }
};

/**
 * Export Inventory Movements Report
 */
export const exportInventoryMovements = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  // For now, return empty - this would need inventory movements API
  const today = new Date().toISOString().split('T')[0];
  
  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['Mahsulot', 'Harakat turi', 'Miqdor', 'Sana']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `inventory-movements-report_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Tovar harakatlari hisobotlari', 14, 15);
    doc.text('Ma\'lumotlar hozircha mavjud emas', 14, 25);
    doc.save(`inventory-movements-report_${today}.pdf`);
  } else {
    downloadCSV(['Mahsulot', 'Harakat turi', 'Miqdor', 'Sana'], [], `inventory-movements-report_${today}.csv`);
  }
};

/**
 * Export Valuation Report
 */
export const exportValuation = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const products = await getProducts();
  const today = new Date().toISOString().split('T')[0];

  const valuationData = products.map((product) => {
    const stock = product.stock_quantity || 0;
    const cost = product.purchase_price || 0;
    return {
      name: product.name,
      sku: product.sku,
      category: product.category?.name || '-',
      stock,
      cost,
      total_value: stock * cost,
    };
  });

  const totalValue = valuationData.reduce((sum, item) => sum + item.total_value, 0);

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headerData = [
      ['Baholash hisobotlari'],
      [],
      ['Jami qiymat:', formatUzs(totalValue)],
      [],
      ['Mahsulot nomi', 'SKU', 'Kategoriya', 'Qoldiq', 'Narx', 'Jami qiymat'],
    ];
    const rows = valuationData.map((item) => [
      item.name,
      item.sku,
      item.category,
      item.stock,
      formatUzs(item.cost),
      formatUzs(item.total_value),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([...headerData, ...rows]);
    ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `valuation-report_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Baholash hisobotlari', 14, 15);
    doc.setFontSize(11);
    doc.text(`Jami qiymat: ${formatUzs(totalValue)}`, 14, 25);
    
    const tableData = valuationData.map((item) => [
      item.name,
      item.sku,
      item.category,
      String(item.stock),
      formatUzs(item.cost),
      formatUzs(item.total_value),
    ]);

    autoTable(doc, {
      head: [['Mahsulot nomi', 'SKU', 'Kategoriya', 'Qoldiq', 'Narx', 'Jami qiymat']],
      body: tableData,
      startY: 30,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`valuation-report_${today}.pdf`);
  } else {
    const headers = ['Mahsulot nomi', 'SKU', 'Kategoriya', 'Qoldiq', 'Narx', 'Jami qiymat'];
    const rows = valuationData.map((item) => [
      item.name,
      item.sku,
      item.category,
      String(item.stock),
      formatUzs(item.cost),
      formatUzs(item.total_value),
    ]);
    downloadCSV(headers, rows, `valuation-report_${today}.csv`);
  }
};

/**
 * Export Purchase Order Summary
 */
export const exportPurchaseOrderSummary = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const purchaseOrders = await getPurchaseOrders();
  const today = new Date().toISOString().split('T')[0];

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headers = ['Buyurtma raqami', 'Yetkazib beruvchi', 'Sana', 'Jami summa', 'Holati'];
    const rows = purchaseOrders.map((po) => [
      po.purchase_order_number,
      po.supplier?.name || '-',
      new Date(po.created_at).toLocaleDateString('uz-UZ'),
      formatUzs(po.total_amount),
      po.status === 'draft' ? 'Qoralama' : po.status === 'approved' ? 'Tasdiqlangan' : po.status === 'received' ? 'Qabul qilingan' : po.status === 'cancelled' ? 'Bekor qilingan' : po.status,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 18 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `purchase-order-summary_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Xarid buyurtmalari umumiy hisobot', 14, 15);
    
    const tableData = purchaseOrders.map((po) => [
      po.purchase_order_number,
      po.supplier?.name || '-',
      new Date(po.created_at).toLocaleDateString('uz-UZ'),
      formatUzs(po.total_amount),
      po.status === 'draft' ? 'Qoralama' : po.status === 'approved' ? 'Tasdiqlangan' : po.status === 'received' ? 'Qabul qilingan' : po.status === 'cancelled' ? 'Bekor qilingan' : po.status,
    ]);

    autoTable(doc, {
      head: [['Buyurtma raqami', 'Yetkazib beruvchi', 'Sana', 'Jami summa', 'Holati']],
      body: tableData,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`purchase-order-summary_${today}.pdf`);
  } else {
    const headers = ['Buyurtma raqami', 'Yetkazib beruvchi', 'Sana', 'Jami summa', 'Holati'];
    const rows = purchaseOrders.map((po) => [
      po.purchase_order_number,
      po.supplier?.name || '-',
      new Date(po.created_at).toLocaleDateString('uz-UZ'),
      formatUzs(po.total_amount),
      po.status === 'draft' ? 'Qoralama' : po.status === 'approved' ? 'Tasdiqlangan' : po.status === 'received' ? 'Qabul qilingan' : po.status === 'cancelled' ? 'Bekor qilingan' : po.status,
    ]);
    downloadCSV(headers, rows, `purchase-order-summary_${today}.csv`);
  }
};

/**
 * Export Supplier Performance
 */
export const exportSupplierPerformance = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const purchaseOrders = await getPurchaseOrders();
  const today = new Date().toISOString().split('T')[0];

  interface SupplierData {
    supplier_name: string;
    order_count: number;
    total_amount: number;
    average_order: number;
  }

  const supplierMap = new Map<string, SupplierData>();

  purchaseOrders.forEach((po) => {
    const supplierName = po.supplier?.name || 'Noma\'lum';
    const existing = supplierMap.get(supplierName);
    const amount = Number(po.total_amount);

    if (existing) {
      existing.order_count += 1;
      existing.total_amount += amount;
      existing.average_order = existing.total_amount / existing.order_count;
    } else {
      supplierMap.set(supplierName, {
        supplier_name: supplierName,
        order_count: 1,
        total_amount: amount,
        average_order: amount,
      });
    }
  });

  const supplierData = Array.from(supplierMap.values()).sort((a, b) => b.total_amount - a.total_amount);

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headers = ['Yetkazib beruvchi', 'Buyurtmalar soni', 'Jami summa', 'O\'rtacha buyurtma'];
    const rows = supplierData.map((item) => [
      item.supplier_name,
      item.order_count,
      formatUzs(item.total_amount),
      formatUzs(item.average_order),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `supplier-performance_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Yetkazib beruvchilar samaradorligi', 14, 15);
    
    const tableData = supplierData.map((item) => [
      item.supplier_name,
      String(item.order_count),
      formatUzs(item.total_amount),
      formatUzs(item.average_order),
    ]);

    autoTable(doc, {
      head: [['Yetkazib beruvchi', 'Buyurtmalar soni', 'Jami summa', 'O\'rtacha buyurtma']],
      body: tableData,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`supplier-performance_${today}.pdf`);
  } else {
    const headers = ['Yetkazib beruvchi', 'Buyurtmalar soni', 'Jami summa', 'O\'rtacha buyurtma'];
    const rows = supplierData.map((item) => [
      item.supplier_name,
      String(item.order_count),
      formatUzs(item.total_amount),
      formatUzs(item.average_order),
    ]);
    downloadCSV(headers, rows, `supplier-performance_${today}.csv`);
  }
};

/**
 * Export Cashier Performance
 */
export const exportCashierPerformance = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const [ordersData, profilesData] = await Promise.all([
    getOrders(),
    getProfiles(),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const filtered = ordersData.filter((order) => {
    const orderDate = new Date(order.created_at).toISOString().split('T')[0];
    return orderDate === today && order.status === 'completed';
  });

  interface CashierData {
    cashier_name: string;
    order_count: number;
    total_sales: number;
    average_order: number;
  }

  const cashierMap = new Map<string, CashierData>();

  filtered.forEach((order) => {
    const cashierName = order.cashier?.username || order.cashier?.full_name || 'Noma\'lum';
    const existing = cashierMap.get(cashierName);
    const amount = Number(order.total_amount);

    if (existing) {
      existing.order_count += 1;
      existing.total_sales += amount;
      existing.average_order = existing.total_sales / existing.order_count;
    } else {
      cashierMap.set(cashierName, {
        cashier_name: cashierName,
        order_count: 1,
        total_sales: amount,
        average_order: amount,
      });
    }
  });

  const cashierData = Array.from(cashierMap.values()).sort((a, b) => b.total_sales - a.total_sales);

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headers = ['Kassir', 'Buyurtmalar soni', 'Jami sotuv', 'O\'rtacha buyurtma'];
    const rows = cashierData.map((item) => [
      item.cashier_name,
      item.order_count,
      formatUzs(item.total_sales),
      formatUzs(item.average_order),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `cashier-performance_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Kassir faoliyati', 14, 15);
    
    const tableData = cashierData.map((item) => [
      item.cashier_name,
      String(item.order_count),
      formatUzs(item.total_sales),
      formatUzs(item.average_order),
    ]);

    autoTable(doc, {
      head: [['Kassir', 'Buyurtmalar soni', 'Jami sotuv', 'O\'rtacha buyurtma']],
      body: tableData,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`cashier-performance_${today}.pdf`);
  } else {
    const headers = ['Kassir', 'Buyurtmalar soni', 'Jami sotuv', 'O\'rtacha buyurtma'];
    const rows = cashierData.map((item) => [
      item.cashier_name,
      String(item.order_count),
      formatUzs(item.total_sales),
      formatUzs(item.average_order),
    ]);
    downloadCSV(headers, rows, `cashier-performance_${today}.csv`);
  }
};

/**
 * Export Login Activity
 */
export const exportLoginActivity = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  // Placeholder - would need login activity API
  const today = new Date().toISOString().split('T')[0];
  
  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['Xodim', 'Kirish vaqti', 'Chiqish vaqti']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `login-activity_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Tizimga kirishlar jurnali', 14, 15);
    doc.text('Ma\'lumotlar hozircha mavjud emas', 14, 25);
    doc.save(`login-activity_${today}.pdf`);
  } else {
    downloadCSV(['Xodim', 'Kirish vaqti', 'Chiqish vaqti'], [], `login-activity_${today}.csv`);
  }
};

/**
 * Export Profit & Loss
 */
export const exportProfitLoss = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const [ordersData, expensesData] = await Promise.all([
    getOrders(),
    getExpenses(),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const completedOrders = ordersData.filter((order) => {
    const orderDate = new Date(order.created_at).toISOString().split('T')[0];
    return orderDate === today && order.status === 'completed';
  });

  const totalRevenue = completedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
  const totalExpenses = expensesData.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalReturns = ordersData.filter((o) => o.status === 'returned').reduce((sum, o) => sum + Number(o.total_amount), 0);
  const netProfit = totalRevenue - totalExpenses - totalReturns;

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headerData = [
      ['Foyda va zarar hisobotlari'],
      [],
      ['Jami daromad:', formatUzs(totalRevenue)],
      ['Jami xarajatlar:', formatUzs(totalExpenses)],
      ['Jami qaytarishlar:', formatUzs(totalReturns)],
      ['Sof foyda:', formatUzs(netProfit)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(headerData);
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `profit-loss_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('Foyda va zarar hisobotlari', 14, 15);
    doc.setFontSize(11);
    let yPos = 25;
    doc.text(`Jami daromad: ${formatUzs(totalRevenue)}`, 14, yPos);
    yPos += 5;
    doc.text(`Jami xarajatlar: ${formatUzs(totalExpenses)}`, 14, yPos);
    yPos += 5;
    doc.text(`Jami qaytarishlar: ${formatUzs(totalReturns)}`, 14, yPos);
    yPos += 5;
    doc.setFont(undefined, 'bold');
    doc.text(`Sof foyda: ${formatUzs(netProfit)}`, 14, yPos);
    doc.save(`profit-loss_${today}.pdf`);
  } else {
    const headers = ['Ko\'rsatkich', 'Summa'];
    const rows = [
      ['Jami daromad', formatUzs(totalRevenue)],
      ['Jami xarajatlar', formatUzs(totalExpenses)],
      ['Jami qaytarishlar', formatUzs(totalReturns)],
      ['Sof foyda', formatUzs(netProfit)],
    ];
    downloadCSV(headers, rows, `profit-loss_${today}.csv`);
  }
};

/**
 * Export Payment Methods
 */
export const exportPaymentMethods = async (
  format: 'excel' | 'pdf' | 'csv'
): Promise<void> => {
  const ordersData = await getOrders();
  const today = new Date().toISOString().split('T')[0];
  const filtered = ordersData.filter((order) => {
    const orderDate = new Date(order.created_at).toISOString().split('T')[0];
    return orderDate === today && order.status === 'completed';
  });

  interface PaymentMethodData {
    method: string;
    count: number;
    total: number;
  }

  const methodMap = new Map<string, PaymentMethodData>();

  filtered.forEach((order) => {
    order.payments?.forEach((payment) => {
      const method = payment.payment_method;
      const existing = methodMap.get(method);
      const amount = Number(payment.amount);

      if (existing) {
        existing.count += 1;
        existing.total += amount;
      } else {
        methodMap.set(method, {
          method: method === 'cash' ? 'Naqd pul' : method === 'card' ? 'Karta' : method === 'qr' ? 'QR' : method === 'credit' ? 'Nasiya' : method,
          count: 1,
          total: amount,
        });
      }
    });
  });

  const methodData = Array.from(methodMap.values()).sort((a, b) => b.total - a.total);

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const headers = ['To\'lov usuli', 'To\'lovlar soni', 'Jami summa'];
    const rows = methodData.map((item) => [
      item.method,
      item.count,
      formatUzs(item.total),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
    XLSX.writeFile(wb, `payment-methods_${today}.xlsx`);
  } else if (format === 'pdf') {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(18);
    doc.text('To\'lov usullari bo\'yicha tahlil', 14, 15);
    
    const tableData = methodData.map((item) => [
      item.method,
      String(item.count),
      formatUzs(item.total),
    ]);

    autoTable(doc, {
      head: [['To\'lov usuli', 'To\'lovlar soni', 'Jami summa']],
      body: tableData,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
    } as any);

    doc.save(`payment-methods_${today}.pdf`);
  } else {
    const headers = ['To\'lov usuli', 'To\'lovlar soni', 'Jami summa'];
    const rows = methodData.map((item) => [
      item.method,
      String(item.count),
      formatUzs(item.total),
    ]);
    downloadCSV(headers, rows, `payment-methods_${today}.csv`);
  }
};

