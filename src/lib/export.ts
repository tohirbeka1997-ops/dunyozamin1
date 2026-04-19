/**
 * Export utility functions for reports
 */

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatMoneyUZS } from './format';
import { formatDateTime } from '@/lib/datetime';

/**
 * Format number to UZS string (1.000.000 so'm)
 */
export const formatUzs = (n: number): string => {
  return formatMoneyUZS(n);
};

/**
 * Export daily sales report to Excel
 */
export const exportDailySalesToExcel = (
  orders: Array<{
    order_number: string;
    created_at: string;
    cashier?: { username?: string; full_name?: string };
    payment_type: string;
    total_amount: number;
    profit: number;
    status: string;
  }>,
  filters: {
    dateFrom: string;
    dateTo: string;
    cashierFilter: string;
    paymentFilter: string;
    statusFilter: string;
  },
  summary: {
    totalSales: number;
    totalProfit: number;
    totalReturns: number;
    avgOrderValue: number;
  },
  cashiers: Array<{ id: string; username?: string }>
): void => {
  // Create workbook
  const wb = XLSX.utils.book_new();

  // Header section
  const headerData = [
    ['Kunlik sotuv hisobotlari'],
    [],
    ['Hisobot davri:', `${filters.dateFrom} dan ${filters.dateTo} gacha`],
    ['Kassir:', filters.cashierFilter === 'all' ? 'Barcha kassirlar' : cashiers.find(c => c.id === filters.cashierFilter)?.username || filters.cashierFilter],
    ['To\'lov turi:', filters.paymentFilter === 'all' ? 'Barcha turlar' : filters.paymentFilter],
    ['Holati:', filters.statusFilter === 'all' ? 'Barcha holatlar' : filters.statusFilter],
    [],
    ['Jami sotuv:', formatUzs(summary.totalSales)],
    ['Jami foyda:', formatUzs(summary.totalProfit)],
    ['Qaytarilganlar:', formatUzs(summary.totalReturns)],
    ['O\'rtacha buyurtma qiymati:', formatUzs(summary.avgOrderValue)],
    [],
  ];

  // Table data
  const tableHeaders = [
    'Hisob-faktura raqami',
    'Sana/Vaqt',
    'Kassir',
    'To\'lov turi',
    'Jami sotuv',
    'Foyda',
    'Holat',
  ];

  const tableRows = orders.map((order) => [
    order.order_number,
    formatDateTime(order.created_at),
    order.cashier?.username || order.cashier?.full_name || '-',
    order.payment_type,
    formatUzs(order.total_amount),
    formatUzs(order.profit),
    order.status === 'completed' ? 'Tugallangan' : order.status === 'returned' ? 'Qaytarilgan' : order.status === 'hold' ? 'Kutilmoqda' : order.status,
  ]);

  // Combine header and table data
  const finalData = [...headerData, tableHeaders, ...tableRows];
  const ws = XLSX.utils.aoa_to_sheet(finalData);

  // Set column widths
  ws['!cols'] = [
    { wch: 20 }, // Order number
    { wch: 20 }, // Date/Time
    { wch: 15 }, // Cashier
    { wch: 15 }, // Payment type
    { wch: 18 }, // Total sales
    { wch: 18 }, // Profit
    { wch: 15 }, // Status
  ];

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');

  // Generate filename
  const filename = `daily-sales-report_${filters.dateFrom}_to_${filters.dateTo}.xlsx`;

  // Write file
  XLSX.writeFile(wb, filename);
};

/**
 * Export daily sales report to PDF
 */
export const exportDailySalesToPDF = (
  orders: Array<{
    order_number: string;
    created_at: string;
    cashier?: { username?: string; full_name?: string };
    payment_type: string;
    total_amount: number;
    profit: number;
    status: string;
  }>,
  filters: {
    dateFrom: string;
    dateTo: string;
    cashierFilter: string;
    paymentFilter: string;
    statusFilter: string;
  },
  summary: {
    totalSales: number;
    totalProfit: number;
    totalReturns: number;
    avgOrderValue: number;
  },
  cashiers: Array<{ id: string; username?: string }>
): void => {
  const doc = new jsPDF('landscape', 'mm', 'a4');

  // Title
  doc.setFontSize(18);
  doc.text('Kunlik sotuv hisobotlari', 14, 15);

  // Filters summary
  doc.setFontSize(10);
  let yPos = 25;
  doc.text(`Hisobot davri: ${filters.dateFrom} dan ${filters.dateTo} gacha`, 14, yPos);
  yPos += 5;
  doc.text(`Kassir: ${filters.cashierFilter === 'all' ? 'Barcha kassirlar' : cashiers.find(c => c.id === filters.cashierFilter)?.username || filters.cashierFilter}`, 14, yPos);
  yPos += 5;
  doc.text(`To'lov turi: ${filters.paymentFilter === 'all' ? 'Barcha turlar' : filters.paymentFilter}`, 14, yPos);
  yPos += 5;
  doc.text(`Holati: ${filters.statusFilter === 'all' ? 'Barcha holatlar' : filters.statusFilter}`, 14, yPos);
  yPos += 8;

  // Summary cards
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Jami sotuv:', 14, yPos);
  doc.setFont(undefined, 'normal');
  doc.text(formatUzs(summary.totalSales), 50, yPos);
  
  doc.setFont(undefined, 'bold');
  doc.text('Jami foyda:', 100, yPos);
  doc.setFont(undefined, 'normal');
  doc.text(formatUzs(summary.totalProfit), 140, yPos);
  
  yPos += 5;
  doc.setFont(undefined, 'bold');
  doc.text('Qaytarilganlar:', 14, yPos);
  doc.setFont(undefined, 'normal');
  doc.text(formatUzs(summary.totalReturns), 50, yPos);
  
  doc.setFont(undefined, 'bold');
  doc.text('O\'rtacha buyurtma qiymati:', 100, yPos);
  doc.setFont(undefined, 'normal');
  doc.text(formatUzs(summary.avgOrderValue), 180, yPos);
  
  yPos += 10;

  // Table data
  const tableData = orders.map((order) => [
    order.order_number,
    formatDateTime(order.created_at),
    order.cashier?.username || order.cashier?.full_name || '-',
    order.payment_type,
    formatUzs(order.total_amount),
    formatUzs(order.profit),
    order.status === 'completed' ? 'Tugallangan' : order.status === 'returned' ? 'Qaytarilgan' : order.status === 'hold' ? 'Kutilmoqda' : order.status,
  ]);

  autoTable(doc, {
    head: [['Hisob-faktura raqami', 'Sana/Vaqt', 'Kassir', 'To\'lov turi', 'Jami sotuv', 'Foyda', 'Holat']],
    body: tableData,
    startY: yPos,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 30 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
      4: { cellWidth: 30 },
      5: { cellWidth: 30 },
      6: { cellWidth: 25 },
    },
  });

  // Generate filename
  const filename = `daily-sales-report_${filters.dateFrom}_to_${filters.dateTo}.pdf`;

  // Save file
  doc.save(filename);
};

