import { test, expect } from '@playwright/test';

test.describe('Complete Sale Cycle', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app (assuming login is handled)
    await page.goto('http://localhost:5173');
    
    // TODO: Add login flow here
    // await loginAsCashier(page);
  });

  test('should complete full sale cycle and update reports', async ({ page }) => {
    // Step 1: Open shift
    await page.getByRole('button', { name: /open shift/i }).click();
    await page.getByLabel(/opening cash/i).fill('100000');
    await page.getByRole('button', { name: /confirm/i }).click();
    
    await expect(page.getByText(/shift opened/i)).toBeVisible();

    // Step 2: Add products to cart
    await page.getByText('Product Name').first().click(); // Click first product
    await expect(page.getByText(/subtotal/i)).toBeVisible();

    // Step 3: Apply discount
    await page.getByRole('button', { name: /discount/i }).click();
    await page.getByLabel(/discount amount/i).fill('1000');
    await page.getByRole('button', { name: /apply/i }).click();

    // Step 4: Process mixed payment
    await page.getByRole('button', { name: /payment|to'lov/i }).click();
    await page.getByRole('button', { name: /mixed|aralash/i }).click();
    
    // Add cash payment
    await page.getByLabel(/cash|naqd/i).fill('50000');
    // Add card payment
    await page.getByLabel(/card|karta/i).fill('50000');
    
    await page.getByRole('button', { name: /complete payment/i }).click();

    // Step 5: Verify order created
    await expect(page.getByText(/order.*completed/i)).toBeVisible();
    
    // Step 6: Navigate to Orders list
    await page.getByRole('link', { name: /orders|buyurtmalar/i }).click();
    await expect(page.getByText(/order number/i)).toBeVisible();

    // Step 7: Check Products page - stock should decrease
    await page.getByRole('link', { name: /products|mahsulotlar/i }).click();
    // Verify stock updated (implementation depends on UI)

    // Step 8: Check Daily Sales report
    await page.getByRole('link', { name: /reports|hisobotlar/i }).click();
    await page.getByRole('link', { name: /daily sales/i }).click();
    await expect(page.getByText(/total sales/i)).toBeVisible();

    // Step 9: Check Product Sales report
    await page.getByRole('link', { name: /product sales/i }).click();
    await expect(page.getByText(/product.*sales/i)).toBeVisible();

    // Step 10: Check Stock Levels report
    await page.getByRole('link', { name: /stock levels/i }).click();
    await expect(page.getByText(/stock|qoldiq/i)).toBeVisible();
  });
});






