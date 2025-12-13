import type { ReactNode } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POSTerminal from './pages/POSTerminal';
import Products from './pages/Products';
import ProductForm from './pages/ProductForm';
import ProductDetail from './pages/ProductDetail';
import Categories from './pages/Categories';
import CategoryDetail from './pages/CategoryDetail';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Customers from './pages/Customers';
import CustomerForm from './pages/CustomerForm';
import CustomerDetail from './pages/CustomerDetail';
import Inventory from './pages/Inventory';
import InventoryDetail from './pages/InventoryDetail';
import PurchaseOrders from './pages/PurchaseOrders';
import PurchaseOrderForm from './pages/PurchaseOrderForm';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
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
import StockLevelsReport from './pages/reports/inventory/StockLevelsReport';
import InventoryMovementReport from './pages/reports/inventory/InventoryMovementReport';
import ValuationReport from './pages/reports/inventory/ValuationReport';
import ProfitLossReport from './pages/reports/financial/ProfitLossReport';
import PaymentMethodReport from './pages/reports/financial/PaymentMethodReport';
import CashierPerformanceReport from './pages/reports/employee/CashierPerformanceReport';
import LoginActivityReport from './pages/reports/employee/LoginActivityReport';
import PurchaseOrderSummaryReport from './pages/reports/purchase/PurchaseOrderSummaryReport';
import SupplierPerformanceReport from './pages/reports/purchase/SupplierPerformanceReport';
import ExportManager from './pages/reports/export/ExportManager';
import Employees from './pages/Employees';
import EmployeeForm from './pages/employees/EmployeeForm';
import EmployeeDetail from './pages/employees/EmployeeDetail';
import Settings from './pages/Settings';
import ReceiptBarcodePage from './pages/tools/ReceiptBarcodePage';
import ResetPassword from './pages/ResetPassword';
import Expenses from './pages/Expenses';

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
    element: <ProductDetail />,
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
    name: 'Orders',
    path: '/orders',
    element: <Orders />,
    visible: true,
    requireAuth: true,
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
  {
    name: 'Daily Sales Report',
    path: '/reports/sales/daily',
    element: <DailySalesReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Product Sales Report',
    path: '/reports/sales/products',
    element: <ProductSalesReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Stock Levels Report',
    path: '/reports/inventory/stock-levels',
    element: <StockLevelsReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Profit & Loss Report',
    path: '/reports/financial/profit-loss',
    element: <ProfitLossReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Customer Sales Report',
    path: '/reports/sales/customers',
    element: <CustomerSalesReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Inventory Movement Report',
    path: '/reports/inventory/movements',
    element: <InventoryMovementReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  // FIXED: Valuation Report route - handles '/reports/inventory/valuation' path
  // This route must be defined before any catch-all routes in App.tsx
  {
    name: 'Valuation Report',
    path: '/reports/inventory/valuation',
    element: <ValuationReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Payment Method Report',
    path: '/reports/financial/payment-methods',
    element: <PaymentMethodReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Cashier Performance Report',
    path: '/reports/employee/cashier',
    element: <CashierPerformanceReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Login Activity Report',
    path: '/reports/employee/activity',
    element: <LoginActivityReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Purchase Order Summary Report',
    path: '/reports/purchase/summary',
    element: <PurchaseOrderSummaryReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Supplier Performance Report',
    path: '/reports/purchase/suppliers',
    element: <SupplierPerformanceReport />,
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Export Manager',
    path: '/reports/export',
    element: <ExportManager />,
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
    name: 'Receipt & Barcode Tools',
    path: '/tools/receipt-barcode',
    element: <ReceiptBarcodePage />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
];

export default routes;
