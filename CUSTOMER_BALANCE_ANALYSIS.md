# Customer Balance Analysis & Fix

## 📊 Current State Analysis

### 1️⃣ **Balance Storage - ✅ CORRECT**

**Database Schema:**
- `customers` jadvalida `balance numeric DEFAULT 0` ustuni mavjud
- Migration: `00008_update_customers_table.sql` (line 64)
- TypeScript interface: `Customer.balance: number` ✅

**Conclusion:** ✅ Variant A ishlatilmoqda - `customers.balance` ustunida

---

### 2️⃣ **Balance Update on Sale - ❌ PROBLEM FOUND**

**Problem:** `completePOSOrder` funksiyasida customer balance **yangilanmayapti**!

**Current Code (src/db/api.ts:1035-1087):**
```typescript
export const completePOSOrder = async (...) => {
  // ... order yaratiladi
  // ... items saqlanadi  
  // ... payments saqlanadi
  // ❌ BALANCE YANGILANMAYAPTI!
  
  return {
    id: orderId,
    order_number: orderNumber,
    message: 'Order completed successfully',
  };
};
```

**What Should Happen:**
- Agar `order.customer_id` bor bo'lsa VA `credit_amount > 0` bo'lsa
- `customers.balance` ni yangilash kerak: `balance = balance + credit_amount`

---

### 3️⃣ **Customers Page Display - ✅ CORRECT**

**Code (src/pages/Customers.tsx:288):**
```typescript
<TableCell className="text-right">
  {getBalanceBadge(Number(customer.balance))}
</TableCell>
```

**getBalanceBadge function (line 125-133):**
```typescript
const getBalanceBadge = (balance: number) => {
  if (balance > 0) {
    return <Badge variant="destructive">${balance.toFixed(2)} Qarz</Badge>;
  } else if (balance < 0) {
    return <Badge className="bg-success">${Math.abs(balance).toFixed(2)} Avans</Badge>;
  } else {
    return <Badge variant="outline">$0.00</Badge>;
  }
};
```

**Issue:** Badge'da `$` ishlatilgan, lekin UZS bo'lishi kerak. Bu kichik UI muammo.

**getCustomers API (src/db/api.ts:729):**
- `balance` ustunini to'g'ri o'qiyapti ✅
- Filter qilishda `balance` ni tekshiradi ✅

---

### 4️⃣ **Credit Sale Flow - ⚠️ PARTIAL**

**POS Terminal (src/pages/POSTerminal.tsx:1192-1280):**

**Partial Payment Flow:**
- Order yaratiladi `createOrder()` orqali
- Lekin `completePOSOrder` ichida balance yangilanmayapti ❌

**Full Credit Flow:**
- `createCreditOrder()` funksiyasi ishlatiladi
- Bu funksiyani tekshirish kerak

---

## 🔧 Required Fixes

### Fix 1: Update `completePOSOrder` to update customer balance

**File:** `src/db/api.ts`

**Location:** After line 1080 (after saving payments)

**Add:**
```typescript
// Update customer balance if credit sale
if (order.customer_id) {
  const paidAmount = orderPayments
    .filter(p => p.payment_method !== 'credit')
    .reduce((sum, p) => sum + p.amount, 0);
  
  const creditAmount = fullOrder.total_amount - paidAmount;
  
  if (creditAmount > 0) {
    const customers = getStoredCustomers();
    const customerIndex = customers.findIndex(c => c.id === order.customer_id);
    
    if (customerIndex >= 0) {
      customers[customerIndex] = {
        ...customers[customerIndex],
        balance: (customers[customerIndex].balance || 0) + creditAmount,
        total_sales: (customers[customerIndex].total_sales || 0) + fullOrder.total_amount,
        total_orders: (customers[customerIndex].total_orders || 0) + 1,
        last_order_date: createdAt,
        updated_at: createdAt,
      };
      saveCustomers(customers);
    }
  }
}
```

### Fix 2: Fix Currency Display in Customers Page

**File:** `src/pages/Customers.tsx`

**Location:** Line 127, 129, 131

**Change:**
```typescript
const getBalanceBadge = (balance: number) => {
  if (balance > 0) {
    return <Badge variant="destructive">{balance.toLocaleString('uz-UZ')} so'm Qarz</Badge>;
  } else if (balance < 0) {
    return <Badge className="bg-success text-success-foreground">{Math.abs(balance).toLocaleString('uz-UZ')} so'm Avans</Badge>;
  } else {
    return <Badge variant="outline">0.00 so'm</Badge>;
  }
};
```

**Also fix line 285:**
```typescript
<TableCell className="text-right font-medium">
  {Number(customer.total_sales).toLocaleString('uz-UZ')} so'm
</TableCell>
```

### Fix 3: Verify `createCreditOrder` function

**Action:** Check if `createCreditOrder` properly updates balance (if exists)

---

## 🧪 Testing Checklist

After fixes:

1. ✅ Create a credit sale (full credit)
   - Select customer
   - Add items
   - Complete sale with credit payment
   - Check customer balance updated

2. ✅ Create a partial payment sale
   - Select customer  
   - Add items
   - Pay partial amount (e.g., 50% cash, 50% credit)
   - Check customer balance = old balance + credit amount

3. ✅ Check Customers page
   - Balance shows correctly
   - Currency format is "so'm" not "$"
   - Filter by debt works

4. ✅ Verify balance persists
   - Refresh page
   - Check balance still correct

---

## 📝 Summary

| Component | Status | Issue |
|-----------|--------|-------|
| Database Schema | ✅ OK | `customers.balance` exists |
| Balance Reading | ✅ OK | `getCustomers()` reads balance |
| Balance Display | ⚠️ UI Issue | Uses `$` instead of `so'm` |
| Balance Update (Credit Sale) | ❌ **BROKEN** | `completePOSOrder` doesn't update balance |
| Balance Update (Partial) | ❌ **BROKEN** | Same issue |

**Critical Fix Needed:** Update `completePOSOrder` to increment customer balance when credit amount > 0.





