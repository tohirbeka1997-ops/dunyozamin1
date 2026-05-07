import { lazy, Suspense, type ReactNode, type ComponentType } from 'react';

// Hot-path routes that the cashier hits within the first few seconds of
// every session — keep eager so cold start has no chunk fetch.
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
import SalesReturns from './pages/SalesReturns';
import CreateReturn from './pages/CreateReturn';
import EditReturn from './pages/EditReturn';
import ReturnDetail from './pages/ReturnDetail';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import ResetPassword from './pages/ResetPassword';

// Cold-path routes — split into separate chunks so the initial bundle
// stays small. Reports, admin, barcode tooling, and supplier/inventory
// management are accessed rarely (and never in cashier mode), so paying
// a one-time chunk fetch when the user opens them is a clear win.
const CourierOrders = lazy(() => import('./pages/CourierOrders'));
const Inventory = lazy(() => import('./pages/Inventory'));
const InventoryDetail = lazy(() => import('./pages/InventoryDetail'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const PurchaseOrderForm = lazy(() => import('./pages/PurchaseOrderForm'));
const PurchaseOrderDetail = lazy(() => import('./pages/PurchaseOrderDetail'));
const PurchaseReceiptForm = lazy(() => import('./pages/PurchaseReceiptForm'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const SupplierForm = lazy(() => import('./pages/SupplierForm'));
const SupplierDetail = lazy(() => import('./pages/SupplierDetail'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Quotes = lazy(() => import('./pages/Quotes'));
const QuoteForm = lazy(() => import('./pages/QuoteForm'));
const QuoteDetail = lazy(() => import('./pages/QuoteDetail'));
const Promotions = lazy(() => import('./pages/Promotions'));
const PromotionForm = lazy(() => import('./pages/PromotionForm'));
const PromotionDetail = lazy(() => import('./pages/PromotionDetail'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeForm = lazy(() => import('./pages/employees/EmployeeForm'));
const EmployeeDetail = lazy(() => import('./pages/employees/EmployeeDetail'));
const MasterLogin = lazy(() => import('./pages/admin/MasterLogin'));
const StoresAdmin = lazy(() => import('./pages/admin/Stores'));

// Reports — by far the largest and least-used chunk in the app.
const DailySalesReport = lazy(() => import('./pages/reports/sales/DailySalesReport'));
const ProductSalesReport = lazy(() => import('./pages/reports/sales/ProductSalesReport'));
const CustomerSalesReport = lazy(() => import('./pages/reports/sales/CustomerSalesReport'));
const PromotionReport = lazy(() => import('./pages/reports/sales/PromotionReport'));
const StockLevelsReport = lazy(() => import('./pages/reports/inventory/StockLevelsReport'));
const InventoryMovementReport = lazy(() => import('./pages/reports/inventory/InventoryMovementReport'));
const ValuationReport = lazy(() => import('./pages/reports/inventory/ValuationReport'));
const InventoryAdvancedReport = lazy(() => import('./pages/reports/inventory/InventoryAdvancedReport'));
const ProductTraceabilityReport = lazy(() => import('./pages/reports/inventory/ProductTraceabilityReport'));
const StockHealthReport = lazy(() => import('./pages/reports/inventory/StockHealthReport'));
const PurchasePlanningReport = lazy(() => import('./pages/reports/inventory/PurchasePlanningReport'));
const ActSverkaReport = lazy(() => import('./pages/reports/act-sverka/ActSverkaReport'));
const ProductActSverkaReport = lazy(() => import('./pages/reports/inventory/ProductActSverkaReport'));
const OverallSummaryReport = lazy(() => import('./pages/reports/financial/OverallSummaryReport'));
const ProfitLossReport = lazy(() => import('./pages/reports/financial/ProfitLossReport'));
const PaymentMethodReport = lazy(() => import('./pages/reports/financial/PaymentMethodReport'));
const CashFlowReport = lazy(() => import('./pages/reports/financial/CashFlowReport'));
const CashDiscrepancyReport = lazy(() => import('./pages/reports/financial/CashDiscrepancyReport'));
const AgingReport = lazy(() => import('./pages/reports/financial/AgingReport'));
const VIPCustomersReport = lazy(() => import('./pages/reports/customer/VIPCustomersReport'));
const LoyaltyPointsReport = lazy(() => import('./pages/reports/customer/LoyaltyPointsReport'));
const LostCustomersReport = lazy(() => import('./pages/reports/customer/LostCustomersReport'));
const CustomerProfitabilityReport = lazy(() => import('./pages/reports/customer/CustomerProfitabilityReport'));
const CustomerActSverkaReport = lazy(() => import('./pages/reports/customer/CustomerActSverkaReport'));
const SupplierActSverkaReport = lazy(() => import('./pages/reports/supplier/SupplierActSverkaReport'));
const DeliveryAccuracyReport = lazy(() => import('./pages/reports/supplier/DeliveryAccuracyReport'));
const PriceHistoryReport = lazy(() => import('./pages/reports/supplier/PriceHistoryReport'));
const SupplierProductSalesReport = lazy(() => import('./pages/reports/supplier/SupplierProductSalesReport'));
const PurchaseSaleSpreadReport = lazy(() => import('./pages/reports/supplier/PurchaseSaleSpreadReport'));
const PurchaseVsSoldReport = lazy(() => import('./pages/reports/supplier/PurchaseVsSoldReport'));
const CashierPerformanceReport = lazy(() => import('./pages/reports/employee/CashierPerformanceReport'));
const CashierErrorsReport = lazy(() => import('./pages/reports/employee/CashierErrorsReport'));
const ShiftProductivityReport = lazy(() => import('./pages/reports/employee/ShiftProductivityReport'));
const FraudSignalsReport = lazy(() => import('./pages/reports/employee/FraudSignalsReport'));
const DeviceHealthReport = lazy(() => import('./pages/reports/system/DeviceHealthReport'));
const AuditLogReport = lazy(() => import('./pages/reports/system/AuditLogReport'));
const PriceChangeHistoryReport = lazy(() => import('./pages/reports/system/PriceChangeHistoryReport'));
const ExecutiveDashboard = lazy(() => import('./pages/reports/executive/ExecutiveDashboard'));
const LoginActivityReport = lazy(() => import('./pages/reports/employee/LoginActivityReport'));
const PurchaseOrderSummaryReport = lazy(() => import('./pages/reports/purchase/PurchaseOrderSummaryReport'));
const SupplierPerformanceReport = lazy(() => import('./pages/reports/purchase/SupplierPerformanceReport'));
const ExportManager = lazy(() => import('./pages/reports/export/ExportManager'));
const SalesReportsHub = lazy(() => import('./pages/reports/hubs/SalesReportsHub'));
const FinancialReportsHub = lazy(() => import('./pages/reports/hubs/FinancialReportsHub'));
const InventoryReportsHub = lazy(() => import('./pages/reports/hubs/InventoryReportsHub'));
const PurchaseSupplierReportsHub = lazy(() => import('./pages/reports/hubs/PurchaseSupplierReportsHub'));
const CrmReportsHub = lazy(() => import('./pages/reports/hubs/CrmReportsHub'));
const EmployeeControlReportsHub = lazy(() => import('./pages/reports/hubs/EmployeeControlReportsHub'));
const TechAuditReportsHub = lazy(() => import('./pages/reports/hubs/TechAuditReportsHub'));

// Barcode/receipt designer tooling — opened a few times a year by an
// admin. Always worth splitting.
const ReceiptBarcodePage = lazy(() => import('./pages/tools/ReceiptBarcodePage'));
const BarcodeDesignerPage = lazy(() => import('./pages/tools/BarcodeDesignerPage'));
const BarcodeCenterPage = lazy(() => import('./pages/barcodes/BarcodeCenterPage'));
const ReceiptDesignerPage = lazy(() => import('./pages/barcodes/ReceiptDesignerPage'));
const ProductBarcodeServicePage = lazy(() => import('./pages/barcodes/ProductBarcodeServicePage'));
const ScaleBarcodeServicePage = lazy(() => import('./pages/barcodes/ScaleBarcodeServicePage'));
const ShelfLabelServicePage = lazy(() => import('./pages/barcodes/ShelfLabelServicePage'));

/**
 * Wraps a lazily-loaded page in a minimal Suspense fallback. The fallback
 * deliberately matches the styling of `ProtectedRoute`'s "loading"
 * screen so the in-app navigation feels seamless.
 */
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
    element: lazyElement(MasterLogin),
    visible: false,
    requireAuth: false,
  },
  {
    name: 'Stores Admin',
    path: '/admin/stores',
    element: lazyElement(StoresAdmin),
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
    element: lazyElement(Promotions),
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Promotion',
    path: '/promotions/new',
    element: lazyElement(PromotionForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Promotion Detail',
    path: '/promotions/:id',
    element: lazyElement(PromotionDetail),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Edit Promotion',
    path: '/promotions/:id/edit',
    element: lazyElement(PromotionForm),
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
    name: 'Courier',
    path: '/courier',
    element: lazyElement(CourierOrders),
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
    element: lazyElement(Expenses),
    visible: true,
    requireAuth: true,
  },
  {
    name: 'Smeta',
    path: '/quotes',
    element: lazyElement(Quotes),
    visible: true,
    requireAuth: true,
  },
  {
    name: 'New Quote',
    path: '/quotes/new',
    element: lazyElement(QuoteForm),
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Quote Detail',
    path: '/quotes/:id',
    element: lazyElement(QuoteDetail),
    visible: false,
    requireAuth: true,
  },
  {
    name: 'Edit Quote',
    path: '/quotes/:id/edit',
    element: lazyElement(QuoteForm),
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
    element: lazyElement(Inventory),
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Inventory Detail',
    path: '/inventory/:id',
    element: lazyElement(InventoryDetail),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Purchase Orders',
    path: '/purchase-orders',
    element: lazyElement(PurchaseOrders),
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Purchase Order',
    path: '/purchase-orders/new',
    element: lazyElement(PurchaseOrderForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Edit Purchase Order',
    path: '/purchase-orders/:id/edit',
    element: lazyElement(PurchaseOrderForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Purchase Order Detail',
    path: '/purchase-orders/:id',
    element: lazyElement(PurchaseOrderDetail),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Purchase Receipt',
    path: '/purchase-orders/:id/receive',
    element: lazyElement(PurchaseReceiptForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Purchase Receipt',
    path: '/purchase-receipts/new',
    element: lazyElement(PurchaseReceiptForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Suppliers',
    path: '/suppliers',
    element: lazyElement(Suppliers),
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'New Supplier',
    path: '/suppliers/new',
    element: lazyElement(SupplierForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Edit Supplier',
    path: '/suppliers/:id/edit',
    element: lazyElement(SupplierForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Supplier Detail',
    path: '/suppliers/:id',
    element: lazyElement(SupplierDetail),
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
    element: lazyElement(SalesReportsHub),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Moliyaviy hisobotlar',
    path: '/reports/financial',
    element: lazyElement(FinancialReportsHub),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor hisobotlari',
    path: '/reports/inventory',
    element: lazyElement(InventoryReportsHub),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xarid va yetkazib beruvchi',
    path: '/reports/purchase',
    element: lazyElement(PurchaseSupplierReportsHub),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mijozlar (CRM)',
    path: '/reports/customer',
    element: lazyElement(CrmReportsHub),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xodimlar va nazorat',
    path: '/reports/employee',
    element: lazyElement(EmployeeControlReportsHub),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Texnik va audit',
    path: '/reports/system',
    element: lazyElement(TechAuditReportsHub),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Boshqaruv dashboard',
    path: '/reports/executive/dashboard',
    element: lazyElement(ExecutiveDashboard),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Kunlik savdo',
    path: '/reports/sales/daily',
    element: lazyElement(DailySalesReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mahsulotlar bo‘yicha savdo',
    path: '/reports/sales/products',
    element: lazyElement(ProductSalesReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Aksiyalar hisoboti',
    path: '/reports/sales/promotions',
    element: lazyElement(PromotionReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor qoldiqlari',
    path: '/reports/inventory/stock-levels',
    element: lazyElement(StockLevelsReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Bozorga borish hisoboti',
    path: '/reports/inventory/purchase-planning',
    element: lazyElement(PurchasePlanningReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Moliyaviy akt sverka (umumiy hisob-kitob)',
    path: '/reports/financial/business-summary',
    element: lazyElement(OverallSummaryReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Foyda va zarar (P&L)',
    path: '/reports/financial/profit-loss',
    element: lazyElement(ProfitLossReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mijozlar bo‘yicha savdo',
    path: '/reports/sales/customers',
    element: lazyElement(CustomerSalesReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor harakatlari',
    path: '/reports/inventory/movements',
    element: lazyElement(InventoryMovementReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mahsulot tarixi (Traceability)',
    path: '/reports/inventory/traceability',
    element: lazyElement(ProductTraceabilityReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  // FIXED: Valuation Report route - handles '/reports/inventory/valuation' path
  // This route must be defined before any catch-all routes in App.tsx
  {
    name: 'Ombor qiymati',
    path: '/reports/inventory/valuation',
    element: lazyElement(ValuationReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yaxshi sotuv & muzlagan mahsulotlar',
    path: '/reports/inventory/stock-health',
    element: lazyElement(StockHealthReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Ombor tahlili (kengaytirilgan)',
    path: '/reports/inventory/advanced',
    element: lazyElement(InventoryAdvancedReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: "Mahsulot bo‘yicha akt sverka (davr)",
    path: '/reports/inventory/product-act-sverka',
    element: lazyElement(ProductActSverkaReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Akt sverka (FIFO partiya, barcha davr)',
    path: '/reports/act-sverka',
    element: lazyElement(ActSverkaReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: "To‘lov usullari bo‘yicha",
    path: '/reports/financial/payment-methods',
    element: lazyElement(PaymentMethodReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Pul oqimi',
    path: '/reports/financial/cash-flow',
    element: lazyElement(CashFlowReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kassa tafovuti',
    path: '/reports/financial/cash-discrepancies',
    element: lazyElement(CashDiscrepancyReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Qarzdorlik (Aging)',
    path: '/reports/financial/aging',
    element: lazyElement(AgingReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'VIP mijozlar',
    path: '/reports/customer/vip',
    element: lazyElement(VIPCustomersReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Bonus ball hisoboti',
    path: '/reports/customer/loyalty',
    element: lazyElement(LoyaltyPointsReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yo‘qolgan mijozlar',
    path: '/reports/customer/lost',
    element: lazyElement(LostCustomersReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Mijoz rentabelligi',
    path: '/reports/customer/profitability',
    element: lazyElement(CustomerProfitabilityReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Akt sverka (mijoz)',
    path: '/reports/customer/act-sverka',
    element: lazyElement(CustomerActSverkaReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Akt sverka (yetkazib beruvchi)',
    path: '/reports/supplier/act-sverka',
    element: lazyElement(SupplierActSverkaReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kassir samaradorligi',
    path: '/reports/employee/cashier',
    element: lazyElement(CashierPerformanceReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kirishlar tarixi',
    path: '/reports/employee/activity',
    element: lazyElement(LoginActivityReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Kassir xatolari',
    path: '/reports/employee/errors',
    element: lazyElement(CashierErrorsReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Smena unumdorligi',
    path: '/reports/employee/shift-productivity',
    element: lazyElement(ShiftProductivityReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Firibgarlik signallari',
    path: '/reports/employee/fraud-signals',
    element: lazyElement(FraudSignalsReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xaridlar xulosasi',
    path: '/reports/purchase/summary',
    element: lazyElement(PurchaseOrderSummaryReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yetkazib beruvchi samaradorligi',
    path: '/reports/purchase/suppliers',
    element: lazyElement(SupplierPerformanceReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yetkazib berish aniqligi',
    path: '/reports/supplier/delivery-accuracy',
    element: lazyElement(DeliveryAccuracyReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Narxlar tarixi',
    path: '/reports/supplier/price-history',
    element: lazyElement(PriceHistoryReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Yetkazib beruvchi → mahsulot sotuvlari',
    path: '/reports/supplier/product-sales',
    element: lazyElement(SupplierProductSalesReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Xarid–sotuv farqi',
    path: '/reports/supplier/purchase-sale-spread',
    element: lazyElement(PurchaseSaleSpreadReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Sotib oldim / Sotdim',
    path: '/reports/supplier/purchase-vs-sold',
    element: lazyElement(PurchaseVsSoldReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Eksport',
    path: '/reports/export',
    element: lazyElement(ExportManager),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Qurilma holati',
    path: '/reports/system/device-health',
    element: lazyElement(DeviceHealthReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Audit log',
    path: '/reports/system/audit-log',
    element: lazyElement(AuditLogReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Narx o‘zgarish tarixi',
    path: '/reports/system/price-history',
    element: lazyElement(PriceChangeHistoryReport),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Employees',
    path: '/employees',
    element: lazyElement(Employees),
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Add Employee',
    path: '/employees/new',
    element: lazyElement(EmployeeForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Edit Employee',
    path: '/employees/:id/edit',
    element: lazyElement(EmployeeForm),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Employee Detail',
    path: '/employees/:id',
    element: lazyElement(EmployeeDetail),
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
    /** Manager ham kassa/korxona sozlamalariga kirishi kerak; maxsus xavfli bo‘limlar Settings.tsx ichida faqat admin uchun */
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Barcode Center',
    path: '/barcodes',
    element: lazyElement(BarcodeCenterPage),
    visible: true,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Receipt Designer',
    path: '/barcodes/receipt-designer',
    element: lazyElement(ReceiptDesignerPage),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin'],
  },
  {
    name: 'Product Barcode Service',
    path: '/barcodes/product',
    element: lazyElement(ProductBarcodeServicePage),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Scale Barcode Service',
    path: '/barcodes/scale',
    element: lazyElement(ScaleBarcodeServicePage),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Shelf Label Service',
    path: '/barcodes/shelf-label',
    element: lazyElement(ShelfLabelServicePage),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Receipt & Barcode Tools',
    path: '/tools/receipt-barcode',
    element: lazyElement(ReceiptBarcodePage),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
  {
    name: 'Barcode Designer',
    path: '/tools/barcode-designer',
    element: lazyElement(BarcodeDesignerPage),
    visible: false,
    requireAuth: true,
    allowedRoles: ['admin', 'manager'],
  },
];

export default routes;
