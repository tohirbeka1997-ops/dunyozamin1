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
import Inventory from './pages/Inventory';
import InventoryDetail from './pages/InventoryDetail';
import PurchaseOrders from './pages/PurchaseOrders';
import SalesReturns from './pages/SalesReturns';
import CreateReturn from './pages/CreateReturn';
import ReturnDetail from './pages/ReturnDetail';
import Reports from './pages/Reports';
import DailySalesReport from './pages/reports/sales/DailySalesReport';
import ProductSalesReport from './pages/reports/sales/ProductSalesReport';
import CustomerSalesReport from './pages/reports/sales/CustomerSalesReport';
import StockLevelsReport from './pages/reports/inventory/StockLevelsReport';
import InventoryMovementReport from './pages/reports/inventory/InventoryMovementReport';
import ProfitLossReport from './pages/reports/financial/ProfitLossReport';
import PaymentMethodReport from './pages/reports/financial/PaymentMethodReport';
import Employees from './pages/Employees';
import EmployeeForm from './pages/employees/EmployeeForm';
import EmployeeDetail from './pages/employees/EmployeeDetail';
import Settings from './pages/Settings';

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
    path: '/sales-returns',
    element: <SalesReturns />,
    visible: true,
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
  {
    name: 'Payment Method Report',
    path: '/reports/financial/payment-methods',
    element: <PaymentMethodReport />,
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
];

export default routes;
