# Testing Quick Start Guide

## 🚀 Quick Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Install Playwright Browsers (for E2E tests)
```bash
npx playwright install chromium
```

### 3. Run Your First Test
```bash
npm run test
```

---

## 📋 Test Commands

| Command | Description |
|---------|-------------|
| `npm run test` | Run all tests (unit + integration) |
| `npm run test:unit` | Run only unit tests |
| `npm run test:integration` | Run only integration tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate coverage report |
| `npm run test:e2e` | Run E2E tests (Playwright) |
| `npm run test:e2e:ui` | Run E2E tests with UI |

---

## 🎯 What's Tested

### ✅ Unit Tests
- Calculation functions (VAT, totals, discounts)
- Currency formatting
- Stock calculations
- Customer balance logic
- Number generation

### ✅ Integration Tests
- Products page
- Data loading and filtering
- Stock display
- Error handling

### ✅ E2E Tests
- Complete sale cycle
- Credit sales
- Purchase orders
- Sales returns
- Hold/restore orders

---

## 📝 Writing Your First Test

### Unit Test Example
```typescript
// src/utils/__tests__/my-function.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from '../my-function';

describe('myFunction', () => {
  it('should work correctly', () => {
    expect(myFunction(5)).toBe(10);
  });
});
```

### Integration Test Example
```typescript
// src/components/__tests__/MyComponent.test.tsx
import { render, screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import MyComponent from '../MyComponent';

describe('MyComponent', () => {
  it('should render', () => {
    renderWithRouter(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

---

## 🐛 Troubleshooting

**Tests not running?**
- Check Node.js version (requires v18+)
- Run `npm install` again
- Check `vitest.config.ts` exists

**E2E tests fail?**
- Run `npx playwright install`
- Check if dev server is running (`npm run dev`)
- Check `playwright.config.ts` baseURL

**Coverage too low?**
- Focus on business logic first
- Add tests for critical functions
- Use `npm run test:coverage` to see gaps

---

## 📚 Documentation

- `TEST_STRATEGY.md` - Full test strategy
- `MANUAL_TEST_CASES.md` - Manual test cases
- `README_TESTS.md` - Detailed test documentation
- `TEST_IMPLEMENTATION_SUMMARY.md` - Implementation summary

---

## ✅ Next Steps

1. ✅ Run tests to verify setup
2. ✅ Add tests for new features
3. ✅ Expand integration tests
4. ✅ Complete E2E test setup (login, test data)
5. ✅ Set up CI/CD automation

---

**Happy Testing! 🎉**






