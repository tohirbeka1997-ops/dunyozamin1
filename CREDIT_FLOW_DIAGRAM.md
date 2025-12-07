# Credit System Flow Diagrams

## 1. Full Credit Sale Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        POS TERMINAL                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Select Customer │
                    │ (Credit Limit:  │
                    │  500 UZS)       │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Add Products   │
                    │  Total: 100 UZS │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Process Payment │
                    │  → Credit Tab   │
                    └────────┬────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │         CREDIT PAYMENT DIALOG              │
        │                                            │
        │  Current Balance:      0 UZS              │
        │  Available Credit:   500 UZS              │
        │  Credit Amount:      100 UZS              │
        │  New Balance:        100 UZS              │
        │                                            │
        │         [Sell on Credit]                   │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         BACKEND (complete_pos_order)       │
        │                                            │
        │  1. Validate customer & credit limit      │
        │  2. Create order:                         │
        │     - total_amount: 100                   │
        │     - paid_amount: 0                      │
        │     - credit_amount: 100                  │
        │     - payment_status: 'on_credit'         │
        │  3. Update customer:                      │
        │     - balance = balance + 100             │
        │  4. Update inventory (deduct stock)       │
        │                                            │
        │  ✅ Transaction committed                  │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         FRONTEND CLEANUP                   │
        │                                            │
        │  setCart([])                              │
        │  setPayments([])                          │
        │  setDiscount({ type: 'amount', value: 0 })│
        │  setSelectedCustomer(null)  ← FIX!        │
        │  setPaymentDialogOpen(false)              │
        │  setCashReceived('')                      │
        │  setCreditAmount('')                      │
        │                                            │
        │  ✅ Modal closes                           │
        │  ✅ Cart cleared                           │
        │  ✅ Success toast shown                    │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         RESULT                             │
        │                                            │
        │  ✅ Order created: POS-2025-000123         │
        │  ✅ Customer balance: 100 UZS              │
        │  ✅ Dashboard updated                      │
        │  ✅ POS ready for next sale                │
        └────────────────────────────────────────────┘
```

---

## 2. Partial Credit Sale Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        POS TERMINAL                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Select Customer │
                    │ (Balance: 100)  │
                    │ (Limit: 500)    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Add Products   │
                    │  Total: 250 UZS │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Process Payment │
                    │  → Credit Tab   │
                    └────────┬────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │         PARTIAL CREDIT DIALOG              │
        │                                            │
        │  Current Balance:    100 UZS              │
        │  Available Credit:   400 UZS              │
        │  Credit Amount:      100 UZS (entered)    │
        │  New Balance:        200 UZS              │
        │  Remaining to Pay:   150 UZS              │
        │                                            │
        │    [Continue with Partial Credit]          │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         CASH/CARD/QR PAYMENT               │
        │                                            │
        │  Remaining: 150 UZS                       │
        │  Cash Received: 200 UZS                   │
        │  Change: 50 UZS                           │
        │                                            │
        │         [Complete Payment]                 │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         BACKEND (complete_pos_order)       │
        │                                            │
        │  1. Validate customer & credit limit      │
        │  2. Create order:                         │
        │     - total_amount: 250                   │
        │     - paid_amount: 150                    │
        │     - credit_amount: 100                  │
        │     - payment_status: 'partial'           │
        │  3. Create payment record:                │
        │     - method: 'cash'                      │
        │     - amount: 150                         │
        │  4. Update customer:                      │
        │     - balance = balance + 100 (credit)    │
        │  5. Update inventory                      │
        │                                            │
        │  ✅ Transaction committed                  │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         RESULT                             │
        │                                            │
        │  ✅ Order: POS-2025-000124                 │
        │  ✅ Customer balance: 200 UZS (was 100)    │
        │  ✅ Paid: 150 UZS (cash)                   │
        │  ✅ Credit: 100 UZS (added to balance)     │
        │  ✅ Modal closed, cart cleared             │
        └────────────────────────────────────────────┘
```

---

## 3. Credit Repayment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CUSTOMERS PAGE                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────────┐
        │         CUSTOMER LIST                      │
        │                                            │
        │  Customer A  │ Balance: 0    │ [No button]│
        │  Customer B  │ Balance: 200  │ [💵 Receive│
        │              │               │   Payment] │
        └────────────────┬───────────────────────────┘
                         │
                         │ Click "Receive Payment"
                         ▼
        ┌────────────────────────────────────────────┐
        │      RECEIVE PAYMENT DIALOG                │
        │                                            │
        │  Customer: Customer B                     │
        │  Current Balance: 200.00 UZS              │
        │                                            │
        │  Payment Amount: [100] UZS                │
        │  Payment Method: [Cash ▼]                 │
        │  Notes: [Partial payment]                 │
        │                                            │
        │  New Balance: 100.00 UZS                  │
        │                                            │
        │         [Receive Payment]                  │
        └────────────────┬───────────────────────────┘
                         │
                         │ Validation
                         ▼
        ┌────────────────────────────────────────────┐
        │         VALIDATION CHECKS                  │
        │                                            │
        │  ✅ Amount > 0? YES (100)                  │
        │  ✅ Amount ≤ Balance? YES (100 ≤ 200)      │
        │  ✅ Customer active? YES                   │
        │                                            │
        │  → Proceed to backend                     │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │    BACKEND (receive_customer_payment)      │
        │                                            │
        │  1. Validate payment amount               │
        │  2. Create payment record:                │
        │     - payment_number: CP-2025-000001      │
        │     - customer_id: [customer_b_id]        │
        │     - amount: 100                         │
        │     - payment_method: 'cash'              │
        │     - notes: 'Partial payment'            │
        │  3. Update customer:                      │
        │     - balance = balance - 100             │
        │     - balance = 200 - 100 = 100           │
        │                                            │
        │  ✅ Transaction committed                  │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         FRONTEND UPDATE                    │
        │                                            │
        │  1. Close dialog                          │
        │  2. Show success toast:                   │
        │     "Payment received successfully.       │
        │      New balance: 100.00 UZS"             │
        │  3. Refresh customer list                 │
        │  4. Call onSuccess() callback             │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         RESULT                             │
        │                                            │
        │  ✅ Payment recorded: CP-2025-000001       │
        │  ✅ Customer balance: 100 UZS (was 200)    │
        │  ✅ Dashboard updated                      │
        │  ✅ Audit trail created                    │
        └────────────────────────────────────────────┘
```

---

## 4. Credit Limit Validation Flow

```
                    ┌─────────────────┐
                    │ Credit Sale     │
                    │ Attempt         │
                    └────────┬────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │         CALCULATE AVAILABLE CREDIT         │
        │                                            │
        │  Credit Limit:     500 UZS                │
        │  Current Balance:  350 UZS                │
        │  ─────────────────────────                │
        │  Available Credit: 150 UZS                │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────────┐
        │         CHECK CREDIT AMOUNT                │
        │                                            │
        │  Requested Credit: 200 UZS                │
        │  Available Credit: 150 UZS                │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
                ┌────────┴────────┐
                │                 │
        200 > 150?              200 ≤ 150?
        YES (FAIL)              NO (PASS)
                │                 │
                ▼                 ▼
    ┌───────────────────┐   ┌──────────────────┐
    │  REJECT SALE      │   │  APPROVE SALE    │
    │                   │   │                  │
    │  ❌ Show error:   │   │  ✅ Create order │
    │  "Credit amount   │   │  ✅ Update       │
    │   exceeds         │   │     balance      │
    │   available       │   │  ✅ Deduct stock │
    │   credit limit"   │   │                  │
    │                   │   │  New Balance:    │
    │  ❌ Order NOT     │   │  350 + 200 = 550 │
    │     created       │   │                  │
    │  ❌ Balance       │   │  (Still within   │
    │     unchanged     │   │   limit if       │
    │  ❌ Modal stays   │   │   approved)      │
    │     open          │   │                  │
    └───────────────────┘   └──────────────────┘
```

---

## 5. State Management Flow (The Fix)

### BEFORE (Broken) ❌

```
handleCreditSale() {
  // ... create order ...
  
  // Cleanup
  setCart([]);
  setPayments([]);
  setDiscount({ type: 'amount', value: 0 });
  // ❌ MISSING: setSelectedCustomer(null);
  setPaymentDialogOpen(false);
  setCashReceived('');
  setCreditAmount('');
}

Result:
❌ selectedCustomer still has old data
❌ UI doesn't refresh balance
❌ Modal doesn't close properly
❌ Next sale shows wrong customer
```

### AFTER (Fixed) ✅

```
handleCreditSale() {
  // ... create order ...
  
  // Cleanup
  setCart([]);
  setPayments([]);
  setDiscount({ type: 'amount', value: 0 });
  setSelectedCustomer(null);  // ✅ ADDED!
  setPaymentDialogOpen(false);
  setCashReceived('');
  setCreditAmount('');
  setSelectedCartIndex(-1);
  
  // Refresh data
  loadCustomers();
}

Result:
✅ All state cleared
✅ UI refreshes correctly
✅ Modal closes automatically
✅ Ready for next sale
```

---

## 6. Component Integration Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         APP.TSX                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
    ┌───────────────────┐       ┌──────────────────┐
    │  POSTerminal.tsx  │       │  Customers.tsx   │
    │                   │       │                  │
    │  - Credit sales   │       │  - Customer list │
    │  - Partial credit │       │  - Receive       │
    │  - State mgmt     │       │    Payment btn   │
    └─────────┬─────────┘       └────────┬─────────┘
              │                          │
              │                          │
              ▼                          ▼
    ┌───────────────────┐       ┌──────────────────┐
    │ PaymentDialog     │       │ ReceivePayment   │
    │                   │       │ Dialog           │
    │ - Cash tab        │       │                  │
    │ - Card tab        │       │ - Amount input   │
    │ - QR tab          │       │ - Method select  │
    │ - Mixed tab       │       │ - Validation     │
    │ - Credit tab ✨   │       │ - Submit ✨      │
    └─────────┬─────────┘       └────────┬─────────┘
              │                          │
              └──────────┬───────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │    @/db/api.ts   │
              │                  │
              │ - completePOS    │
              │   Order()        │
              │ - receiveCustomer│
              │   Payment()      │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  SUPABASE RPCs   │
              │                  │
              │ - complete_pos_  │
              │   order          │
              │ - receive_       │
              │   customer_      │
              │   payment        │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │    DATABASE      │
              │                  │
              │ - orders         │
              │ - customers      │
              │ - customer_      │
              │   payments       │
              │ - order_payments │
              │ - products       │
              └──────────────────┘
```

---

## 7. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    CREDIT SALE DATA FLOW                         │
└─────────────────────────────────────────────────────────────────┘

Frontend State                Backend RPC              Database
─────────────                ────────────              ────────

selectedCustomer  ──────────▶ p_order.customer_id ──▶ orders.customer_id
cart items        ──────────▶ p_items[]           ──▶ order_items
creditAmount      ──────────▶ p_order.credit_amt  ──▶ orders.credit_amount
totalAmount       ──────────▶ p_order.total_amt   ──▶ orders.total_amount

                              │
                              │ RPC Processing
                              │
                              ▼
                         ┌─────────────┐
                         │ Validation  │
                         │ - Customer  │
                         │ - Credit    │
                         │ - Stock     │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │ Transaction │
                         │ BEGIN       │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
              ┌─────────┐ ┌─────────┐ ┌─────────┐
              │ INSERT  │ │ UPDATE  │ │ UPDATE  │
              │ order   │ │customer │ │products │
              │         │ │balance  │ │stock    │
              └─────────┘ └─────────┘ └─────────┘
                    │           │           │
                    └───────────┼───────────┘
                                │
                                ▼
                         ┌─────────────┐
                         │ Transaction │
                         │ COMMIT      │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │ Return JSON │
                         │ - success   │
                         │ - order_id  │
                         │ - new_bal   │
                         └──────┬──────┘
                                │
                                ▼
Frontend Update                 │
───────────────                 │
                                │
toast.success()  ◀──────────────┤
setCart([])      ◀──────────────┤
setSelectedCustomer(null) ◀─────┤  ← THE FIX!
setPaymentDialogOpen(false) ◀───┤
loadCustomers()  ◀──────────────┘
```

---

## 8. Error Handling Flow

```
                    ┌─────────────────┐
                    │ User Action     │
                    └────────┬────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │         FRONTEND VALIDATION                │
        │                                            │
        │  ✓ Customer selected?                     │
        │  ✓ Credit limit exists?                   │
        │  ✓ Amount > 0?                            │
        │  ✓ Amount ≤ available credit?             │
        └────────────────┬───────────────────────────┘
                         │
                ┌────────┴────────┐
                │                 │
            FAIL                PASS
                │                 │
                ▼                 ▼
    ┌───────────────────┐   ┌──────────────────┐
    │  Show Error Toast │   │  Call Backend    │
    │  Keep Modal Open  │   │  RPC             │
    └───────────────────┘   └────────┬─────────┘
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │    BACKEND VALIDATION          │
                    │                                │
                    │  ✓ Customer exists & active?  │
                    │  ✓ Credit limit valid?        │
                    │  ✓ Stock available?           │
                    │  ✓ Transaction safe?          │
                    └────────┬───────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                FAIL                PASS
                    │                 │
                    ▼                 ▼
        ┌───────────────────┐   ┌──────────────────┐
        │  Return Error     │   │  Execute         │
        │  JSON             │   │  Transaction     │
        │  - success: false │   │  - Create order  │
        │  - error: "..."   │   │  - Update bal    │
        └─────────┬─────────┘   │  - Update stock  │
                  │             └────────┬─────────┘
                  │                      │
                  │                      ▼
                  │             ┌──────────────────┐
                  │             │  Return Success  │
                  │             │  JSON            │
                  │             │  - success: true │
                  │             │  - order_id      │
                  │             │  - new_balance   │
                  │             └────────┬─────────┘
                  │                      │
                  └──────────┬───────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │         FRONTEND RESPONSE HANDLER          │
        │                                            │
        │  if (success) {                           │
        │    ✅ Show success toast                   │
        │    ✅ Close modal                          │
        │    ✅ Clear cart                           │
        │    ✅ Reset state                          │
        │  } else {                                 │
        │    ❌ Show error toast                     │
        │    ❌ Keep modal open                      │
        │    ❌ Allow user to fix                    │
        │  }                                        │
        └────────────────────────────────────────────┘
```

---

## Summary

These diagrams illustrate:

1. **Full Credit Sale Flow** - Complete process from selection to completion
2. **Partial Credit Sale Flow** - Mixed payment with credit + cash/card
3. **Credit Repayment Flow** - How customers pay down existing debt
4. **Credit Limit Validation** - How the system enforces credit limits
5. **State Management** - The critical fix that resolved bugs #1 and #2
6. **Component Integration** - How all pieces fit together
7. **Data Flow** - How data moves through the system
8. **Error Handling** - How errors are caught and handled

**Key Takeaway:** The fix was simple (1 line) but critical - proper state cleanup ensures the UI stays in sync with the database.
