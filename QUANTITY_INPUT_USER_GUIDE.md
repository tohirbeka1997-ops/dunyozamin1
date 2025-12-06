# Editable Quantity Input - User Guide

## Quick Start

### How to Change Quantity

You now have **three ways** to adjust product quantities in the shopping cart:

#### Method 1: Type Directly (NEW! ⚡)
1. **Click** on the quantity number
2. **Type** the desired quantity (e.g., 5, 10, 25)
3. **Press Enter** or **click outside** to apply

#### Method 2: Plus Button
- Click the **[+]** button to increase by 1

#### Method 3: Minus Button
- Click the **[−]** button to decrease by 1

## Visual Guide

### Before (Static Label)
```
Product Name                    [−] 2 [+] [🗑️]
50.00 UZS × 2 = 100.00 UZS
```

### After (Editable Input)
```
Product Name                    [−] [ 2 ] [+] [🗑️]
50.00 UZS × 2 = 100.00 UZS
                                     ↑
                              Click to edit!
```

## Examples

### Example 1: Small Quantity Change
**Scenario**: Change from 2 to 3
- **Old way**: Click [+] once
- **New way**: Click [+] once OR type "3"

### Example 2: Large Quantity Change
**Scenario**: Change from 1 to 25
- **Old way**: Click [+] 24 times 😫
- **New way**: Type "25" and press Enter ⚡

### Example 3: Bulk Order
**Scenario**: Order 100 units
- **Old way**: Click [+] 99 times 😱
- **New way**: Type "100" and press Enter 🚀

## Validation & Error Handling

### ✅ Valid Inputs
| Input | Result | Notes |
|-------|--------|-------|
| 5 | Quantity = 5 | ✓ Valid |
| 10 | Quantity = 10 | ✓ Valid |
| 25 | Quantity = 25 | ✓ Valid |
| 100 | Quantity = 100 | ✓ Valid (if stock available) |

### ❌ Invalid Inputs
| Input | Result | Error Message |
|-------|--------|---------------|
| 0 | Restored to previous | "Invalid Quantity - Quantity must be at least 1" |
| -5 | Restored to previous | "Invalid Quantity - Quantity must be at least 1" |
| (empty) | Restored to previous | "Invalid Quantity - Quantity must be at least 1" |
| abc | Restored to previous | "Invalid Quantity - Quantity must be at least 1" |

### ⚠️ Stock Limits
| Input | Stock | Result | Warning Message |
|-------|-------|--------|-----------------|
| 100 | 50 | Quantity = 50 | "Stock Limit Reached - Maximum available quantity is 50" |
| 25 | 50 | Quantity = 25 | (no warning) |
| 10 | 5 | Quantity = 5 | "Stock Limit Reached - Maximum available quantity is 5" |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Click** on number | Start editing |
| **Type** numbers | Enter quantity |
| **Enter** | Apply changes |
| **Tab** | Apply and move to next field |
| **Escape** | Cancel (restore previous value) |

## Tips & Tricks

### 💡 Tip 1: Quick Entry
For fast checkout, just type the quantity and press Enter. No need to click outside!

### 💡 Tip 2: Tab Navigation
Use Tab key to quickly move between quantity fields when processing multiple items.

### 💡 Tip 3: Stock Awareness
The system automatically prevents you from ordering more than available stock.

### 💡 Tip 4: Undo Mistakes
If you make a mistake, just type the correct number. Or press Escape to cancel.

### 💡 Tip 5: Buttons Still Work
The +/- buttons are still there if you prefer clicking!

## Common Scenarios

### Scenario 1: Restaurant Supply Order
```
Cart:
- Rice (50kg bags) → Type "10"
- Oil (5L bottles) → Type "20"
- Sugar (1kg packs) → Type "15"

Total time: ~5 seconds ⚡
(vs. ~2 minutes with buttons)
```

### Scenario 2: Retail Restocking
```
Cart:
- T-Shirts (Small) → Type "25"
- T-Shirts (Medium) → Type "30"
- T-Shirts (Large) → Type "20"

Total time: ~5 seconds ⚡
```

### Scenario 3: Wholesale Order
```
Cart:
- Product A → Type "100"
- Product B → Type "75"
- Product C → Type "50"

Total time: ~5 seconds ⚡
```

## What Happens When You Change Quantity?

### Automatic Updates
1. **Line Subtotal** recalculates: `unit_price × new_quantity`
2. **Line Discount** adjusts if needed (cannot exceed subtotal)
3. **Line Total** updates: `subtotal - discount`
4. **Order Summary** refreshes:
   - Subtotal
   - Line Discounts
   - Order Discount
   - Total Amount

### Example Calculation
```
Initial State:
  Unit Price: 50.00 UZS
  Quantity: 2
  Subtotal: 100.00 UZS
  Discount: 10.00 UZS
  Total: 90.00 UZS

After typing "5":
  Unit Price: 50.00 UZS
  Quantity: 5
  Subtotal: 250.00 UZS
  Discount: 10.00 UZS (unchanged)
  Total: 240.00 UZS
```

## Troubleshooting

### Q: I typed a number but nothing happened
**A:** Make sure to press Enter or click outside the input field to apply the change.

### Q: The quantity went back to the old value
**A:** This happens when you enter an invalid value (0, negative, or non-number). The system protects you from errors by restoring the previous valid quantity.

### Q: I can't enter a quantity higher than X
**A:** The system limits quantity to available stock. Check the stock level or contact your manager to receive more inventory.

### Q: Can I use decimal quantities (e.g., 2.5)?
**A:** No, only whole numbers (integers) are accepted. The system automatically rounds down decimal inputs.

### Q: The +/- buttons don't work anymore
**A:** They still work! The buttons and input field work together. Use whichever method you prefer.

## Best Practices

### ✅ Do
- Type quantities for bulk orders (faster)
- Use +/- buttons for small adjustments
- Press Enter to quickly apply changes
- Check stock availability before ordering large quantities

### ❌ Don't
- Leave the field empty
- Enter negative numbers
- Enter non-numeric characters
- Exceed available stock (system will prevent it anyway)

## Benefits Summary

### Speed
- **10x faster** for large quantities
- **Instant** quantity changes
- **No repetitive clicking**

### Accuracy
- **Visual confirmation** of quantity
- **Validation** prevents errors
- **Stock limits** enforced automatically

### Flexibility
- **Multiple input methods** (type, +, -)
- **Keyboard shortcuts** for power users
- **Touch-friendly** for tablets

### Professional
- **Modern POS experience**
- **Industry standard** interaction
- **Efficient workflow**

## Summary

The editable quantity input makes the POS Terminal faster and more efficient, especially for bulk orders. You can now:

✅ Type quantities directly  
✅ Use keyboard shortcuts  
✅ Process orders faster  
✅ Reduce clicking fatigue  
✅ Maintain accuracy with validation  

**Try it now**: Add a product to your cart and click on the quantity number to start editing!
