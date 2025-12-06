# Per-Product Discount Feature - User Guide

## Quick Start

### Adding a Line Discount

1. **Add products to your cart** as usual using the product search
2. **Locate the discount button** at the bottom of each cart item (shows "Discount: 0" by default)
3. **Click the discount button** to open the discount editor
4. **Enter the discount amount** in UZS or use quick buttons:
   - **5%** button: Applies 5% discount
   - **10%** button: Applies 10% discount
   - **Clear** button: Removes the discount
5. **Discount applies immediately** - you'll see the updated line total

### Visual Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Shopping Cart                                                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Product Name                          [-] 2 [+] [🗑️]  │   │
│ │ 50.00 UZS × 2 = 100.00 UZS                            │   │
│ │ ─────────────────────────────────────────────────────  │   │
│ │ [🏷️ Discount: 10.00 UZS]              ~~100.00 UZS~~  │   │
│ │                                        90.00 UZS       │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Another Product                       [-] 1 [+] [🗑️]  │   │
│ │ 30.00 UZS × 1 = 30.00 UZS                             │   │
│ │ ─────────────────────────────────────────────────────  │   │
│ │ [🏷️ Discount: 0]                      30.00 UZS       │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Order Summary                                                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Subtotal:                                      130.00 UZS    │
│ Line Discounts:                                -10.00 UZS    │
│ Order Discount:                                 -5.00 UZS    │
│ Total Discount:                                -15.00 UZS    │
│ ─────────────────────────────────────────────────────────    │
│ Total:                                         115.00 UZS    │
│                                                               │
│ [💵 Process Payment]                                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Discount Editor Popover

When you click the discount button, a popover appears:

```
┌──────────────────────────────────┐
│ Line Discount (UZS)              │
│ ┌──────────────────────────────┐ │
│ │ 10.00                        │ │
│ └──────────────────────────────┘ │
│ Max: 100.00 UZS                  │
│                                  │
│ [  5%  ] [ 10%  ] [ Clear ]      │
└──────────────────────────────────┘
```

## Features

### ✅ Real-time Calculation
- Line totals update immediately when you change the discount
- Order Summary updates automatically
- No need to click "Apply" or "Save"

### ✅ Smart Validation
- **Cannot be negative**: System prevents negative discounts
- **Cannot exceed subtotal**: Maximum discount is the line subtotal
- **Auto-adjustment**: If you change quantity, discount adjusts automatically if needed

### ✅ Visual Feedback
- Original price shown with strikethrough when discounted
- Discount amount displayed in red
- Final total shown in bold
- Toast notifications for validation errors

### ✅ Quick Actions
- **5% button**: Instantly applies 5% discount
- **10% button**: Instantly applies 10% discount
- **Clear button**: Removes discount (sets to 0)

## Common Scenarios

### Scenario 1: Simple Line Discount
```
Product: Widget A
Unit Price: 50.00 UZS
Quantity: 2
Line Subtotal: 100.00 UZS
Line Discount: 10.00 UZS
Line Total: 90.00 UZS
```

### Scenario 2: Line Discount + Global Discount
```
Cart:
  - Product A: 100.00 UZS (subtotal) - 10.00 UZS (line discount) = 90.00 UZS
  - Product B: 50.00 UZS (subtotal) - 5.00 UZS (line discount) = 45.00 UZS

Order Summary:
  Subtotal: 150.00 UZS
  Line Discounts: -15.00 UZS
  Order Discount (10%): -13.50 UZS  (10% of 135.00)
  Total Discount: -28.50 UZS
  Final Total: 121.50 UZS
```

### Scenario 3: Quantity Change with Discount
```
Initial State:
  Quantity: 2
  Unit Price: 50.00 UZS
  Subtotal: 100.00 UZS
  Discount: 20.00 UZS
  Total: 80.00 UZS

After Decreasing Quantity to 1:
  Quantity: 1
  Unit Price: 50.00 UZS
  Subtotal: 50.00 UZS
  Discount: 20.00 UZS (adjusted to 50.00 UZS max)
  Total: 30.00 UZS
  
  ⚠️ Toast: "Line discount reduced to 50.00 UZS (cannot exceed line subtotal)"
```

## Tips & Best Practices

### 💡 Tip 1: Use Quick Buttons for Speed
Instead of typing, use the 5% or 10% buttons for common discounts. Much faster!

### 💡 Tip 2: Line Discounts First, Then Global
Apply line discounts to specific items first, then use the global order discount for additional savings.

### 💡 Tip 3: Check Order Summary
Always review the Order Summary before processing payment to ensure all discounts are correct.

### 💡 Tip 4: Clear Unwanted Discounts
If you accidentally add a discount, just click the "Clear" button in the popover.

## Validation Rules

| Rule | Behavior | Example |
|------|----------|---------|
| Negative discount | Blocked, shows error toast | Input: -10 → Result: 0 |
| Discount > subtotal | Clamped to subtotal, shows warning | Subtotal: 50, Input: 100 → Result: 50 |
| Empty input | Treated as 0 | Input: (empty) → Result: 0 |
| Quantity decrease | Discount adjusted if needed | Qty: 2→1, Discount: 100→50 |

## Keyboard Shortcuts

- **Tab**: Navigate between discount fields
- **Enter**: Close popover (discount already applied)
- **Escape**: Close popover without changes

## Troubleshooting

### Q: Why can't I enter a discount larger than the subtotal?
**A:** This is by design. A discount cannot exceed the line subtotal. The maximum discount is automatically enforced.

### Q: Why did my discount change when I adjusted the quantity?
**A:** When you decrease quantity, the subtotal decreases. If your discount was larger than the new subtotal, it's automatically adjusted down to prevent invalid state.

### Q: Can I use percentage discounts for line items?
**A:** Currently, line discounts are amount-based only. Use the quick buttons (5%, 10%) for percentage-based calculations, or use the global order discount for percentage-based discounts.

### Q: Where are line discounts saved?
**A:** Line discounts are saved in the order items when you complete the payment. They're stored in the database and can be viewed in order history.

## Integration with Other Features

### ✅ Works With
- Global order discount (Order Summary)
- All payment methods (Cash, Card, QR, Mixed)
- Quantity adjustments
- Product removal
- Order completion and receipt printing

### ✅ Saved In
- Order items table (`discount_amount` field)
- Order history
- Sales reports
- Customer purchase history

## Summary

The per-product discount feature gives you fine-grained control over pricing at the line level. It's fast, intuitive, and fully integrated with the existing POS system. Use it to:

- Apply promotional discounts to specific items
- Offer customer-specific pricing
- Handle damaged goods or clearance items
- Provide flexible pricing options
- Combine with global discounts for maximum savings

**Remember**: Line discounts are applied first, then the global order discount is applied to the remaining amount.
