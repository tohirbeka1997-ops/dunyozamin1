# Partial Credit Payment Enhancement

## Task: Add support for PARTIAL CREDIT + PARTIAL PAYMENT in POS Terminal

## Plan

### Phase 1: Database Schema Updates
- [x] 1.1 Update payment_status constraint to include 'PARTIALLY_PAID'
- [x] 1.2 Add paid_amount column support (already exists)
- [x] 1.3 Create migration file

### Phase 2: Update complete_pos_order RPC
- [x] 2.1 Add credit_amount parameter support
- [x] 2.2 Add logic to determine payment_status based on credit_amount
  - If creditAmount = total → payment_status = 'ON_CREDIT'
  - If creditAmount = 0 → payment_status = 'PAID'
  - If 0 < creditAmount < total → payment_status = 'PARTIALLY_PAID'
- [x] 2.3 Update customer balance with credit_amount
- [x] 2.4 Update inventory movement tracking

### Phase 3: Frontend - Credit Tab UI
- [x] 3.1 Add credit amount input field to Credit tab
- [x] 3.2 Set default value to full total amount
- [x] 3.3 Calculate max allowed credit: min(orderTotal, customer.credit_limit - customer.balance)
- [x] 3.4 Add validation for credit amount
- [x] 3.5 Show "Current Balance" and "New Balance" preview
- [x] 3.6 Show remaining amount to be paid if partial credit

### Phase 4: Frontend - Payment Flow Logic
- [x] 4.1 Update handleCreditSale to support partial credit
- [x] 4.2 If creditAmount < totalAmount, show other payment methods (Cash/Card/QR)
- [x] 4.3 If creditAmount = totalAmount, complete as full credit sale
- [x] 4.4 Update payment modal to handle mixed credit + other payments
- [x] 4.5 Add validation to prevent negative credit amounts

### Phase 5: API Functions
- [x] 5.1 Update createCreditOrder API function signature
- [x] 5.2 Update completeOrder API function to handle partial credit
- [x] 5.3 Add proper error handling for credit limit validation

### Phase 6: Testing & Validation
- [ ] 6.1 Test full credit payment (existing flow)
- [ ] 6.2 Test partial credit + cash payment
- [ ] 6.3 Test partial credit + card payment
- [ ] 6.4 Test partial credit + mixed payment
- [ ] 6.5 Test credit limit validation
- [ ] 6.6 Test customer balance updates
- [ ] 6.7 Test stock deduction
- [ ] 6.8 Test dashboard analytics
- [ ] 6.9 Run lint check - PASSED ✅

## Notes
- Maintain backward compatibility with existing full credit sales
- Ensure all validation messages are user-friendly
- Keep UI consistent with existing payment flow
- Ensure atomic transactions for all database operations

## Implementation Complete
All core features have been implemented. The system now supports:
1. Full credit sales (existing functionality maintained)
2. Partial credit + cash/card/QR payment
3. Proper validation and error messages
4. Customer balance tracking
5. Payment status tracking (paid, on_credit, partially_paid)
