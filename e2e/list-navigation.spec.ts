import { test, expect } from '@playwright/test';

/**
 * List state E2E — requires authenticated session.
 * Run: npm run test:e2e
 * Set E2E_EMAIL / E2E_PASSWORD env vars to enable login steps.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const hasAuth = Boolean(email && password);

async function loginIfNeeded(page: import('@playwright/test').Page) {
  if (!hasAuth) return false;
  await page.goto('/login');
  await page.getByLabel(/email|login|foydalanuvchi/i).first().fill(email!);
  await page.getByLabel(/password|parol/i).first().fill(password!);
  await page.getByRole('button', { name: /login|kirish|sign in/i }).click();
  await page.waitForURL(/\/(dashboard|pos|products)/, { timeout: 15_000 });
  return true;
}

test.describe('List navigation state', () => {
  test('products URL search param binds to input after direct navigation', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn && !hasAuth, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    if (!loggedIn) {
      await page.goto('/products?status=active&search=2188');
      test.skip(true, 'Unauthenticated — cannot reach products list');
    }

    await page.goto('/products?status=active&search=2188');
    const searchInput = page.getByRole('textbox', { name: /qidirish|search/i }).first();
    await expect(searchInput).toHaveValue('2188', { timeout: 10_000 });
  });

  test('products edit cancel preserves search in URL', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/products?status=active&search=test');
    await page.waitForTimeout(500);
    const editBtn = page.getByRole('button', { name: /tahrirlash|edit/i }).first();
    if (!(await editBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No editable product row in test data');
    }
    await editBtn.click();
    await expect(page).toHaveURL(/\/products\/.+\/edit\?.*returnTo=/);
    await page.getByRole('button', { name: /bekor|cancel/i }).first().click();
    await expect(page).toHaveURL(/search=test/);
    const searchInput = page.getByRole('textbox', { name: /qidirish|search/i }).first();
    await expect(searchInput).toHaveValue('test');
  });

  test('customers URL search param binds to input', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/customers?search=ali');
    const searchInput = page.getByRole('textbox', { name: /qidirish|search/i }).first();
    await expect(searchInput).toHaveValue('ali', { timeout: 10_000 });
  });

  test('returns list URL search param binds to input', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/returns?search=RET');
    const searchInput = page.getByRole('textbox', { name: /qidirish|search/i }).first();
    await expect(searchInput).toHaveValue('RET', { timeout: 10_000 });
  });

  test('return detail back uses returnTo when present', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/returns?search=test');
    await page.waitForTimeout(800);
    const detailLink = page.getByRole('link', { name: /qaytarish|return/i }).first();
    const viewBtn = page.getByRole('button', { name: /ko'rish|view|batafsil/i }).first();
    if (await detailLink.isVisible().catch(() => false)) {
      await detailLink.click();
    } else if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click();
    } else {
      test.skip(true, 'No return row in test data');
    }
    await expect(page).toHaveURL(/returnTo=/);
    await page.getByRole('button', { name: /qaytarishlar|orqaga|back/i }).first().click();
    await expect(page).toHaveURL(/\/returns\?.*search=test/);
  });

  test('orders URL preserves date filter key in query', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/orders?date=today');
    await expect(page).toHaveURL(/date=today/);
  });

  test('audit log report URL preserves dateFrom filter', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/reports/system/audit-log?dateFrom=2026-01-01&dateTo=2026-01-31');
    await expect(page).toHaveURL(/dateFrom=2026-01-01/);
    const dateFromInput = page.locator('input[type="date"]').first();
    await expect(dateFromInput).toHaveValue('2026-01-01', { timeout: 10_000 });
  });

  test('new customer navigation includes returnTo in URL', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/customers?search=vip');
    await page.waitForTimeout(500);
    const newBtn = page.getByRole('button', { name: /yangi|new|qo\'shish|add/i }).first();
    if (!(await newBtn.isVisible().catch(() => false))) {
      test.skip(true, 'New customer button not found');
    }
    await newBtn.click();
    await expect(page).toHaveURL(/\/customers\/new\?.*returnTo=/);
  });
});
