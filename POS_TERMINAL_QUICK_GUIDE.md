# POS Terminal - Quick Reference Guide

## Getting Started

### 1. Open a Shift
Before processing any orders, you must open a shift:
1. When you first access the POS Terminal, a dialog will appear
2. Enter the opening cash amount (e.g., 100,000 UZS)
3. Click "Open Shift"
4. Your shift is now active and you can start processing orders

### 2. Add Products to Cart
**Method 1: Search by Name**
1. Type product name in the search box
2. Click on the product from search results
3. Product is added to cart with quantity 1

**Method 2: Barcode Scanner**
1. Focus on the search box
2. Scan the product barcode
3. Press Enter
4. Product is automatically added to cart

**Method 3: Browse by Category**
1. Click on a category button
2. Select product from the category
3. Product is added to cart

### 3. Manage Cart Items
**Increase Quantity**:
- Click the "+" button next to the product

**Decrease Quantity**:
- Click the "-" button next to the product

**Remove Item**:
- Click the trash icon
- Or decrease quantity to 0

**View Cart Summary**:
- Subtotal: Sum of all items
- Discount: Applied discount (if any)
- Total: Final amount to pay

### 4. Select Customer (Optional)
1. Click the "Select Customer" dropdown
2. Choose a customer from the list
3. Or select "Walk-in Customer" for anonymous sales

### 5. Apply Discount (Optional)
**Amount Discount**:
1. Select "Amount" from discount type
2. Enter discount amount (e.g., 5,000 UZS)
3. Total is automatically updated

**Percentage Discount**:
1. Select "Percent" from discount type
2. Enter discount percentage (e.g., 10%)
3. Total is automatically updated

---

## Processing Payments

### Cash Payment
1. Click "Process Payment" button
2. Select "Cash" tab
3. Enter the cash received amount
4. System shows change amount:
   - **Green**: Sufficient cash (change is positive)
   - **Red**: Insufficient cash (change is negative)
5. "Complete Payment" button is enabled when cash >= total
6. Click "Complete Payment"
7. Success message shows order number and change amount
8. Cart is automatically cleared

**Example**:
```
Total: 50,000 UZS
Cash Received: 100,000 UZS
Change: 50,000 UZS ✅
```

### Card Payment
1. Click "Process Payment" button
2. Select "Card" tab
3. System shows exact amount to charge
4. Click "Process Card Payment"
5. Success message shows order number
6. Cart is automatically cleared

**Example**:
```
Total: 75,000 UZS
Card Payment: 75,000 UZS
Change: 0 UZS
```

### QR Payment
1. Click "Process Payment" button
2. Select "QR Pay" tab
3. System shows exact amount to charge
4. Click "Process QR Payment"
5. Success message shows order number
6. Cart is automatically cleared

**Example**:
```
Total: 60,000 UZS
QR Payment: 60,000 UZS
Change: 0 UZS
```

### Mixed Payment
1. Click "Process Payment" button
2. Select "Mixed" tab
3. System shows:
   - Total amount
   - Paid amount (starts at 0)
   - Remaining amount
4. Add payment methods:
   - Click "Add Cash" to add cash payment
   - Click "Add Card" to add card payment
   - Each payment defaults to half of remaining amount
5. View added payments in the list
6. Remove a payment by clicking the trash icon
7. "Complete Payment" button is enabled when remaining = 0
8. Click "Complete Payment"
9. Success message shows order number and change (if any)
10. Cart is automatically cleared

**Example**:
```
Total: 100,000 UZS

Payments:
  - Cash: 50,000 UZS
  - Card: 50,000 UZS

Total Paid: 100,000 UZS
Remaining: 0 UZS ✅
Change: 0 UZS
```

**Example with Overpayment**:
```
Total: 100,000 UZS

Payments:
  - Cash: 60,000 UZS
  - Card: 50,000 UZS

Total Paid: 110,000 UZS
Remaining: 0 UZS ✅
Change: 10,000 UZS
```

---

## Common Scenarios

### Scenario 1: Quick Cash Sale
1. Scan product barcode (or search and add)
2. Click "Process Payment"
3. Enter cash received
4. Click "Complete Payment"
5. Give change to customer
6. Done! ✅

**Time**: ~10 seconds

### Scenario 2: Multiple Items with Card
1. Add multiple products to cart
2. Adjust quantities as needed
3. Click "Process Payment"
4. Select "Card" tab
5. Click "Process Card Payment"
6. Done! ✅

**Time**: ~20 seconds

### Scenario 3: Customer with Discount
1. Select customer from dropdown
2. Add products to cart
3. Apply discount (e.g., 10% loyalty discount)
4. Click "Process Payment"
5. Choose payment method
6. Complete payment
7. Done! ✅

**Time**: ~30 seconds

### Scenario 4: Split Payment (Cash + Card)
1. Add products to cart (Total: 200,000 UZS)
2. Click "Process Payment"
3. Select "Mixed" tab
4. Click "Add Cash" (adds 100,000 UZS)
5. Click "Add Card" (adds 100,000 UZS)
6. Verify remaining = 0
7. Click "Complete Payment"
8. Done! ✅

**Time**: ~40 seconds

---

## Error Messages and Solutions

### "Please open a shift first"
**Cause**: No active shift
**Solution**: Open a shift by entering opening cash amount

### "Cart is empty. Please add items before completing the order."
**Cause**: Trying to process payment with empty cart
**Solution**: Add at least one product to cart

### "Cash received must be greater than or equal to the total amount"
**Cause**: Cash amount is less than total
**Solution**: Enter correct cash amount (>= total)

### "Insufficient stock for [Product]. Available: X, Required: Y"
**Cause**: Not enough stock for the requested quantity
**Solution**: 
- Reduce quantity to available stock
- Or check inventory and restock if needed

### "Please add at least one payment method"
**Cause**: Trying to complete mixed payment without adding any payment methods
**Solution**: Click "Add Cash" or "Add Card" to add payment methods

### "Insufficient payment. Paid: X UZS, Required: Y UZS"
**Cause**: Total paid amount is less than order total
**Solution**: Add more payment methods until remaining = 0

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Focus search box | Start typing to search products |
| Enter (in search) | Add product by barcode |
| Tab | Navigate between fields |
| Esc | Close payment dialog |

---

## Best Practices

### 1. Always Verify Cart Before Payment
- Check product names
- Verify quantities
- Confirm prices
- Review total amount

### 2. Count Cash Carefully
- Count cash received in front of customer
- Enter exact amount in system
- Verify change amount
- Count change back to customer

### 3. Customer Service
- Greet customer warmly
- Confirm items as you scan
- Announce total amount
- Thank customer after payment

### 4. Handle Errors Gracefully
- Read error messages carefully
- Explain issue to customer politely
- Resolve issue quickly
- Apologize for any inconvenience

### 5. End of Shift
- Process all pending orders
- Count cash drawer
- Close shift in system
- Report any discrepancies

---

## Tips and Tricks

### Speed Up Checkout
1. Use barcode scanner for faster product entry
2. Keep frequently sold items easily accessible
3. Memorize common product codes
4. Use keyboard shortcuts
5. Prepare change in advance

### Reduce Errors
1. Always verify quantities before payment
2. Double-check cash received amount
3. Count change twice
4. Confirm customer selection
5. Review order summary before completing

### Handle Rush Hours
1. Stay calm and focused
2. Process one customer at a time
3. Use quick payment methods (card/QR)
4. Minimize small talk during busy times
5. Ask for help if queue is too long

### Customer Satisfaction
1. Smile and make eye contact
2. Be patient with questions
3. Explain discounts clearly
4. Provide receipt promptly
5. Thank customer sincerely

---

## Troubleshooting

### Payment Dialog Won't Close
**Solution**: Click outside the dialog or press Esc

### Cart Not Clearing After Payment
**Solution**: Refresh the page (F5)

### Search Not Working
**Solution**: 
1. Check internet connection
2. Verify product exists in database
3. Try searching by SKU or barcode

### Barcode Scanner Not Working
**Solution**:
1. Check scanner connection
2. Test scanner in notepad
3. Ensure search box is focused
4. Try manual entry

### Change Calculation Wrong
**Solution**:
1. Verify cash received amount
2. Check discount is applied correctly
3. Confirm total amount
4. Recalculate manually if needed

---

## Support

### Need Help?
- Check this guide first
- Ask your manager
- Contact IT support
- Check system documentation

### Report Issues
- Note the error message
- Record the order number (if any)
- Document steps to reproduce
- Report to IT support immediately

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────┐
│           POS TERMINAL QUICK REFERENCE              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. OPEN SHIFT → Enter opening cash                │
│                                                     │
│  2. ADD PRODUCTS → Search or scan barcode          │
│                                                     │
│  3. ADJUST CART → +/- buttons or trash icon        │
│                                                     │
│  4. SELECT CUSTOMER → Optional, for tracking       │
│                                                     │
│  5. APPLY DISCOUNT → Optional, amount or %         │
│                                                     │
│  6. PROCESS PAYMENT → Choose method:               │
│     • Cash → Enter received, get change            │
│     • Card → Exact amount                          │
│     • QR → Exact amount                            │
│     • Mixed → Combine multiple methods             │
│                                                     │
│  7. COMPLETE PAYMENT → Cart clears automatically   │
│                                                     │
├─────────────────────────────────────────────────────┤
│  REMEMBER:                                          │
│  ✓ Verify cart before payment                      │
│  ✓ Count cash carefully                            │
│  ✓ Confirm change amount                           │
│  ✓ Thank customer                                  │
└─────────────────────────────────────────────────────┘
```

---

## Version Information

- **System**: POS Terminal v1.0
- **Last Updated**: 2025-12-05
- **Payment Methods**: Cash, Card, QR, Mixed
- **Currency**: UZS (Uzbekistan Som)
- **Support**: IT Department

---

**Happy Selling! 🎉**
