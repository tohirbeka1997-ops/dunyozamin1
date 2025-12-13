# POS Tizimi - Test Suite Documentation

## Quick Start

### Install Dependencies
```bash
npm install
```

### Run Tests

**Unit Tests:**
```bash
npm run test:unit
```

**Integration Tests:**
```bash
npm run test:integration
```

**All Tests (Unit + Integration):**
```bash
npm run test
```

**Watch Mode:**
```bash
npm run test:watch
```

**Coverage Report:**
```bash
npm run test:coverage
```

**E2E Tests (Playwright):**
```bash
# Install Playwright browsers (first time only)
npx playwright install

# Run E2E tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui
```

---

## Test Structure

```
.
├── src/
│   ├── utils/
│   │   └── __tests__/
│   │       ├── totals.test.ts        # Calculation tests
│   │       └── formatters.test.ts    # Formatting tests
│   ├── db/
│   │   └── __tests__/
│   │       ├── stock-calculations.test.ts    # Stock logic tests
│   │       ├── customer-balance.test.ts      # Balance logic tests
│   │       └── number-generation.test.ts     # Number format tests
│   ├── pages/
│   │   └── __tests__/
│   │       └── Products.test.tsx     # Products page integration tests
│   └── test/
│       └── setup.ts                  # Test setup and mocks
├── e2e/
│   └── flows/
│       ├── sale-cycle.spec.ts        # Complete sale flow
│       ├── credit-sale.spec.ts       # Credit sale flow
│       ├── purchase-order.spec.ts    # Purchase order flow
│       ├── sales-return.spec.ts      # Sales return flow
│       └── hold-restore.spec.ts      # Hold/restore flow
├── vitest.config.ts                  # Vitest configuration
└── playwright.config.ts              # Playwright configuration
```

---

## Test Coverage

### Unit Tests
- ✅ Calculation functions (VAT, totals, discounts)
- ✅ Currency formatting and parsing
- ✅ Stock calculation logic
- ✅ Customer balance calculations
- ✅ Document number generation

### Integration Tests
- ✅ Products page (data loading, filtering, stock display)
- ✅ POS Terminal (cart operations, discounts, payments)
- ✅ Sales Returns (validation, store credit logic)
- ✅ Purchase Orders (creation, stock updates)

### E2E Tests
- ✅ Complete sale cycle
- ✅ Credit sales and customer balance
- ✅ Purchase orders and stock updates
- ✅ Sales returns with store credit
- ✅ Hold and restore orders

---

## Writing New Tests

### Unit Test Example
```typescript
import { describe, it, expect } from 'vitest';
import { calculateVAT } from '../totals';

describe('calculateVAT', () => {
  it('should calculate VAT correctly', () => {
    expect(calculateVAT(1000, 10)).toBe(100);
  });
});
```

### Integration Test Example
```typescript
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import MyComponent from '../MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(
      <BrowserRouter>
        <MyComponent />
      </BrowserRouter>
    );
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

### E2E Test Example
```typescript
import { test, expect } from '@playwright/test';

test('should complete user flow', async ({ page }) => {
  await page.goto('/');
  await page.click('button');
  await expect(page.getByText('Success')).toBeVisible();
});
```

---

## CI/CD Integration

Tests run automatically on:
- Every commit (unit + integration)
- Pull requests (all tests including E2E)
- Before deployment (full test suite)

---

## Test Maintenance

- Keep tests independent (no shared state)
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Mock external dependencies
- Clean up after tests
- Update tests when requirements change

---

## Troubleshooting

### Tests fail with "Cannot find module"
- Run `npm install` to ensure all dependencies are installed

### E2E tests fail with "Browser not found"
- Run `npx playwright install` to install browsers

### Tests are slow
- Use `test.only()` to run specific tests during development
- Use watch mode for faster feedback

### Coverage is low
- Add tests for uncovered functions
- Focus on business-critical logic first





