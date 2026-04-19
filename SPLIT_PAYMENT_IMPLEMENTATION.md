# Split Payment (Aralash to'lov) Implementation

**Date**: 2025-12-17  
**Status**: ✅ **IMPLEMENTED**

---

## Summary

Implemented manual split payment functionality allowing cashiers to specify exact amounts for different payment methods (Cash, Card, Transfer).

---

## UI Changes

### New "Aralash to'lov" (Mixed) Tab

The mixed payment tab now features:

1. **Total Due Display** - Shows the total amount to be paid in a prominent blue card

2. **Manual Input Fields** for each payment type:
   - **Naqd (Cash)** - Green themed input with Banknote icon
   - **Karta (Card)** - Purple themed input with CreditCard icon  
   - **Click/Payme (Transfer)** - Orange themed input with Smartphone icon

3. **Live Calculation Summary**:
   - **Kiritilgan summa (Entered)** - Sum of all payment inputs
   - **Qoldiq (Remaining)** - Amount still needed (red if > 0, green checkmark if paid)
   - **Qaytim (Change)** - Displayed when overpaid

4. **Quick Fill Buttons**:
   - "Hammasi naqd" - Sets full amount to cash
   - "Hammasi karta" - Sets full amount to card
   - "Tozalash" - Clears all inputs

5. **Smart Complete Button**:
   - Disabled until total entered ≥ total due
   - Shows remaining amount needed when disabled
   - Shows "Sotuvni yakunlash" with checkmark when valid

---

## State Variables Added

```typescript
// Split payment state (for "Aralash to'lov" - mixed payments)
const [splitCash, setSplitCash] = useState<number | null>(null);
const [splitCard, setSplitCard] = useState<number | null>(null);
const [splitTransfer, setSplitTransfer] = useState<number | null>(null);

// Computed values
const splitTotal = (splitCash || 0) + (splitCard || 0) + (splitTransfer || 0);
const splitRemaining = total - splitTotal;
const splitChange = splitTotal > total ? splitTotal - total : 0;
const isSplitValid = splitTotal >= total;
```

---

## Payment Flow

```
User enters amounts in any combination:
  - Cash: 50,000
  - Card: 25,000
  - Transfer: 0
  
System calculates:
  - Total: 75,000 ✓
  - Remaining: 0
  
User clicks "Sotuvni yakunlash"
  ↓
Handler receives payments array:
  [
    { method: 'cash', amount: 50000 },
    { method: 'card', amount: 25000 }
  ]
  ↓
Backend stores split payments
  ↓
Stock decreased, receipt generated
```

---

## Backend Support

The existing `pos:sales:completePOSOrder` handler already supports multiple payments:

```javascript
// main.cjs - completePOSOrder
// paymentsData is an array:
[
  { payment_method: 'cash', amount: 50000 },
  { payment_method: 'card', amount: 25000 }
]
```

Each payment is stored in the order record for accurate daily reports.

---

## Validation Rules

1. **Total entered must be ≥ Total due** - Button stays disabled until satisfied
2. **Overpayment allowed** - Change is calculated automatically
3. **Zero amounts ignored** - Only non-zero payments are submitted
4. **State reset on completion** - All split amounts cleared after successful sale

---

## Example Usage

### Scenario: 75,000 UZS bill paid with Cash + Card

1. Go to POS Terminal → Add items totaling 75,000 UZS
2. Click "To'lash" (Pay) button
3. Select "Aralash" (Mixed) tab
4. Enter:
   - Naqd (Cash): `50000`
   - Karta (Card): `25000`
5. Observe:
   - Kiritilgan summa: 75,000 ✓
   - Qoldiq: ✓ To'liq
6. Click "Sotuvni yakunlash"
7. Sale completes with both payment methods recorded

---

## Files Changed

1. **`src/pages/POSTerminal.tsx`**
   - Added split payment state variables
   - Added computed split payment values
   - Replaced mixed tab UI with manual input fields
   - Updated `handleCompletePayment` to accept override payments
   - Added state reset on payment completion

---

## Screenshots

### Before (Button-based)
```
[ Add Cash ] [ Add Card ]
(Predefined amounts)
```

### After (Manual Input)
```
┌─────────────────────────────────────┐
│ Jami summa (Total Due): 75,000     │
└─────────────────────────────────────┘

┌─ Naqd (Cash) ──────────────────────┐
│ [💵]  [ 50000_____________ ]       │
└─────────────────────────────────────┘

┌─ Karta (Card) ─────────────────────┐
│ [💳]  [ 25000_____________ ]       │
└─────────────────────────────────────┘

┌─ Click/Payme (Transfer) ───────────┐
│ [📱]  [ 0_________________ ]       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Kiritilgan:        75,000          │
│ Qoldiq:            ✓ To'liq        │
└─────────────────────────────────────┘

[ Hammasi naqd ] [ Hammasi karta ] [ Tozalash ]

[       ✓ Sotuvni yakunlash        ]
```

---

## Testing

1. Restart app: `npm run electron:dev`
2. Add product(s) to cart
3. Click "To'lash" → Select "Aralash" tab
4. Enter split amounts (e.g., 50000 cash + 25000 card)
5. Verify totals update live
6. Click complete → Verify success
7. Check Inventory → Stock should decrease

















































