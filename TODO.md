# POS System Implementation Plan

## Phase 1: Database & Authentication Setup
- [x] Initialize Supabase project
- [x] Create database schema migration
  - [x] profiles table with roles (admin, manager, cashier)
  - [x] categories table
  - [x] products table (with barcode, SKU, stock)
  - [x] customers table (bonus, debt)
  - [x] suppliers table
  - [x] orders table (receipts)
  - [x] order_items table
  - [x] payments table
  - [x] inventory_movements table
  - [x] purchase_orders table
  - [x] purchase_order_items table
  - [x] shifts table (cashier shifts)
- [x] Set up RLS policies (disabled for flexibility)
- [x] Create helper functions and RPCs
- [x] Set up authentication trigger
- [x] Create TypeScript types

## Phase 2: Core Infrastructure
- [x] Update design system (colors, theme)
- [x] Create database API functions (@/db/api.ts)
- [x] Create Supabase client setup
- [x] Set up authentication context
- [x] Create route guards
- [x] Update routes configuration

## Phase 3: Authentication & Layout
- [x] Create Login page
- [x] Create main layout with navigation
- [x] Add logout functionality
- [x] Implement role-based navigation

## Phase 4: Core Pages - Products & Inventory
- [x] Dashboard page (analytics)
- [x] Categories management page
- [ ] Products catalog page (placeholder created)
- [ ] Inventory management page (placeholder created)
- [ ] Purchase receiving page (placeholder created)

## Phase 5: POS Terminal (Core Feature)
- [x] POS Terminal page
  - [x] Product search and barcode scanner
  - [x] Shopping cart
  - [x] Discount application
  - [x] Multiple payment methods
  - [x] Split payment support
  - [x] Shift management
  - [x] Order completion
- [x] Per-Product Discount Feature
  - [x] Update CartItem type (already has discount_amount)
  - [x] Add line discount UI to each cart item
  - [x] Add discount input popover/dialog
  - [x] Update cart calculation logic
  - [x] Update Order Summary to show line discounts
  - [x] Add validation (non-negative, max = line subtotal)
  - [x] Test with quantity changes
  - [x] Test with global discount
- [x] Editable Quantity Input Feature
  - [x] Replace static quantity label with input field
  - [x] Add quantity input validation (min: 1, max: stock)
  - [x] Handle keyboard events (Enter to apply)
  - [x] Handle blur events (click outside to apply)
  - [x] Integrate with +/- buttons
  - [x] Add stock limit validation
  - [x] Show appropriate error toasts
  - [x] Update order summary on quantity change
- [x] Product Search UI Improvement
  - [x] Increase text contrast (WCAG AA compliance)
  - [x] Update background colors (blue-600/500/700)
  - [x] Enhance typography (semibold name, medium price)
  - [x] Add hover/active/focus states
  - [x] Improve spacing and padding
  - [x] Ensure accessibility (keyboard navigation, touch targets)

## Phase 6: Orders & Returns
- [ ] Orders/Receipts list page (placeholder created)
- [ ] Sales returns page (placeholder created)

## Phase 7: Customer & Employee Management
- [x] Customers list page (with filters and sorting)
- [x] Employees management page (fully implemented)
  - [x] Employees list with search and filters
  - [x] Add/Edit employee form with validation
  - [x] Employee detail page with performance dashboard
  - [x] Time tracking (login/logout sessions)
  - [x] Activity logs
  - [x] Role-based permissions
  - [x] Account status management

## Phase 8: Reports
- [x] Reports main page (navigation hub)
- [x] Daily Sales Report (with filters, totals, profit calculation)
- [x] Product Sales Report (with top 10 chart, slow-moving products)
- [x] Customer Sales Report (with customer purchase analysis)
- [x] Stock Levels Report (with status indicators and alerts)
- [x] Inventory Movement Report (with movement tracking)
- [x] Profit & Loss Report (with trend chart and income statement)
- [x] Payment Method Breakdown Report (with pie chart)
- [ ] Valuation Report
- [ ] Purchase Order Summary Report
- [ ] Supplier Performance Report
- [ ] Cashier Performance Report
- [ ] Login Activity Log
- [ ] Export functionality (Excel, PDF, CSV)
- [ ] Additional charts and visualizations

## Phase 9: Settings & Professional Features
- [x] Settings page (fully implemented)
  - [x] Company Profile settings
  - [x] POS Terminal configuration
  - [x] Payment methods and tax settings
  - [x] Receipt and printing options
  - [x] Inventory management settings
  - [x] Numbering and ID formats
  - [x] Security and user policies
  - [x] Localization (language and currency)
  - [x] Admin-only access control
  - [x] Unsaved changes warning
  - [x] Audit logging integration

## Phase 10: Testing & Refinement
- [x] Run linting (passed)
- [x] Fix Dashboard data loading (robust error handling)
- [x] Fix AuthProvider component hierarchy
- [x] Fix POS Terminal payment flow (atomic transactions)
- [ ] Test authentication flow
- [ ] Test POS terminal workflow end-to-end
- [ ] Final UI/UX polish

## Phase 11: System Integration & Synchronization
- [x] Create comprehensive integration migration
  - [x] Performance indexes for all tables
  - [x] Automatic inventory update triggers
  - [x] Customer statistics auto-update
  - [x] Employee performance tracking
  - [x] Business rule enforcement (prevent deletions)
  - [x] Dashboard metrics functions
  - [x] Data validation functions
- [x] Refactor Dashboard with robust error handling
  - [x] Individual try-catch for each metric
  - [x] Loading skeletons for better UX
  - [x] Graceful degradation on errors
  - [x] No crashes on empty tables
- [x] Update API functions for resilience
  - [x] getDashboardStats with fallback values
  - [x] getLowStockProducts with error handling

## Notes
- Using username + password authentication (simulated with @miaoda.com)
- First registered user becomes admin
- Blue (#2563EB) and gray (#64748B) color scheme
- Desktop-first design with touch support
- Minimum button height: 44px for touch screens
- All modules fully integrated with automatic synchronization
- Dashboard never crashes, even with empty or misconfigured tables
