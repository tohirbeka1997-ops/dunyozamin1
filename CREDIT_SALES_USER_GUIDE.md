# Customer Credit / Debt Feature - User Guide

## Overview
The POS System now supports selling products on credit to registered customers. This guide explains how to use the new credit/debt features.

---

## 1. Selling on Credit (POS Terminal)

### Prerequisites
- Customer must be registered in the system (not "Walk-in Customer")
- Customer must be active
- Customer must not exceed their credit limit (if set)

### Steps

1. **Open POS Terminal**
   - Navigate to POS Terminal from the main menu

2. **Select Customer**
   - Click the "Customer (Optional)" dropdown
   - Select a registered customer (e.g., "John Doe")
   - You'll see their current balance displayed

3. **Add Products to Cart**
   - Search and add products as usual
   - Apply discounts if needed

4. **Process Payment**
   - Click "Process Payment" button
   - Select the **"Credit"** tab (5th tab)

5. **Review Credit Information**
   - Current Balance: Customer's existing debt
   - Credit Limit: Maximum allowed debt (if set)
   - New Balance: What the balance will be after this sale
   - Warning: Red alert if credit limit would be exceeded

6. **Complete Sale**
   - Click "Complete Credit Sale" button
   - Order is created with status "ON CREDIT"
   - Customer's balance is increased
   - Stock is reduced
   - Success message shows new balance

### Example
```
Customer: John Doe
Current Balance: 500,000 UZS
Order Total: 1,500,000 UZS
Credit Limit: 3,000,000 UZS

New Balance: 2,000,000 UZS ✅ (within limit)
```

### Restrictions
- ❌ Cannot sell on credit to "Walk-in Customer"
- ❌ Cannot sell on credit to inactive customers
- ❌ Cannot exceed customer's credit limit
- ❌ Cart must not be empty

---

## 2. Receiving Payments (Customer Detail Page)

### Steps

1. **Navigate to Customer**
   - Go to Customers page
   - Click on a customer with outstanding balance
   - Or search for customer by name/phone

2. **View Debt Information**
   - Customer Debt card shows:
     - Current Balance (in red)
     - Credit Limit
     - Available Credit

3. **Receive Payment**
   - Click "Receive Payment" button in header
   - Payment dialog opens

4. **Enter Payment Details**
   - Amount: Enter payment amount (cannot exceed balance)
   - Payment Method: Select Cash, Card, or QR
   - Note: Optional note (e.g., "Partial payment")
   - Preview: See what new balance will be

5. **Complete Payment**
   - Click "Receive Payment" button
   - Payment is recorded
   - Customer balance is reduced
   - Success message shows new balance

6. **View Payment History**
   - Click "Payments" tab
   - See all past payments with:
     - Payment Number
     - Date
     - Method
     - Amount
     - Notes

### Example
```
Customer: John Doe
Current Balance: 2,000,000 UZS
Payment Amount: 500,000 UZS
Payment Method: Cash

New Balance: 1,500,000 UZS
Payment Number: PAY-2025-0045
```

---

## 3. Viewing Customer Debt (Customers List)

### Features

1. **Balance Column**
   - Shows current balance for each customer
   - Red/orange badge for customers with debt
   - Grey "0 UZS" for customers with no debt

2. **Debt Filter**
   - "All Customers" - show everyone
   - "With Debt" - only customers with balance > 0
   - "No Debt" - only customers with balance = 0

3. **Quick Actions**
   - Click customer name to view details
   - Click "Receive Payment" from detail page

---

## 4. Dashboard Metrics

### Total Customer Debt Card
- Displayed when total debt > 0
- Shows sum of all customer balances
- Red dollar icon
- Subtitle: "Outstanding balance"

### Example
```
Total Customer Debt: 5,750,000 UZS
Outstanding balance
```

---

## 5. Sales Returns with Credit Orders

### Automatic Balance Adjustment

When you return items from a credit order:
1. Stock is increased (as usual)
2. Customer's balance is **automatically reduced** by return amount
3. No manual adjustment needed

### Example
```
Original Credit Order: 1,500,000 UZS
Customer Balance: 2,000,000 UZS

Return: 500,000 UZS worth of items
New Balance: 1,500,000 UZS (automatically reduced)
```

### Steps
1. Go to Sales Returns
2. Create return as usual
3. Select order (credit or paid)
4. Select items to return
5. Choose refund method
6. Complete return
7. If original order was credit, balance is reduced automatically

---

## 6. Common Scenarios

### Scenario 1: New Credit Customer
```
1. Create customer with credit limit: 2,000,000 UZS
2. Sell products worth 800,000 UZS on credit
3. Customer balance: 800,000 UZS
4. Available credit: 1,200,000 UZS
```

### Scenario 2: Multiple Credit Sales
```
1. Customer balance: 500,000 UZS
2. Credit sale 1: 300,000 UZS → Balance: 800,000 UZS
3. Credit sale 2: 400,000 UZS → Balance: 1,200,000 UZS
4. Payment: 500,000 UZS → Balance: 700,000 UZS
```

### Scenario 3: Credit Limit Exceeded
```
Customer balance: 1,800,000 UZS
Credit limit: 2,000,000 UZS
New order: 500,000 UZS

❌ BLOCKED: New balance (2,300,000) exceeds limit (2,000,000)
Solution: Receive payment first, then create order
```

### Scenario 4: Partial Return
```
Credit order: 1,500,000 UZS (3 items @ 500,000 each)
Customer balance: 2,000,000 UZS

Return 1 item: 500,000 UZS
New balance: 1,500,000 UZS
```

---

## 7. Tips & Best Practices

### For Cashiers
1. Always verify customer identity before credit sales
2. Check credit limit before large orders
3. Encourage customers to make regular payments
4. Use notes field in payments for reference

### For Managers
1. Set appropriate credit limits for each customer
2. Monitor total customer debt in dashboard
3. Review customers with high balances regularly
4. Use payment history for customer relationship management

### For Administrators
1. Regularly review customer balances
2. Adjust credit limits based on payment history
3. Use debt filter to identify customers needing follow-up
4. Export customer data for accounting purposes

---

## 8. Troubleshooting

### Problem: Cannot sell on credit
**Solution:** 
- Ensure customer is selected (not walk-in)
- Check customer is active
- Verify credit limit not exceeded

### Problem: Cannot receive payment
**Solution:**
- Ensure amount is greater than 0
- Ensure amount doesn't exceed current balance
- Select payment method

### Problem: Balance not updating
**Solution:**
- Refresh the page
- Check if transaction completed successfully
- Contact administrator if issue persists

### Problem: Credit limit warning
**Solution:**
- Receive payment from customer first
- Or increase customer's credit limit (if appropriate)
- Or reduce order amount

---

## 9. Keyboard Shortcuts (POS Terminal)

- `Ctrl + K` - Focus search
- `Ctrl + P` - Process payment
- `Ctrl + H` - Hold order
- `Ctrl + C` - Clear cart
- `Esc` - Close dialogs

---

## 10. Security Notes

- All credit transactions are logged
- Payment history is permanent and cannot be deleted
- Only authenticated users can create credit orders
- Customer balances are protected by database security

---

## Support

For technical issues or questions:
1. Check this user guide
2. Review technical documentation (CREDIT_SALES_IMPLEMENTATION.md)
3. Contact system administrator
4. Report bugs to development team

---

**Last Updated:** 2025-12-06  
**Version:** 1.0  
**Feature Status:** Production Ready ✅
