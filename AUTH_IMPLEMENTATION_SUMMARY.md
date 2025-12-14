# Authentication Implementation Summary

## Overview
Complete authentication and authorization system implemented using Zustand store, Supabase Auth, and Row Level Security (RLS).

## Files Created

### Frontend Files
1. **`src/store/useAuth.ts`** - Zustand auth store
   - Manages session, user, profile, role state
   - Actions: `init()`, `signIn()`, `signUp()`, `signOut()`, `refreshProfile()`
   - Auto-derives role from profile (defaults to 'cashier')

2. **`src/api/supabaseAuth.ts`** - Typed Supabase auth API wrapper
   - `getSession()`, `signIn()`, `signUp()`, `signOut()`
   - `fetchProfile()`, `ensureProfileForUser()`, `updateProfile()`
   - Handles profile creation with "first user = admin" logic

3. **`src/components/auth/ProtectedRoute.tsx`** - Route protection component
   - Redirects to `/login` if not authenticated
   - Redirects to `/forbidden` if role not allowed
   - Shows loading spinner during auth check

4. **`src/components/auth/RoleGate.tsx`** - Conditional UI rendering by role
   - Shows/hides UI blocks based on user role
   - Supports fallback content

5. **`src/pages/RegisterPage.tsx`** - User registration page
   - Email/password signup
   - Auto-creates profile on signup
   - Auto-logs in after successful signup

6. **`src/pages/ForbiddenPage.tsx`** - Access denied page
   - Shown when user lacks required role

### Backend Files
7. **`supabase/sql/auth_profiles_rls.sql`** - RLS policies and helper functions
   - RLS for `profiles` table
   - RLS for `store_members` table
   - Helper functions: `is_store_member()`, `is_store_admin()`, `get_user_store_role()`
   - RPC function: `ensure_profile_for_user()` (for first user = admin logic)

## Files Modified

1. **`src/App.tsx`**
   - Removed `AuthProvider` (old Context API)
   - Updated to use `ProtectedRoute` component
   - Updated `PublicRoute` to use Zustand store

2. **`src/main.tsx`**
   - Added `AuthInitializer` component to call `useAuthStore.init()` on app start

3. **`src/routes.tsx`**
   - Added `/register` route
   - Added `/forbidden` route

4. **`src/pages/Login.tsx`**
   - Updated to use `useAuthStore` instead of `useAuth` context
   - Removed i18n dependencies (using Uzbek text directly)
   - Updated all UI text to Uzbek

5. **`src/components/layout/MainLayout.tsx`**
   - Updated to use `useAuthStore`
   - Uses `profile` and `role` from store

## Key Features

### Authentication Flow
1. **App Initialization**: `useAuthStore.init()` called in `main.tsx`
   - Loads existing session
   - Subscribes to auth state changes
   - Fetches profile from `public.profiles`

2. **Sign Up**:
   - Creates auth user via Supabase Auth
   - Calls `ensureProfileForUser()` to create profile
   - First user gets 'admin' role, others get 'cashier'
   - Auto-logs in after signup

3. **Sign In**:
   - Authenticates via Supabase Auth
   - Fetches profile
   - Ensures profile exists (creates if missing)

4. **Sign Out**:
   - Signs out from Supabase Auth
   - Clears all browser storage (localStorage, sessionStorage, IndexedDB, caches)
   - Resets auth state

### Role Management
- **Global Role**: Stored in `profiles.role` ('admin', 'cashier', 'manager')
- **Store Role**: Stored in `store_members.role` (store-specific)
- **Role Derivation**: Prefers `profiles.role`, defaults to 'cashier' if missing

### Route Protection
- **Protected Routes**: Use `<ProtectedRoute allowedRoles={['admin']}>`
- **Public Routes**: Use `<PublicRoute>` (redirects if logged in)
- **Role-Based Access**: Routes can specify `allowedRoles` in `routes.tsx`

## Database Schema

### `public.profiles`
- `id` (uuid, PK, FK → `auth.users(id)`)
- `username` (text, unique)
- `full_name` (text, nullable)
- `email` (text, nullable)
- `role` (text: 'admin' | 'cashier' | 'manager')
- `is_active` (boolean)
- `created_at`, `updated_at` (timestamptz)

### `public.store_members`
- `id` (uuid, PK)
- `store_id` (uuid, FK → `stores(id)`)
- `user_id` (uuid, FK → `auth.users(id)`) ✅ **Correctly references auth.users**
- `role` (store_role: 'owner' | 'admin' | 'manager' | 'cashier')
- `is_active` (boolean)
- `joined_at` (timestamptz)
- UNIQUE(store_id, user_id)

## RLS Policies

### `profiles` Table
- Users can SELECT/UPDATE their own profile (`auth.uid() = id`)
- Users can INSERT their own profile (during signup)
- Admins can SELECT/UPDATE all profiles

### `store_members` Table
- Users can SELECT their own memberships (`auth.uid() = user_id`)
- Store admins/owners can SELECT all members in their stores
- Store admins/owners can INSERT/UPDATE/DELETE members

## Important Notes

1. **No `public.users` table**: Only `auth.users` exists. `store_members.user_id` correctly references `auth.users(id)`.

2. **Profile Creation**: 
   - First user automatically gets 'admin' role
   - Subsequent users get 'cashier' role
   - Profile is created via `ensureProfileForUser()` RPC or frontend API

3. **FK Consistency**: 
   - `profiles.id` → `auth.users(id)`
   - `store_members.user_id` → `auth.users(id)`
   - Both correctly reference `auth.users`, not a non-existent `public.users` table

4. **Environment Variables**:
   - `VITE_SUPABASE_URL` - Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key (frontend-safe)

5. **Service Role Key**: NEVER used in frontend. Only ANON key is used.

## How to Apply

### 1. Run RLS SQL
Execute `supabase/sql/auth_profiles_rls.sql` in Supabase SQL Editor:
```sql
-- Copy and paste the entire file content
```

### 2. Test Authentication
1. Start the app: `npm run dev`
2. Navigate to `/register`
3. Create first user (will be admin)
4. Create second user (will be cashier)
5. Test login/logout
6. Test protected routes

### 3. Verify RLS
1. Try accessing profiles via Supabase client
2. Verify users can only see their own profile
3. Verify admins can see all profiles

## Remaining Work

Some files still use the old `useAuth()` from `@/contexts/AuthContext`:
- `src/pages/Settings.tsx`
- `src/pages/POSTerminal.tsx`
- `src/pages/OrderDetail.tsx`
- `src/pages/CreateReturn.tsx`
- `src/pages/PurchaseOrderForm.tsx`
- `src/components/suppliers/PaySupplierDialog.tsx`
- `src/pages/Expenses.tsx`
- `src/components/expenses/ExpenseFormDialog.tsx`
- `src/components/pos/ShiftControl.tsx`
- `src/components/ProtectedRoute.tsx` (old file, can be deleted)

These can be updated incrementally. The old `AuthContext` can be removed once all files are migrated.

## Testing Checklist

- [ ] First user signup creates admin profile
- [ ] Second user signup creates cashier profile
- [ ] Login works with existing users
- [ ] Logout clears all storage
- [ ] Protected routes redirect to login when not authenticated
- [ ] Role-based routes redirect to `/forbidden` when role not allowed
- [ ] Profile is fetched on app load
- [ ] Profile is refreshed on auth state change
- [ ] RLS policies prevent unauthorized access


