# Partial Credit Payment - User Guide

## Overview
The POS Terminal now supports **Partial Credit + Partial Payment**, allowing you to split an order between credit and other payment methods (Cash, Card, or QR).

## Key Features

### 1. Full Credit Sale (Existing Feature - Enhanced)
- Customer purchases items entirely on credit
- Full amount added to customer balance
- Order marked as `ON_CREDIT`

### 2. Partial Credit Sale (NEW)
- Customer uses partial credit + pays remaining with Cash/Card/QR
- Credit amount added to customer balance
- Remaining amount collected immediately
- Order marked as `PARTIALLY_PAID`

### 3. No Credit Sale (Existing Feature)
- Customer pays full amount with Cash/Card/QR
- No credit used
- Order marked as `PAID`

## How to Use

### Scenario 1: Full Credit Sale
**Example:** Customer buys 1,000,000 UZS worth of goods, all on credit.

1. Add products to cart
2. Select customer (required for credit)
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Leave credit amount field empty (defaults to full total)
6. Review:
   - Current Balance: 500,000 UZS
   - Order Total: 1,000,000 UZS
   - New Balance: 1,500,000 UZS
7. Click "Sell on Credit"
8. Order completed! Customer balance updated.

### Scenario 2: Partial Credit + Cash
**Example:** Customer buys 1,000,000 UZS worth of goods, uses 600,000 UZS credit, pays 400,000 UZS cash.

1. Add products to cart
2. Select customer (required for credit)
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Enter credit amount: `600000`
6. Review:
   - Order Total: 1,000,000 UZS
   - Credit Amount: 600,000 UZS
   - **Remaining to Pay: 400,000 UZS** ⚠️
   - New Balance: 1,100,000 UZS (500,000 + 600,000)
7. Click "Continue with Partial Credit"
8. System shows: "Partial Credit Confirmed. Please collect remaining 400,000 UZS"
9. Go to **Cash** tab
10. Enter cash received: `400000` (or more)
11. Click "Complete Payment"
12. Order completed! Customer balance updated, cash collected.

### Scenario 3: Partial Credit + Card
**Example:** Customer buys 1,000,000 UZS worth of goods, uses 700,000 UZS credit, pays 300,000 UZS by card.

1. Add products to cart
2. Select customer
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Enter credit amount: `700000`
6. Click "Continue with Partial Credit"
7. Go to **Card** tab
8. Verify amount: 300,000 UZS
9. Click "Complete Payment"
10. Order completed!

### Scenario 4: Partial Credit + Mixed Payment
**Example:** Customer buys 1,000,000 UZS worth of goods, uses 500,000 UZS credit, pays 300,000 UZS cash + 200,000 UZS card.

1. Add products to cart
2. Select customer
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Enter credit amount: `500000`
6. Click "Continue with Partial Credit"
7. Go to **Mixed** tab
8. Add payment: Cash - 300,000 UZS
9. Add payment: Card - 200,000 UZS
10. Total paid: 500,000 UZS (matches remaining amount)
11. Click "Complete Mixed Payment"
12. Order completed!

## Validation & Limits

### Credit Limit Enforcement
- System calculates **Available Credit** = `Credit Limit - Current Balance`
- Maximum credit amount = `min(Order Total, Available Credit)`
- If credit limit would be exceeded, button is disabled with warning message

### Input Validation
- Credit amount cannot be negative
- Credit amount cannot exceed order total
- Credit amount cannot exceed available credit limit
- Customer must be selected (no credit for Walk-in customers)
- Customer must be active

### Visual Indicators
- **Green** text: New balance within limit
- **Red** text: Credit limit exceeded (button disabled)
- **Blue** info box: Partial credit reminder
- **Yellow** warning: Credit limit exceeded

## Payment Status Tracking

After order completion, the system assigns a payment status:

| Credit Amount | Paid Amount | Payment Status | Description |
|--------------|-------------|----------------|-------------|
| Full Total | 0 | `ON_CREDIT` | Entire order on credit |
| 0 | Full Total | `PAID` | Fully paid, no credit |
| Partial | Remaining | `PARTIALLY_PAID` | Split payment |

## Customer Balance Updates

- **Credit Amount** is immediately added to customer balance
- Balance updates are atomic (all-or-nothing)
- Customer can view their balance in the Customers page
- Cashier can see current and new balance before confirming

## Stock Management

- Stock is deducted regardless of payment method
- Partial credit orders deduct stock immediately (not held)
- Stock validation happens before order completion
- If stock is insufficient, order is rejected

## Reports & Analytics

Partial credit orders are tracked in:
- **Daily Sales Report**: Shows total sales including credit
- **Customer Sales Report**: Shows credit vs. paid breakdown
- **Payment Method Breakdown**: Credit tracked separately
- **Customer Balance Report**: Shows outstanding balances

## Tips for Cashiers

1. **Always verify customer credit limit** before offering credit
2. **Communicate clearly** when collecting remaining payment
3. **Use partial credit** when customer has limited credit available
4. **Check customer balance** regularly to avoid over-limit situations
5. **Confirm amounts** before completing payment

## Troubleshooting

### "Credit Limit Exceeded" Error
- **Cause**: Credit amount + current balance > credit limit
- **Solution**: Reduce credit amount or collect more cash/card payment

### "Customer Required" Error
- **Cause**: No customer selected or Walk-in customer selected
- **Solution**: Select a registered customer from dropdown

### "Insufficient Cash" Error
- **Cause**: Cash received is less than required amount (after credit)
- **Solution**: Collect more cash or adjust credit amount

### "Payment Mismatch" Error (Mixed Payment)
- **Cause**: Total paid doesn't match remaining amount after credit
- **Solution**: Adjust payment amounts to match exactly

## Keyboard Shortcuts

- **F2**: Open payment dialog
- **ESC**: Close payment dialog
- **TAB**: Navigate between payment tabs
- **ENTER**: Confirm payment (when button is focused)

## Example Calculations

### Example 1: Simple Partial Credit
```
Order Total:        1,000,000 UZS
Credit Amount:        600,000 UZS
Remaining to Pay:     400,000 UZS
Cash Received:        500,000 UZS
Change:               100,000 UZS

Customer Balance Before: 200,000 UZS
Customer Balance After:  800,000 UZS (+600,000)
```

### Example 2: Maximum Credit Usage
```
Order Total:          1,500,000 UZS
Customer Balance:       300,000 UZS
Credit Limit:         1,000,000 UZS
Available Credit:       700,000 UZS (1,000,000 - 300,000)

Max Credit Amount:      700,000 UZS (limited by available credit)
Remaining to Pay:       800,000 UZS
```

### Example 3: Full Credit (No Limit)
```
Order Total:          2,000,000 UZS
Customer Balance:       500,000 UZS
Credit Limit:                 0 UZS (unlimited)
Available Credit:     2,000,000 UZS (no limit)

Credit Amount:        2,000,000 UZS (full order)
Remaining to Pay:             0 UZS

Customer Balance After: 2,500,000 UZS
```

## Best Practices

1. **Set appropriate credit limits** for each customer based on their payment history
2. **Review customer balances** regularly and follow up on overdue payments
3. **Use partial credit** to maintain cash flow while serving customers
4. **Train staff** on credit policies and limits
5. **Monitor credit sales** through reports to identify trends

## Security & Permissions

- All cashiers can process credit sales (if customer has credit limit)
- Credit limits are set by managers/admins in Customer Management
- All credit transactions are logged with cashier ID and timestamp
- Customer balance changes are tracked in audit logs

## Support

For questions or issues with partial credit payments:
1. Check this guide first
2. Review customer credit limit settings
3. Verify customer account is active
4. Contact system administrator if problems persist
