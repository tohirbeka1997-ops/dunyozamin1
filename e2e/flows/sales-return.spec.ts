import { test, expect } from '@playwright/test';

test.describe('Sales Return with Store Credit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // TODO: Add login flow and setup test data
  });

  test('should create return with store credit and update customer balance', async ({ page }) => {
    // Precondition: Complete a sale to a customer first
    // (This would be set up in a beforeAll hook in real scenario)

    // Step 1: Navigate to Sales Returns
    await page.getByRole('link', { name: /sales returns|sotuv qaytariqlari/i }).click();
    await page.getByRole('button', { name: /new sales return/i }).click();

    // Step 2: Select order
    await page.getByLabel(/search order/i).fill('ORD-');
    await page.getByText(/order number/i).first().click();

    // Step 3: Select items to return
    await page.getByLabel(/return quantity/i).first().fill('2');
    
    // Step 4: Select refund method
    await page.getByLabel(/refund method|qaytarish usuli/i).click();
    await page.getByText(/store credit|do'kon krediti/i).click();

    // Step 5: Submit return
    await page.getByRole('button', { name: /submit return|qaytarishni yuborish/i }).click();

    // Step 6: Verify return created
    await expect(page.getByText(/return.*created/i)).toBeVisible();
    await expect(page.getByText(/completed/i)).toBeVisible();

    // Step 7: Verify customer balance decreased
    await page.getByRole('link', { name: /customers|mijozlar/i }).click();
    await page.getByText('Test Customer').click();
    
    // Verify balance decreased (implementation depends on UI)
    await expect(page.getByText(/balance|qarz/i)).toBeVisible();

    // Step 8: Verify stock increased
    await page.getByRole('link', { name: /products|mahsulotlar/i }).click();
    // Verify stock increased by return quantity
  });

  test('should prevent store credit refund for walk-in customer', async ({ page }) => {
    // Step 1: Navigate to Sales Returns
    await page.getByRole('link', { name: /sales returns/i }).click();
    await page.getByRole('button', { name: /new sales return/i }).click();

    // Step 2: Select order with walk-in customer
    await page.getByText(/walk-in customer/i).click();

    // Step 3: Try to select store credit
    await page.getByLabel(/refund method/i).click();
    await page.getByText(/store credit/i).click();

    // Step 4: Try to submit
    await page.getByRole('button', { name: /submit/i }).click();

    // Step 5: Verify error message
    await expect(page.getByText(/mijoz tanlanishi kerak/i)).toBeVisible();
  });
});





