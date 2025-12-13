import { test, expect } from '@playwright/test';

test.describe('Hold & Restore Order', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // TODO: Add login flow
  });

  test('should hold order and restore it', async ({ page }) => {
    // Step 1: Open shift
    await page.getByRole('link', { name: /pos terminal/i }).click();
    await page.getByRole('button', { name: /open shift/i }).click();
    await page.getByLabel(/opening cash/i).fill('100000');
    await page.getByRole('button', { name: /confirm/i }).click();

    // Step 2: Add products to cart
    await page.getByText('Product 1').click();
    await page.getByText('Product 2').click();
    
    // Update quantities
    await page.getByLabel(/quantity/i).first().fill('5');
    await page.getByLabel(/quantity/i).nth(1).fill('3');

    // Step 3: Hold order
    await page.getByRole('button', { name: /hold order|buyurtmani saqlash/i }).click();
    await page.getByLabel(/order name/i).fill('Test Hold Order');
    await page.getByRole('button', { name: /save/i }).click();

    // Step 4: Verify order held
    await expect(page.getByText(/order.*held/i)).toBeVisible();
    await expect(page.getByText(/cart.*empty/i)).toBeVisible();

    // Step 5: Open Waiting Orders
    await page.getByRole('button', { name: /waiting orders/i }).click();

    // Step 6: Verify held order appears
    await expect(page.getByText('Test Hold Order')).toBeVisible();

    // Step 7: Restore order
    await page.getByRole('button', { name: /restore|continue/i }).click();

    // Step 8: Verify cart restored
    await expect(page.getByText('Product 1')).toBeVisible();
    await expect(page.getByText('Product 2')).toBeVisible();
    
    // Verify quantities restored
    const quantityInputs = page.getByLabel(/quantity/i);
    await expect(quantityInputs.first()).toHaveValue('5');
    await expect(quantityInputs.nth(1)).toHaveValue('3');

    // Step 9: Complete sale
    await page.getByRole('button', { name: /payment/i }).click();
    await page.getByRole('button', { name: /cash/i }).click();
    await page.getByLabel(/cash received/i).fill('100000');
    await page.getByRole('button', { name: /complete/i }).click();

    // Step 10: Verify order completed
    await expect(page.getByText(/order.*completed/i)).toBeVisible();
  });
});





