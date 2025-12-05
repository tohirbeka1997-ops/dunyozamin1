import type { ReactNode } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POSTerminal from './pages/POSTerminal';
import Products from './pages/Products';
import ProductForm from './pages/ProductForm';
import ProductDetail from './pages/ProductDetail';
import Categories from './pages/Categories';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Customers from './pages/Customers';
import Inventory from './pages/Inventory';
import PurchaseOrders from './pages/PurchaseOrders';
import SalesReturns from './pages/SalesReturns';
import Reports from './pages/Reports';
import Employees from './pages/Employees';
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
    name: 'Employees',
    path: '/employees',
    element: <Employees />,
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Settings',
    path: '/settings',
    element: <Settings />,
    visible: true,
    requireAuth: true,
  },
];

export default routes;
