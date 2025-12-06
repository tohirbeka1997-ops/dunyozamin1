# Sales Returns Module - Complete Fix Plan

## Issues Identified

### 1. Type Mismatch
- `SalesReturn` interface has `refund_method` field
- Database schema does NOT have `refund_method` column
- Need to remove from TypeScript types

### 2. Missing Routes
- Need to add `/sales-returns/:id/edit` route
- Edit page doesn't exist yet

### 3. Missing Functionality
- No Edit functionality
- No Delete functionality with inventory reversal
- No filters on list page
- No status management

### 4. API Functions Needed
- `updateSalesReturn` - for editing
- `deleteSalesReturn` - for deletion with inventory reversal
- `getSalesReturns` - needs filter support

## Implementation Plan

### Phase 1: Fix Types
- [x] Remove `refund_method` from `SalesReturn` interface
- [x] Fix `SalesReturnItem` interface (remove duplicate `total` field)
- [x] Ensure `SalesReturnWithDetails` includes items array

### Phase 2: Fix API Functions
- [ ] Update `getSalesReturnById` to handle errors properly
- [ ] Create `updateSalesReturn` function
- [ ] Create `deleteSalesReturnWithInventory` RPC function
- [ ] Add filter support to `getSalesReturns`

### Phase 3: Create Edit Page
- [ ] Create `EditReturn.tsx` page
- [ ] Add route for `/sales-returns/:id/edit`
- [ ] Allow editing: reason, notes only
- [ ] Show items as read-only

### Phase 4: Add Delete Functionality
- [ ] Create RPC function to reverse inventory
- [ ] Add delete button to list and detail pages
- [ ] Add confirmation dialog
- [ ] Update list after deletion

### Phase 5: Enhance List Page
- [ ] Add filters: status, date range, customer
- [ ] Add Edit and Delete action buttons
- [ ] Add loading skeletons
- [ ] Improve error handling

### Phase 6: Fix Detail Page
- [ ] Display all return information
- [ ] Show items list with product details
- [ ] Add Edit and Delete buttons
- [ ] Show inventory adjustments
- [ ] Add audit information

### Phase 7: Testing
- [ ] Test view return details
- [ ] Test edit return
- [ ] Test delete return
- [ ] Test inventory reversal
- [ ] Test filters
- [ ] Run lint check
