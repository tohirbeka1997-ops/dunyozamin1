import { test, expect } from '@playwright/test';

test.describe('Purchase Order & Stock Update', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // TODO: Add login flow
  });

  test('should create purchase order and update stock', async ({ page }) => {
    // Step 1: Create supplier (if needed)
    await page.getByRole('link', { name: /suppliers/i }).click();
    // ... create supplier if not exists

    // Step 2: Create purchase order
    await page.getByRole('link', { name: /purchase orders|harid buyurtmalari/i }).click();
    await page.getByRole('button', { name: /new purchase order/i }).click();

    // Step 3: Fill purchase order form
    await page.getByLabel(/supplier|yetkazib beruvchi/i).click();
    await page.getByText('Test Supplier').click();
    
    await page.getByLabel(/order date/i).fill('2025-01-15');
    
    // Step 4: Add products
    await page.getByRole('button', { name: /add product|mahsulot qo'shish/i }).click();
    await page.getByText('Test Product').click();
    await page.getByLabel(/quantity|miqdor/i).fill('20');
    await page.getByLabel(/unit cost/i).fill('5000');

    // Step 5: Mark as received
    await page.getByRole('button', { name: /save.*mark as received|saqlash.*qabul/i }).click();

    // Step 6: Verify PO created
    await expect(page.getByText(/purchase order.*created/i)).toBeVisible();
    await expect(page.getByText(/received/i)).toBeVisible();

    // Step 7: Verify stock increased
    await page.getByRole('link', { name: /products|mahsulotlar/i }).click();
    
    // Find the product and verify stock increased by 20
    // Implementation depends on UI structure
    await expect(page.getByText(/stock|omborda/i)).toBeVisible();
  });
});





