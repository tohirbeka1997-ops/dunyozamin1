import type { ReactNode } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POSTerminal from './pages/POSTerminal';
import Products from './pages/Products';
import ProductForm from './pages/ProductForm';
import ProductDetailRedirect from './pages/ProductDetailRedirect';
import Categories from './pages/Categories';
import CategoryDetail from './pages/CategoryDetail';
import Orders from './pages/Orders';
import WebOrders from './pages/WebOrders';
import OrderDetail from './pages/OrderDetail';
import Customers from './pages/Customers';
import CustomerForm from './pages/CustomerForm';
import CustomerDetail from './pages/CustomerDetail';
import Inventory from './pages/Inventory';
import InventoryDetail from './pages/InventoryDetail';
import PurchaseOrders from './pages/PurchaseOrders';
import PurchaseOrderForm from './pages/PurchaseOrderForm';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import PurchaseReceiptForm from './pages/PurchaseReceiptForm';
import Suppliers from './pages/Suppliers';
import SupplierForm from './pages/SupplierForm';
import SupplierDetail from './pages/SupplierDetail';
import SalesReturns from './pages/SalesReturns';
import CreateReturn from './pages/CreateReturn';
import EditReturn from './pages/EditReturn';
import ReturnDetail from './pages/ReturnDetail';
import Reports from './pages/Reports';
import DailySalesReport from './pages/reports/sales/DailySalesReport';
import ProductSalesReport from './pages/reports/sales/ProductSalesReport';
import CustomerSalesReport from './pages/reports/sales/CustomerSalesReport';
import PromotionReport from './pages/reports/sales/PromotionReport';
import StockLevelsReport from './pages/reports/inventory/StockLevelsReport';
import InventoryMovementReport from './pages/reports/inventory/InventoryMovementReport';
import ValuationReport from './pages/reports/inventory/ValuationReport';
import InventoryAdvancedReport from './pages/reports/inventory/InventoryAdvancedReport';
import ProductTraceabilityReport from './pages/reports/inventory/ProductTraceabilityReport';
import PurchasePlanningReport from './pages/reports/inventory/PurchasePlanningReport';
import ActSverkaReport from './pages/reports/act-sverka/ActSverkaReport';
import ProfitLossReport from './pages/reports/financial/ProfitLossReport';
import PaymentMethodReport from './pages/reports/financial/PaymentMethodReport';
import CashFlowReport from './pages/reports/financial/CashFlowReport';
import CashDiscrepancyReport from './pages/reports/financial/CashDiscrepancyReport';
import AgingReport from './pages/reports/financial/AgingReport';
import VIPCustomersReport from './pages/reports/customer/VIPCustomersReport';
import LoyaltyPointsReport from './pages/reports/customer/LoyaltyPointsReport';
import LostCustomersReport from './pages/reports/customer/LostCustomersReport';
import CustomerProfitabilityReport from './pages/reports/customer/CustomerProfitabilityReport';
import CustomerActSverkaReport from './pages/reports/customer/CustomerActSverkaReport';
import SupplierActSverkaReport from './pages/reports/supplier/SupplierActSverkaReport';
import DeliveryAccuracyReport from './pages/reports/supplier/DeliveryAccuracyReport';
import PriceHistoryReport from './pages/reports/supplier/PriceHistoryReport';
import SupplierProductSalesReport from './pages/reports/supplier/SupplierProductSalesReport';
import PurchaseSaleSpreadReport from './pages/reports/supplier/PurchaseSaleSpreadReport';
import CashierPerformanceReport from './pages/reports/employee/CashierPerformanceReport';
import CashierErrorsReport from './pages/reports/employee/CashierErrorsReport';
import ShiftProductivityReport from './pages/reports/employee/ShiftProductivityReport';
import FraudSignalsReport from './pages/reports/employee/FraudSignalsReport';
import DeviceHealthReport from './pages/reports/system/DeviceHealthReport';
import AuditLogReport from './pages/reports/system/AuditLogReport';
import PriceChangeHistoryReport from './pages/reports/system/PriceChangeHistoryReport';
import ExecutiveDashboard from './pages/reports/executive/ExecutiveDashboard';
import LoginActivityReport from './pages/reports/employee/LoginActivityReport';
import PurchaseOrderSummaryReport from './pages/reports/purchase/PurchaseOrderSummaryReport';
import SupplierPerformanceReport from './pages/reports/purchase/SupplierPerformanceReport';
import ExportManager from './pages/reports/export/ExportManager';
import Employees from './pages/Employees';
import EmployeeForm from './pages/employees/EmployeeForm';
import EmployeeDetail from './pages/employees/EmployeeDetail';
import Settings from './pages/Settings';
import ReceiptBarcodePage from './pages/tools/ReceiptBarcodePage';
import BarcodeDesignerPage from './pages/tools/BarcodeDesignerPage';
import BarcodeCenterPage from './pages/barcodes/BarcodeCenterPage';
import Quotes from './pages/Quotes';
import QuoteForm from './pages/QuoteForm';
import QuoteDetail from './pages/QuoteDetail';
import ReceiptDesignerPage from './pages/barcodes/ReceiptDesignerPage';
import ProductBarcodeServicePage from './pages/barcodes/ProductBarcodeServicePage';
import ScaleBarcodeServicePage from './pages/barcodes/ScaleBarcodeServicePage';
import ShelfLabelServicePage from './pages/barcodes/ShelfLabelServicePage';
import ResetPassword from './pages/ResetPassword';
import MasterLogin from './pages/admin/MasterLogin';
import StoresAdmin from './pages/admin/Stores';
import Expenses from './pages/Expenses';
import Promotions from './pages/Promotions';
import PromotionForm from './pages/PromotionForm';
import PromotionDetail from './pages/PromotionDetail';
import SalesReportsHub from './pages/reports/hubs/SalesReportsHub';
import FinancialReportsHub from './pages/reports/hubs/FinancialReportsHub';
import InventoryReportsHub from './pages/reports/hubs/InventoryReportsHub';
import PurchaseSupplierReportsHub from './pages/reports/hubs/PurchaseSupplierReportsHub';
import CrmReportsHub from './pages/reports/hubs/CrmReportsHub';
import EmployeeControlReportsHub from './pages/reports/hubs/EmployeeControlReportsHub';
import TechAuditReportsHub from './pages/reports/hubs/TechAuditReportsHub';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  requireAuth?: boolean;
  allowedRoles?: string[];
}

const routes: RouteConfig[] = [
  {
    name: 'Login',
    path: '/login',
    element: <Login />,
    visible: false,
    requireAuth: false,
  },
  {
    name: 'Reset Password',
    path: '/reset-password',
    element: <ResetPassword />,
    visible: false,
    requireAuth: false,
  },
  {
    name: 'Reset Password (Auth)',
    path: '/auth/reset-password',
    element: <ResetPassword />,
    visible: false,
    requireAuth: false,
  },
  // Multi-tenant super-admin surface (Bosqich 16). These routes bypass the
  // usual MainLayout + PrivateRoute wrapper because master sessions have NO
  // tenant and therefore no cashier/manager chrome. App.tsx special-cases
  // them via AdminRoute / AdminPublicRoute guards.
  {
    name: 'Master Login',
    path: '/admin/login',
    element: <MasterLogin />,
    visible: false,
    requireAuth: false,
  },
  {
    name: 'Stores Admin',
    path: '/admin/stores',
    element: <StoresAdmin />,
    visible: false,
    // requireAuth stays false here; App.tsx applies AdminRoute which demands
    // scope='master' rather than a tenant user.
    requireAuth: false,
  },
  {
    name: 'Dashboard',
    path: '/',
    element: <Dashboard />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'POS Terminal',
    path: '/pos',
    element: <POSTerminal />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'Products',
    path: '/products',
    element: <Products />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'Add Product',
    path: '/products/new',
    element: <ProductForm />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Edit Product',
    path: '/products/:id/edit',
    element: <ProductForm />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Product Detail',
    path: '/products/:id',
    element: <ProductDetailRedirect />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Categories',
    path: '/categories',
    element: <Categories />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Category Detail',
    path: '/categories/:id',
    element: <CategoryDetail />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Promotions',
    path: '/promotions',
    element: <Promotions />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Promotion',
    path: '/promotions/new',
    element: <PromotionForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Promotion Detail',
    path: '/promotions/:id',
    element: <PromotionDetail />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Edit Promotion',
    path: '/promotions/:id/edit',
    element: <PromotionForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Orders',
    path: '/orders',
    element: <Orders />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'Online Orders',
    path: '/web-orders',
    element: <WebOrders />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Order Detail',
    path: '/orders/:id',
    element: <OrderDetail />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Sales Returns',
    path: '/returns',
    element: <SalesReturns />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'Create Return',
    path: '/returns/create',
    element: <CreateReturn />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Edit Return',
    path: '/returns/:id/edit',
    element: <EditReturn />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Return Detail',
    path: '/returns/:id',
    element: <ReturnDetail />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Expenses',
    path: '/expenses',
    element: <Expenses />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'Smeta',
    path: '/quotes',
    element: <Quotes />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'New Quote',
    path: '/quotes/new',
    element: <QuoteForm />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Quote Detail',
    path: '/quotes/:id',
    element: <QuoteDetail />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Edit Quote',
    path: '/quotes/:id/edit',
    element: <QuoteForm />,
    visible: false,
    requireAuth: true,
  },
  // Backward compatibility: keep /sales-returns routes
  {
    name: 'Sales Returns',
    path: '/sales-returns',
    element: <SalesReturns />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Create Return',
    path: '/sales-returns/create',
    element: <CreateReturn />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Edit Return',
    path: '/sales-returns/:id/edit',
    element: <EditReturn />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Return Detail',
    path: '/sales-returns/:id',
    element: <ReturnDetail />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Customers',
    path: '/customers',
    element: <Customers />,
    visible: true,
    requireAuth: true,
  },
  {
    name: 'Add Customer',
    path: '/customers/new',
    element: <CustomerForm />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Edit Customer',
    path: '/customers/:id/edit',
    element: <CustomerForm />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Customer Detail',
    path: '/customers/:id',
    element: <CustomerDetail />,
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Inventory',
    path: '/inventory',
    element: <Inventory />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Inventory Detail',
    path: '/inventory/:id',
    element: <InventoryDetail />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Purchase Orders',
    path: '/purchase-orders',
    element: <PurchaseOrders />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Purchase Order',
    path: '/purchase-orders/new',
    element: <PurchaseOrderForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Edit Purchase Order',
    path: '/purchase-orders/:id/edit',
    element: <PurchaseOrderForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Purchase Order Detail',
    path: '/purchase-orders/:id',
    element: <PurchaseOrderDetail />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Purchase Receipt',
    path: '/purchase-orders/:id/receive',
    element: <PurchaseReceiptForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Purchase Receipt',
    path: '/purchase-receipts/new',
    element: <PurchaseReceiptForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Suppliers',
    path: '/suppliers',
    element: <Suppliers />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Supplier',
    path: '/suppliers/new',
    element: <SupplierForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Edit Supplier',
    path: '/suppliers/:id/edit',
    element: <SupplierForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Supplier Detail',
    path: '/suppliers/:id',
    element: <SupplierDetail />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Reports',
    path: '/reports',
    element: <Reports />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  // Reports hubs (3-level structure)
  {
    name: 'Sotuv hisobotlari',
    path: '/reports/sales',
    element: <SalesReportsHub />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Moliyaviy hisobotlar',
    path: '/reports/financial',
    element: <FinancialReportsHub />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor hisobotlari',
    path: '/reports/inventory',
    element: <InventoryReportsHub />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xarid va yetkazib beruvchi',
    path: '/reports/purchase',
    element: <PurchaseSupplierReportsHub />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mijozlar (CRM)',
    path: '/reports/customer',
    element: <CrmReportsHub />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xodimlar va nazorat',
    path: '/reports/employee',
    element: <EmployeeControlReportsHub />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Texnik va audit',
    path: '/reports/system',
    element: <TechAuditReportsHub />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Boshqaruv dashboard',
    path: '/reports/executive/dashboard',
    element: <ExecutiveDashboard />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Kunlik savdo',
    path: '/reports/sales/daily',
    element: <DailySalesReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mahsulotlar bo‘yicha savdo',
    path: '/reports/sales/products',
    element: <ProductSalesReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Aksiyalar hisoboti',
    path: '/reports/sales/promotions',
    element: <PromotionReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor qoldiqlari',
    path: '/reports/inventory/stock-levels',
    element: <StockLevelsReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Bozorga borish hisoboti',
    path: '/reports/inventory/purchase-planning',
    element: <PurchasePlanningReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Foyda va zarar (P&L)',
    path: '/reports/financial/profit-loss',
    element: <ProfitLossReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mijozlar bo‘yicha savdo',
    path: '/reports/sales/customers',
    element: <CustomerSalesReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor harakatlari',
    path: '/reports/inventory/movements',
    element: <InventoryMovementReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mahsulot tarixi (Traceability)',
    path: '/reports/inventory/traceability',
    element: <ProductTraceabilityReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  // FIXED: Valuation Report route - handles '/reports/inventory/valuation' path
  // This route must be defined before any catch-all routes in App.tsx
  {
    name: 'Ombor qiymati',
    path: '/reports/inventory/valuation',
    element: <ValuationReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor tahlili (kengaytirilgan)',
    path: '/reports/inventory/advanced',
    element: <InventoryAdvancedReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Akt sverka (partiya)',
    path: '/reports/act-sverka',
    element: <ActSverkaReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: "To‘lov usullari bo‘yicha",
    path: '/reports/financial/payment-methods',
    element: <PaymentMethodReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Pul oqimi',
    path: '/reports/financial/cash-flow',
    element: <CashFlowReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kassa tafovuti',
    path: '/reports/financial/cash-discrepancies',
    element: <CashDiscrepancyReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Qarzdorlik (Aging)',
    path: '/reports/financial/aging',
    element: <AgingReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'VIP mijozlar',
    path: '/reports/customer/vip',
    element: <VIPCustomersReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Bonus ball hisoboti',
    path: '/reports/customer/loyalty',
    element: <LoyaltyPointsReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yo‘qolgan mijozlar',
    path: '/reports/customer/lost',
    element: <LostCustomersReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mijoz rentabelligi',
    path: '/reports/customer/profitability',
    element: <CustomerProfitabilityReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Akt sverka (mijoz)',
    path: '/reports/customer/act-sverka',
    element: <CustomerActSverkaReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Akt sverka (yetkazib beruvchi)',
    path: '/reports/supplier/act-sverka',
    element: <SupplierActSverkaReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kassir samaradorligi',
    path: '/reports/employee/cashier',
    element: <CashierPerformanceReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kirishlar tarixi',
    path: '/reports/employee/activity',
    element: <LoginActivityReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kassir xatolari',
    path: '/reports/employee/errors',
    element: <CashierErrorsReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Smena unumdorligi',
    path: '/reports/employee/shift-productivity',
    element: <ShiftProductivityReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Firibgarlik signallari',
    path: '/reports/employee/fraud-signals',
    element: <FraudSignalsReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xaridlar xulosasi',
    path: '/reports/purchase/summary',
    element: <PurchaseOrderSummaryReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yetkazib beruvchi samaradorligi',
    path: '/reports/purchase/suppliers',
    element: <SupplierPerformanceReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yetkazib berish aniqligi',
    path: '/reports/supplier/delivery-accuracy',
    element: <DeliveryAccuracyReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Narxlar tarixi',
    path: '/reports/supplier/price-history',
    element: <PriceHistoryReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yetkazib beruvchi → mahsulot sotuvlari',
    path: '/reports/supplier/product-sales',
    element: <SupplierProductSalesReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xarid–sotuv farqi',
    path: '/reports/supplier/purchase-sale-spread',
    element: <PurchaseSaleSpreadReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Eksport',
    path: '/reports/export',
    element: <ExportManager />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Qurilma holati',
    path: '/reports/system/device-health',
    element: <DeviceHealthReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Audit log',
    path: '/reports/system/audit-log',
    element: <AuditLogReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Narx o‘zgarish tarixi',
    path: '/reports/system/price-history',
    element: <PriceChangeHistoryReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Employees',
    path: '/employees',
    element: <Employees />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Add Employee',
    path: '/employees/new',
    element: <EmployeeForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Edit Employee',
    path: '/employees/:id/edit',
    element: <EmployeeForm />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Employee Detail',
    path: '/employees/:id',
    element: <EmployeeDetail />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Settings',
    path: '/settings',
    element: <Settings />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Barcode Center',
    path: '/barcodes',
    element: <BarcodeCenterPage />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Receipt Designer',
    path: '/barcodes/receipt-designer',
    element: <ReceiptDesignerPage />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Product Barcode Service',
    path: '/barcodes/product',
    element: <ProductBarcodeServicePage />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Scale Barcode Service',
    path: '/barcodes/scale',
    element: <ScaleBarcodeServicePage />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Shelf Label Service',
    path: '/barcodes/shelf-label',
    element: <ShelfLabelServicePage />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Receipt & Barcode Tools',
    path: '/tools/receipt-barcode',
    element: <ReceiptBarcodePage />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Barcode Designer',
    path: '/tools/barcode-designer',
    element: <BarcodeDesignerPage />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
];

export default routes;
