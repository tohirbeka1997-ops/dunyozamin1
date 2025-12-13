// Mock Authentication API - No backend required
// Pure client-side localStorage-based authentication

export type AuthRole = 'admin' | 'cashier';

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: AuthRole;
};

const STORAGE_KEY = 'pos_auth_user';

/**
 * Read stored user from localStorage
 */
export function getStoredUser(): AuthUser | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as AuthUser;
    // Validate structure
    if (parsed.id && parsed.email && parsed.full_name && parsed.role) {
      return parsed;
    }
    return null;
  } catch (error) {
    console.error('Error reading stored user:', error);
    return null;
  }
}

/**
 * Sign in with mock authentication
 * No real backend - just creates a user object based on email
 */
export async function signInMock(email: string, _password: string): Promise<AuthUser> {
  // Artificial delay to simulate API call
  await new Promise(resolve => setTimeout(resolve, 300));

  // Determine role based on email
  const role: AuthRole = email.toLowerCase().includes('admin') ? 'admin' : 'cashier';

  // Generate ID
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Extract name from email or use default
  const emailName = email.split('@')[0];
  const full_name = emailName
    .split(/[._-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'User';

  const user: AuthUser = {
    id,
    email,
    full_name,
    role,
  };

  // Persist to localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));

  return user;
}

/**
 * Sign out - remove user from localStorage
 */
export async function signOutMock(): Promise<void> {
  // Artificial delay
  await new Promise(resolve => setTimeout(resolve, 150));
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Sign up with mock authentication
 */
export async function signUpMock(
  email: string,
  password: string,
  fullName?: string,
  _username?: string
): Promise<AuthUser> {
  // Artificial delay to simulate API call
  await new Promise(resolve => setTimeout(resolve, 300));

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Validate password length
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Determine role based on email
  const role: AuthRole = email.toLowerCase().includes('admin') ? 'admin' : 'cashier';

  // Generate ID
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Use provided fullName or extract from email
  const full_name = fullName || email.split('@')[0]
    .split(/[._-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'User';

  const user: AuthUser = {
    id,
    email,
    full_name,
    role,
  };

  // Persist to localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));

  return user;
}

const RESET_TOKEN_KEY = 'pos_reset_token';
const RESET_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Request password reset - stores a token in localStorage
 */
export async function resetPasswordRequest(email: string): Promise<void> {
  // Artificial delay
  await new Promise(resolve => setTimeout(resolve, 300));

  // In a real app, this would send an email
  // For mock, we store a token in localStorage
  const token = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const tokenData = {
    email,
    token,
    expiresAt: Date.now() + RESET_TOKEN_EXPIRY,
  };

  localStorage.setItem(RESET_TOKEN_KEY, JSON.stringify(tokenData));
}

/**
 * Reset password with token
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<void> {
  // Artificial delay
  await new Promise(resolve => setTimeout(resolve, 300));

  // Validate password length
  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Get token from localStorage
  const stored = localStorage.getItem(RESET_TOKEN_KEY);
  if (!stored) {
    throw new Error('Invalid or expired reset token');
  }

  const tokenData = JSON.parse(stored) as {
    email: string;
    token: string;
    expiresAt: number;
  };

  // Check if token matches and is not expired
  if (tokenData.token !== token || Date.now() > tokenData.expiresAt) {
    localStorage.removeItem(RESET_TOKEN_KEY);
    throw new Error('Invalid or expired reset token');
  }

  // In mock auth, password is not actually stored
  // We just validate the token and clear it
  // The user can then log in with the new password (which will work since mock doesn't check passwords)
  // Clear the token after successful validation
  localStorage.removeItem(RESET_TOKEN_KEY);
}

/**
 * Get reset token from URL or localStorage
 */
export function getResetTokenFromStorage(): string | null {
  const stored = localStorage.getItem(RESET_TOKEN_KEY);
  if (!stored) return null;

  const tokenData = JSON.parse(stored) as {
    email: string;
    token: string;
    expiresAt: number;
  };

  if (Date.now() > tokenData.expiresAt) {
    localStorage.removeItem(RESET_TOKEN_KEY);
    return null;
  }

  return tokenData.token;
}








