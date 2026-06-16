import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import Login from './pages/Login';
import POSTerminal from './pages/POSTerminal';

const Customers = lazy(() => import('./pages/Customers'));
const CustomerForm = lazy(() => import('./pages/CustomerForm'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const Products = lazy(() => import('./pages/Products'));
const ProductForm = lazy(() => import('./pages/ProductForm'));
const ProductDetailRedirect = lazy(() => import('./pages/ProductDetailRedirect'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const SalesReturns = lazy(() => import('./pages/SalesReturns'));
const CreateReturn = lazy(() => import('./pages/CreateReturn'));
const EditReturn = lazy(() => import('./pages/EditReturn'));
const ReturnDetail = lazy(() => import('./pages/ReturnDetail'));

function lazyElement(Component: ComponentType): ReactNode {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[40vh] items-center justify-center">
          <div className="text-muted-foreground" aria-busy="true">
            …
          </div>
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

export interface KassaRouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  requireAuth?: boolean;
  visible?: boolean;
}

/** Minimal route table for Kassa Lite — login, POS, and cashier essentials. */
const kassaRoutes: KassaRouteConfig[] = [
  {
    name: 'Login',
    path: '/login',
    element: <Login />,
    requireAuth: false,
  },
  {
    name: 'POS Terminal',
    path: '/pos',
    element: <POSTerminal />,
    requireAuth: true,
    visible: true,
  },
  {
    name: 'Customers',
    path: '/customers',
    element: lazyElement(Customers),
    requireAuth: true,
    visible: true,
  },
  {
    name: 'New Customer',
    path: '/customers/new',
    element: lazyElement(CustomerForm),
    requireAuth: true,
  },
  {
    name: 'Edit Customer',
    path: '/customers/:id/edit',
    element: lazyElement(CustomerForm),
    requireAuth: true,
  },
  {
    name: 'Customer Detail',
    path: '/customers/:id',
    element: lazyElement(CustomerDetail),
    requireAuth: true,
  },
  {
    name: 'Products',
    path: '/products',
    element: lazyElement(Products),
    requireAuth: true,
    visible: true,
  },
  {
    name: 'Add Product',
    path: '/products/new',
    element: lazyElement(ProductForm),
    requireAuth: true,
  },
  {
    name: 'Edit Product',
    path: '/products/:id/edit',
    element: lazyElement(ProductForm),
    requireAuth: true,
  },
  {
    name: 'Product Detail',
    path: '/products/:id',
    element: lazyElement(ProductDetailRedirect),
    requireAuth: true,
  },
  {
    name: 'Orders',
    path: '/orders',
    element: lazyElement(Orders),
    requireAuth: true,
    visible: true,
  },
  {
    name: 'Order Detail',
    path: '/orders/:id',
    element: lazyElement(OrderDetail),
    requireAuth: true,
  },
  {
    name: 'Sales Returns',
    path: '/returns',
    element: lazyElement(SalesReturns),
    requireAuth: true,
    visible: true,
  },
  {
    name: 'Create Return',
    path: '/returns/create',
    element: lazyElement(CreateReturn),
    requireAuth: true,
  },
  {
    name: 'Edit Return',
    path: '/returns/:id/edit',
    element: lazyElement(EditReturn),
    requireAuth: true,
  },
  {
    name: 'Return Detail',
    path: '/returns/:id',
    element: lazyElement(ReturnDetail),
    requireAuth: true,
  },
];

export default kassaRoutes;
