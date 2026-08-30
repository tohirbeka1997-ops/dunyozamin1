import { test, expect } from '@playwright/test';

/**
 * P0/P2 regression — orders return guard + suppliers a11y.
 * Run: npm run test:e2e:orders-returns
 * Set E2E_EMAIL / E2E_PASSWORD for authenticated flows.
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

test.describe('Orders return guard', () => {
  test('fully returned order shows disabled return action in list', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/orders');
    await page.waitForTimeout(800);

    const disabledReturn = page.getByRole('button', {
      name: /to['']liq qaytarilgan|fully returned|полностью возвращ/i,
    });
    const count = await disabledReturn.count();
    if (count === 0) {
      test.skip(true, 'No fully returned order in test data');
    }
    await expect(disabledReturn.first()).toBeDisabled();
  });

  test('fully returned order detail blocks new return', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/orders');
    await page.waitForTimeout(800);

    const disabledReturn = page.getByRole('button', {
      name: /to['']liq qaytarilgan|fully returned|полностью возвращ/i,
    });
    if ((await disabledReturn.count()) === 0) {
      test.skip(true, 'No fully returned order in test data');
    }

    const row = disabledReturn.first().locator('xpath=ancestor::tr[1]');
    const detailLink = row.getByRole('link').first();
    if (!(await detailLink.isVisible().catch(() => false))) {
      test.skip(true, 'Cannot open order detail from list row');
    }
    await detailLink.click();
    await expect(
      page.getByRole('button', {
        name: /to['']liq qaytarilgan|fully returned|полностью возвращ/i,
      }),
    ).toBeDisabled();
  });
});

test.describe('Suppliers accessibility', () => {
  test('edit and delete buttons expose aria-label', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/suppliers');
    await page.waitForTimeout(800);

    const editBtn = page.getByRole('button', { name: /yetkazib beruvchini tahrirlash/i }).first();
    const deleteBtn = page.getByRole('button', { name: /yetkazib beruvchini o['']chirish/i }).first();

    if (!(await editBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No supplier rows in test data');
    }

    await expect(editBtn).toHaveAttribute('title', /tahrirlash/i);
    await expect(deleteBtn).toHaveAttribute('title', /o['']chirish/i);
  });

  test('delete requires confirmation dialog', async ({ page }) => {
    const loggedIn = await loginIfNeeded(page);
    test.skip(!loggedIn, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated E2E');

    await page.goto('/suppliers');
    await page.waitForTimeout(800);

    const deleteBtn = page.getByRole('button', { name: /yetkazib beruvchini o['']chirish/i }).first();
    if (!(await deleteBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No supplier rows in test data');
    }

    const rowsBefore = await page.locator('table tbody tr').count();
    await deleteBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/o['']chirish|delete|удал/i);

    await page.getByRole('button', { name: /bekor|cancel|отмен/i }).first().click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(rowsBefore);
  });
});
