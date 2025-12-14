# Shift Schema Fix Summary

## Problem
Frontend was referencing database columns that don't exist:
- ❌ `cashier_id` (should be `opened_by`)
- ❌ `shift_number` (does not exist in actual schema)

**Runtime Errors:**
- "Could not find the cashier_id column of shifts"
- "Could not find the shift_number column of shifts"

## Actual Database Schema
The `shifts` table has these columns:
- `id` (uuid)
- `store_id` (uuid, NOT NULL)
- `opened_by` (uuid, NOT NULL) - **NOT cashier_id**
- `opened_at` (timestamptz, NOT NULL)
- `closed_at` (timestamptz, nullable)
- `status` (text: 'open' | 'closed')
- `opening_cash` (numeric, NOT NULL)
- `closing_cash` (numeric, nullable)
- `notes` (text, nullable)
- `location_id` (uuid, nullable) - optional

**Note:** `shift_number` does NOT exist in the actual schema.

## Changes Made

### File: `src/store/shiftStore.ts`

#### 1. Removed `generateShiftNumber` function
**Lines 57-64 (REMOVED):**
```typescript
// REMOVED - shift_number doesn't exist in database
const generateShiftNumber = (): string => {
  const year = new Date().getFullYear();
  const timestamp = Date.now();
  return `SHIFT-${year}-${timestamp}`;
};
```

#### 2. Fixed `loadActiveShift` query
**Before:**
```typescript
.select('id, store_id, location_id, shift_number, cashier_id, opened_at, closed_at, opening_cash, closing_cash, status, notes')
.eq('cashier_id', userId)
```

**After:**
```typescript
.select('id, store_id, location_id, opened_by, opened_at, closed_at, opening_cash, closing_cash, status, notes')
.eq('opened_by', userId)
```

#### 3. Fixed shift mapping in `loadActiveShift`
**Before:**
```typescript
opened_by: data.cashier_id,  // ❌ Wrong column name
```

**After:**
```typescript
opened_by: data.opened_by,  // ✅ Correct column name
```

#### 4. Fixed `openShift` insert payload
**Before:**
```typescript
const shiftNumber = generateShiftNumber();  // ❌ Removed

.insert({
  store_id: storeId,
  shift_number: shiftNumber,  // ❌ Column doesn't exist
  cashier_id: userId,         // ❌ Wrong column name
  opened_at: new Date().toISOString(),
  opening_cash: openingCash,
  status: 'open',
})
.select('id, store_id, location_id, shift_number, cashier_id, opened_at, closed_at, opening_cash, closing_cash, status')
```

**After:**
```typescript
// ✅ Exact schema match - NO extra fields
.insert({
  store_id: storeId,
  opened_by: userId,  // ✅ Correct column name
  opened_at: new Date().toISOString(),
  status: 'open',
  opening_cash: openingCash,
})
.select('id, store_id, location_id, opened_by, opened_at, closed_at, opening_cash, closing_cash, status')
```

#### 5. Fixed shift mapping in `openShift`
**Before:**
```typescript
opened_by: data.cashier_id,  // ❌ Wrong column name
```

**After:**
```typescript
opened_by: data.opened_by,  // ✅ Correct column name
```

## Final Shift Creation Payload

The shift creation now sends **exactly** these fields (matching database schema):

```typescript
{
  store_id: string,           // REQUIRED
  opened_by: string,          // REQUIRED (user.id) - NOT cashier_id
  opened_at: string,          // REQUIRED (ISO timestamp)
  status: 'open',             // REQUIRED
  opening_cash: number        // REQUIRED
}
```

**No extra fields are sent:**
- ❌ `shift_number` - removed (doesn't exist)
- ❌ `cashier_id` - replaced with `opened_by`
- ❌ `location_id` - not included in insert (optional, can be null)

## Verification

✅ All `cashier_id` references in shift operations replaced with `opened_by`  
✅ All `shift_number` references removed  
✅ Shift creation payload matches exact database schema  
✅ Shift queries use correct column names  
✅ No linter errors  

## Files Changed

1. **src/store/shiftStore.ts** - Main shift store file
   - Removed `generateShiftNumber()` function
   - Updated all queries to use `opened_by` instead of `cashier_id`
   - Removed `shift_number` from all selects and inserts
   - Fixed shift creation payload to match exact schema

## Testing Checklist

- [ ] Open a new shift - should work without errors
- [ ] Load active shift - should work without errors
- [ ] Close shift - should work without errors
- [ ] Verify no console errors about missing columns
- [ ] Verify shift is created in database with correct columns

## Notes

- The `Shift` type in `src/types/shift.ts` already has the correct structure (`opened_by`, no `shift_number`)
- The `Shift` interface in `src/types/database.ts` still has old fields, but it's not used in the codebase (shiftStore imports from `@/types/shift`)
- All shift operations now match the actual database schema exactly

