# Customer Create - Testing Guide

## Quick Test Steps

### Test 1: Create Individual Customer
1. Go to **Customers** page
2. Click **"Add Customer"**
3. Fill in:
   - Name: `John Doe`
   - Type: `Individual`
   - Phone: `+998901234567`
   - Email: `john@example.com`
   - Status: `Active`
4. Click **"Create Customer"**
5. **Expected**: Success toast + redirect to list + customer visible

### Test 2: Create Company Customer
1. Go to **Customers** page
2. Click **"Add Customer"**
3. Fill in:
   - Name: `ABC Corporation`
   - Type: `Company`
   - Company Name: `ABC Corp Ltd`
   - Tax Number: `1234567890`
   - Phone: `+998901234568`
   - Email: `info@abc.com`
   - Status: `Active`
4. Click **"Create Customer"**
5. **Expected**: Success toast + redirect to list + customer visible

### Test 3: Validation - Empty Name
1. Go to **Customers** page
2. Click **"Add Customer"**
3. Leave Name empty
4. Click **"Create Customer"**
5. **Expected**: Validation error toast "Customer name is required"

### Test 4: Validation - Company Without Company Name
1. Go to **Customers** page
2. Click **"Add Customer"**
3. Fill in:
   - Name: `Test Company`
   - Type: `Company`
   - (Leave Company Name empty)
4. Click **"Create Customer"**
5. **Expected**: Validation error toast "Company name is required for company type"

### Test 5: View Customer Details
1. Go to **Customers** page
2. Click on a customer row
3. **Expected**: Customer detail page opens with all information displayed correctly

### Test 6: Edit Customer
1. Go to **Customers** page
2. Click on a customer row
3. Click **"Edit"** button
4. Change some fields
5. Click **"Save"**
6. **Expected**: Success toast + redirect + changes visible

## Browser Console Check

Open browser console (F12) and check for:
- ❌ No errors should appear
- ❌ No "Failed to save customer" messages
- ✅ Should see successful API responses

## Database Verification

After creating a customer, check in Supabase dashboard:
1. Go to Table Editor → customers
2. Find the newly created customer
3. Verify all fields are saved correctly:
   - ✅ name
   - ✅ phone
   - ✅ email
   - ✅ type
   - ✅ company_name (if company)
   - ✅ tax_number (if provided)
   - ✅ status
   - ✅ balance (should be 0)
   - ✅ total_sales (should be 0)

## Common Issues to Check

### If customer creation fails:
1. Check browser console for errors
2. Check Network tab for API response
3. Verify Supabase connection
4. Check if required fields are filled

### If validation doesn't work:
1. Verify form fields are not empty
2. Check if validation messages appear
3. Verify form doesn't submit when invalid

### If redirect doesn't work:
1. Check if success toast appears
2. Verify navigation to /customers
3. Check if customer appears in list

## Success Criteria

✅ All 6 tests pass
✅ No console errors
✅ Data saves to database correctly
✅ Validation works as expected
✅ Navigation works correctly
✅ All fields display correctly

## Quick Verification Command

```bash
# Check TypeScript compilation
npm run lint

# Expected output:
# Checked 108 files in ~300ms. No fixes applied.
# Exit code: 0
```

## Status Checklist

- [ ] Test 1: Create Individual Customer
- [ ] Test 2: Create Company Customer
- [ ] Test 3: Validation - Empty Name
- [ ] Test 4: Validation - Company Without Company Name
- [ ] Test 5: View Customer Details
- [ ] Test 6: Edit Customer
- [ ] No console errors
- [ ] Database verification
- [ ] All fields save correctly

## Notes

- Phone format: `+998 XX XXX XX XX` (Uzbekistan format)
- Tax Number: Any alphanumeric string
- Status: Active or Inactive
- Type: Individual or Company

---

**Ready to test!** 🚀
