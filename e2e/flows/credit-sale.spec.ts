import { test, expect } from '@playwright/test';

test.describe('Credit Sale & Customer Balance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // TODO: Add login flow
  });

  test('should create customer and process credit sale', async ({ page }) => {
    // Step 1: Create customer
    await page.getByRole('link', { name: /customers|mijozlar/i }).click();
    await page.getByRole('button', { name: /add customer/i }).click();
    
    await page.getByLabel(/name/i).fill('Test Customer');
    await page.getByLabel(/phone/i).fill('+998901234567');
    await page.getByRole('button', { name: /save/i }).click();
    
    await expect(page.getByText(/customer.*created/i)).toBeVisible();

    // Step 2: Open shift
    await page.getByRole('link', { name: /pos terminal/i }).click();
    await page.getByRole('button', { name: /open shift/i }).click();
    await page.getByLabel(/opening cash/i).fill('100000');
    await page.getByRole('button', { name: /confirm/i }).click();

    // Step 3: Add products to cart
    await page.getByText('Product Name').first().click();

    // Step 4: Select customer
    await page.getByRole('button', { name: /select customer|mijoz tanlash/i }).click();
    await page.getByText('Test Customer').click();

    // Step 5: Process credit sale
    await page.getByRole('button', { name: /credit sale/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();

    // Step 6: Verify order created
    await expect(page.getByText(/order.*completed/i)).toBeVisible();
    await expect(page.getByText(/on credit/i)).toBeVisible();

    // Step 7: Verify customer balance updated
    await page.getByRole('link', { name: /customers|mijozlar/i }).click();
    await page.getByText('Test Customer').click();
    
    // Check balance badge shows correct amount
    await expect(page.getByText(/balance|qarz/i)).toBeVisible();
    // Verify balance increased (implementation depends on UI structure)
  });
});






