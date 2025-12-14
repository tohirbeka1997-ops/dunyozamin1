# POS Tizimi - Comprehensive Test Strategy

## Overview
This document outlines the testing strategy for the POS/ERP system, covering unit tests, integration tests, and end-to-end tests.

## Test Pyramid

```
        /\
       /  \
      / E2E \          - Critical user flows (5-10 tests)
     /--------\
    /          \
   / Integration \     - Component + API interactions (20-30 tests)
  /--------------\
 /                \
/    Unit Tests     \  - Pure functions & utilities (50-80 tests)
/--------------------\
```

## 1. Unit Tests (Vitest)

### Purpose
Test pure business logic functions in isolation.

### What to Test
- ✅ **Calculation functions** (`src/utils/totals.ts`, `src/utils/formatters.ts`)
  - `calculateVAT()` - VAT calculation
  - `formatCurrency()` - Currency formatting
  - `parseCurrency()` - Currency parsing
  - `validatePaymentAmounts()` - Payment validation
  - `formatUnit()` - Unit formatting

- ✅ **Stock calculation** (`src/db/api.ts`)
  - `calculateProductStockFromMovements()` - Stock from movements
  - Stock update logic (decrease on sale, increase on purchase/return)

- ✅ **Customer balance logic** (`src/db/api.ts`)
  - Credit sale increases balance
  - Store credit refund decreases balance
  - Balance calculation correctness

- ✅ **Document number generation** (`src/db/api.ts`)
  - Order numbers (ORD-YYYYMMDD-XXXXXX)
  - Return numbers (RET-YYYYMMDD-XXXXXX)
  - Purchase order numbers (PO-XXXXXX)
  - Movement numbers (MOV-XXXXXX)

- ✅ **Cart calculations** (logic extracted from POSTerminal)
  - Subtotal calculation
  - Line-level discount calculation
  - Global discount (amount & percentage)
  - Total calculation

- ✅ **Form validation logic**
  - Product form validation
  - Purchase order validation
  - Customer form validation

### Test Location
- `src/utils/__tests__/totals.test.ts`
- `src/utils/__tests__/formatters.test.ts`
- `src/db/__tests__/stock-calculations.test.ts`
- `src/db/__tests__/customer-balance.test.ts`
- `src/db/__tests__/number-generation.test.ts`

### Coverage Goal
80%+ for pure utility functions, 70%+ for business logic functions.

---

## 2. Integration Tests (React Testing Library + MSW)

### Purpose
Test React components with mocked API calls to ensure correct data flow and UI updates.

### What to Test

#### ✅ Products Page (`src/pages/Products.tsx`)
- Data loading and rendering
- Filter functionality (search, category, status, stock)
- Stock display shows calculated values
- Delete product flow
- Error handling (API failures)

#### ✅ POS Terminal (`src/pages/POSTerminal.tsx`)
- Add product to cart
- Update quantity
- Apply discounts (line-level & global)
- Calculate totals correctly
- Payment validation
- Empty cart validation
- Stock validation before sale

#### ✅ Sales Returns (`src/pages/CreateReturn.tsx`)
- Select order
- Select items to return
- Calculate return amounts
- Validate "Do'kon krediti" requires customer
- Store credit refund decreases customer balance
- Return status is "Completed" immediately

#### ✅ Purchase Orders (`src/pages/PurchaseOrderForm.tsx`)
- Create purchase order
- Mark as received updates stock
- Stock increases correctly
- Form validation

#### ✅ Reports
- Navigation to correct report pages
- Date filters work
- Data renders correctly
- Export functionality

#### ✅ Settings (`src/pages/Settings.tsx`)
- All tabs render correctly
- Form submission
- Validation errors
- Settings persistence

### Test Location
- `src/pages/__tests__/Products.test.tsx`
- `src/pages/__tests__/POSTerminal.test.tsx`
- `src/pages/__tests__/CreateReturn.test.tsx`
- `src/pages/__tests__/PurchaseOrderForm.test.tsx`
- `src/components/__tests__/CartList.test.tsx`

### Mocking Strategy
- Use MSW (Mock Service Worker) to intercept API calls
- Mock Supabase responses
- Test error scenarios (network failures, validation errors)

### Coverage Goal
60-70% for critical pages/components.

---

## 3. End-to-End Tests (Playwright)

### Purpose
Test complete user workflows from start to finish in a browser environment.

### Critical Flows to Test

#### ✅ Flow 1: Complete Sale Cycle
1. Login as cashier
2. Open shift
3. Add products to cart
4. Apply discount
5. Process mixed payment (cash + card)
6. Complete sale
7. Verify:
   - Order created in Orders list
   - Stock decreased in Products page
   - Daily Sales report updated
   - Product Sales report updated
   - Stock Levels report updated

#### ✅ Flow 2: Credit Sale & Customer Balance
1. Create customer
2. Open shift
3. Add products to cart
4. Select customer
5. Process credit sale (full or partial)
6. Verify:
   - Customer balance increased
   - Order created with credit payment
   - Customer detail page shows correct balance

#### ✅ Flow 3: Purchase Order & Stock Update
1. Create supplier
2. Create purchase order
3. Add products to PO
4. Click "Save & Mark as Received"
5. Verify:
   - PO status is "received"
   - Product stock increased in Products page
   - Inventory movement created

#### ✅ Flow 4: Sales Return with Store Credit
1. Complete a sale to a customer
2. Navigate to Sales Returns
3. Create return for the order
4. Select items to return
5. Select "Do'kon krediti" refund method
6. Submit return
7. Verify:
   - Return status is "Completed"
   - Customer balance decreased
   - Product stock increased
   - Return appears in Sales Returns list

#### ✅ Flow 5: Hold & Restore Order
1. Open shift
2. Add products to cart
3. Click "Hold Order"
4. Navigate to "Waiting Orders"
5. Restore the held order
6. Complete sale
7. Verify:
   - Order completed successfully
   - Cart restored correctly

#### ✅ Flow 6: Reports Navigation
1. Navigate to Reports page
2. Click each report tile
3. Verify:
   - Correct page loads
   - Data renders
   - Filters work

### Test Location
- `e2e/flows/sale-cycle.spec.ts`
- `e2e/flows/credit-sale.spec.ts`
- `e2e/flows/purchase-order.spec.ts`
- `e2e/flows/sales-return.spec.ts`
- `e2e/flows/hold-restore.spec.ts`
- `e2e/flows/reports.spec.ts`

### Test Data Strategy
- Use isolated test database or test fixtures
- Clean up test data after each test
- Use unique identifiers to avoid conflicts

### Coverage Goal
100% of critical business flows.

---

## 4. Risk Areas & Priority

### 🔴 Critical (Test First)
1. **Stock Synchronization**
   - Stock updates correctly on sales, purchases, returns
   - Products page shows accurate stock
   - Stock calculations from movements

2. **Customer Balance**
   - Credit sales increase balance correctly
   - Store credit refunds decrease balance correctly
   - Balance persists across sessions

3. **Payment Processing**
   - Payment validation (amounts match total)
   - Mixed payments calculate correctly
   - Change calculation for cash payments

4. **Order Creation**
   - Order created with all items
   - Payments recorded correctly
   - Order status transitions correctly

### 🟡 High Priority
5. **Data Integrity**
   - Inventory movements created for all stock changes
   - Reports calculate correctly
   - Filters work as expected

6. **Form Validation**
   - Required fields enforced
   - Invalid data rejected
   - User-friendly error messages

### 🟢 Medium Priority
7. **UI/UX**
   - Navigation works correctly
   - Modals open/close properly
   - Loading states display
   - Error messages show

8. **Settings**
   - Settings persist correctly
   - All tabs functional
   - Validation works

---

## 5. Test Infrastructure

### Tools
- **Unit Tests**: Vitest
- **Integration Tests**: React Testing Library + MSW
- **E2E Tests**: Playwright
- **Coverage**: Vitest coverage reporter

### Setup Files
- `vitest.config.ts` - Vitest configuration
- `playwright.config.ts` - Playwright configuration
- `src/test/setup.ts` - Test setup (MSW, mocks)
- `.github/workflows/tests.yml` - CI/CD test runner

### Test Database
- Use separate test database for E2E tests
- Reset database between test runs
- Seed test data fixtures

---

## 6. Test Execution

### Local Development
```bash
# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Run all tests
npm run test
```

### CI/CD
- Run unit and integration tests on every commit
- Run E2E tests on pull requests
- Fail build if tests fail

---

## 7. Test Maintenance

### Best Practices
- Keep tests independent (no shared state)
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Mock external dependencies
- Clean up after tests
- Update tests when requirements change

### Test Review Checklist
- ✅ Tests cover happy path
- ✅ Tests cover error cases
- ✅ Tests are deterministic (no flakiness)
- ✅ Tests are fast (< 5s for unit, < 30s for integration, < 2min for E2E)
- ✅ Tests use stable selectors (data-testid)
- ✅ Tests are well-documented

---

## 8. Metrics & Reporting

### Coverage Targets
- Unit tests: 80%+ coverage
- Integration tests: 60-70% coverage
- E2E tests: 100% of critical flows

### Reporting
- Coverage reports generated on CI
- Test results published to CI dashboard
- Failed tests reported in PR comments

---

## Summary

This test strategy ensures:
1. ✅ Business logic is thoroughly tested at unit level
2. ✅ Components work correctly with mocked APIs
3. ✅ Critical user flows work end-to-end
4. ✅ Stock and balance calculations are reliable
5. ✅ Data integrity is maintained
6. ✅ User experience is validated

Next steps:
1. Set up test infrastructure (Vitest, Playwright, MSW)
2. Write unit tests for calculation functions
3. Write integration tests for key pages
4. Write E2E tests for critical flows
5. Set up CI/CD test automation






