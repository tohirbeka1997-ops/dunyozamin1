// src/db/auth-mock.ts
export type AuthRole = 'admin' | 'cashier';

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: AuthRole;
};

const STORAGE_KEY = 'pos_auth_user';

// LocalStorage-dan userni o‘qish
export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

// Fake login
export async function signInMock(email: string, _password: string): Promise<AuthUser> {
  // Demo uchun oddiy qoidalar:
  // agar email "admin" bo'lsa -> admin, aks holda cashier
  const role: AuthRole = email.toLowerCase().includes('admin') ? 'admin' : 'cashier';

  const user: AuthUser = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    email,
    full_name: role === 'admin' ? 'Admin User' : 'Kassir User',
    role,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));

  // biroz kechikish beramiz (UX uchun)
  await new Promise((r) => setTimeout(r, 300));

  return user;
}

// Logout
export async function signOutMock(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  await new Promise((r) => setTimeout(r, 150));
}
