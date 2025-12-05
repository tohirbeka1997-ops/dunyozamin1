# Sales Returns Module - Quick Start Guide

## Accessing the Module

Navigate to **Sales Returns** from the main navigation menu or visit `/sales-returns`

## Creating a Return

### Step-by-Step Process:

1. **Click "New Sales Return"** button on the Sales Returns list page

2. **Step 1: Select Order**
   - Search for the order by order number or customer name
   - Click "Select" on the order you want to process a return for
   - Only completed orders will appear in the list

3. **Step 2: Return Items**
   - Review the order information displayed at the top
   - For each item you want to return:
     - Enter the quantity to return in the "Return Qty" column
     - The quantity cannot exceed the sold quantity
     - Leave as 0 for items not being returned
   - Review the calculated totals at the bottom:
     - Subtotal
     - Tax
     - Total Refund Amount
   - Click "Continue" when ready

4. **Step 3: Additional Information**
   - **Select Reason** (Required):
     - Damaged Product
     - Incorrect Item
     - Defective Product
     - Customer Dissatisfaction
     - Expired Product
     - Other
   - **Select Refund Method** (Optional):
     - Cash
     - Card
     - Store Credit
     - Original Payment Method
   - **Add Notes** (Optional): Any additional information
   - Review the return summary
   - Click "Submit Return"

5. **Success!**
   - You'll be redirected to the Sales Returns list
   - The new return will appear with status "Pending"

## Viewing Return Details

1. From the Sales Returns list, click the **eye icon** in the Actions column
2. View all return information:
   - Return number, status, dates
   - Customer and cashier information
   - Reason and refund method
   - List of returned items with quantities and prices
   - Order summary showing original and net totals

## Completing a Return

1. Open the return detail page
2. Click **"Complete Return"** button (only available for Pending returns)
3. Confirm the action in the dialog
4. The return status changes to "Completed"
5. **Inventory is automatically updated** - stock increases for returned items
6. **Order status is updated** - returned amount and return status are calculated

⚠️ **Important:** Completing a return cannot be undone!

## Cancelling a Return

1. Open the return detail page
2. Click **"Cancel Return"** button (only available for Pending returns)
3. Confirm the action in the dialog
4. The return status changes to "Cancelled"
5. No inventory changes are made

## Filtering and Searching

### Search:
- Type in the search box to filter by:
  - Return number
  - Order number
  - Customer name

### Filters:
- **Date Range:** Select start and end dates
- **Customer:** Filter by specific customer
- **Status:** Filter by Pending, Completed, or Cancelled
- Click **"Apply Filters"** to search
- Click **"Reset"** to clear all filters

## Understanding Return Numbers

Return numbers follow this format: **RET-YYYYMMDD-#####**

Example: `RET-20251205-00001`
- RET: Return prefix
- 20251205: Date (December 5, 2025)
- 00001: Sequential number (resets daily)

## Status Meanings

- **Pending** (Blue): Return created but not yet processed
- **Completed** (Green): Return processed, inventory updated
- **Cancelled** (Red): Return cancelled, no inventory changes

## Integration with Other Modules

### Orders:
- View return information on order detail pages
- Create returns directly from completed orders
- Order totals reflect returned amounts

### Inventory:
- Stock automatically increases when return is completed
- Inventory movements are logged for audit trail

### Customers:
- Returns are linked to customer accounts
- Return history available in customer profiles

### Reports:
- Return data included in sales reports
- Track return rates and reasons
- Analyze financial impact

## Common Scenarios

### Scenario 1: Full Order Return
1. Create return and select the order
2. Set return quantity = sold quantity for all items
3. Select reason and submit
4. Complete the return
5. Order status becomes "Full Return"

### Scenario 2: Partial Return
1. Create return and select the order
2. Set return quantity for only some items
3. Select reason and submit
4. Complete the return
5. Order status becomes "Partial Return"

### Scenario 3: Multiple Returns on Same Order
1. Create first return with some items
2. Complete the first return
3. Create second return with remaining items
4. Complete the second return
5. Order status updates based on total returned amount

## Tips and Best Practices

1. **Always verify quantities** before submitting a return
2. **Select the correct reason** for accurate reporting
3. **Add notes** for unusual situations or special circumstances
4. **Complete returns promptly** to keep inventory accurate
5. **Review order details** before creating a return
6. **Use filters** to find specific returns quickly
7. **Check return status** before attempting to complete or cancel

## Troubleshooting

### "Cannot exceed sold quantity" error:
- Check the return quantity entered
- Verify the sold quantity in the order
- Reduce the return quantity to match or be less than sold quantity

### "No items selected" error:
- At least one item must have a return quantity > 0
- Enter quantities for items you want to return

### "Reason required" error:
- Select a reason from the dropdown in Step 3
- This field is mandatory

### Return not appearing in list:
- Check your filters (date range, status, customer)
- Click "Reset" to clear all filters
- Refresh the page

### Cannot complete return:
- Verify the return status is "Pending"
- Check that you have the necessary permissions
- Ensure the products still exist in the system

## Keyboard Shortcuts

- **Tab**: Navigate between form fields
- **Enter**: Submit forms (when focused on submit button)
- **Esc**: Close dialogs and modals

## Mobile Usage

The Sales Returns module is fully responsive and works on mobile devices:
- Touch-friendly buttons and inputs
- Responsive tables (scroll horizontally if needed)
- Optimized layout for small screens

## Need Help?

- Refer to the comprehensive **SALES_RETURNS_MODULE_GUIDE.md** for detailed information
- Check the **IMPLEMENTATION_SUMMARY.md** for technical details
- Contact your system administrator for permissions issues
- Report bugs or request features through your support channel

## Quick Reference

| Action | Location | Requirements |
|--------|----------|--------------|
| Create Return | Sales Returns → New Sales Return | Completed order |
| View Return | Sales Returns → Eye icon | Return ID |
| Complete Return | Return Detail → Complete button | Pending status |
| Cancel Return | Return Detail → Cancel button | Pending status |
| Search Returns | Sales Returns → Search box | - |
| Filter Returns | Sales Returns → Filters section | - |
| Print Return | Return Detail → Print button | Coming soon |

---

**Last Updated:** December 5, 2025
**Module Version:** 1.0.0
**Status:** Production Ready ✅
