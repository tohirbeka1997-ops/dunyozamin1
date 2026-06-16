/** Keys persisted across logout — username/tenant only, never password. */
export const REMEMBER_LOGIN_ENABLED_KEY = 'pos:remember_login';
export const REMEMBER_LOGIN_IDENTIFIER_KEY = 'pos:remembered_identifier';
export const REMEMBER_LOGIN_TENANT_KEY = 'pos:remembered_tenant';

/** All remember-login keys — preserved when clearing storage on sign-out. */
export const REMEMBER_LOGIN_STORAGE_KEYS = [
  REMEMBER_LOGIN_ENABLED_KEY,
  REMEMBER_LOGIN_IDENTIFIER_KEY,
  REMEMBER_LOGIN_TENANT_KEY,
] as const;

export type RememberedLogin = {
  enabled: boolean;
  identifier: string;
  tenant: string;
};

export function loadRememberedLogin(): RememberedLogin {
  try {
    const enabled = localStorage.getItem(REMEMBER_LOGIN_ENABLED_KEY) === '1';
    const identifier = localStorage.getItem(REMEMBER_LOGIN_IDENTIFIER_KEY) || '';
    const tenant = localStorage.getItem(REMEMBER_LOGIN_TENANT_KEY) || '';
    return { enabled, identifier, tenant };
  } catch {
    return { enabled: false, identifier: '', tenant: '' };
  }
}

export function saveRememberedLogin(
  enabled: boolean,
  identifier: string,
  tenant?: string | null,
): void {
  try {
    if (!enabled) {
      clearRememberedLogin();
      return;
    }
    localStorage.setItem(REMEMBER_LOGIN_ENABLED_KEY, '1');
    localStorage.setItem(REMEMBER_LOGIN_IDENTIFIER_KEY, identifier.trim());
    const trimmedTenant = (tenant || '').trim().toLowerCase();
    if (trimmedTenant) localStorage.setItem(REMEMBER_LOGIN_TENANT_KEY, trimmedTenant);
    else localStorage.removeItem(REMEMBER_LOGIN_TENANT_KEY);
  } catch {
    // localStorage may be unavailable — fail silently
  }
}

export function clearRememberedLogin(): void {
  try {
    for (const key of REMEMBER_LOGIN_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function snapshotRememberLoginStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const key of REMEMBER_LOGIN_STORAGE_KEYS) {
      const value = localStorage.getItem(key);
      if (value != null) out[key] = value;
    }
  } catch {
    // ignore
  }
  return out;
}

export function restoreRememberLoginStorage(snapshot: Record<string, string>): void {
  try {
    for (const [key, value] of Object.entries(snapshot)) {
      if ((REMEMBER_LOGIN_STORAGE_KEYS as readonly string[]).includes(key)) {
        localStorage.setItem(key, value);
      }
    }
  } catch {
    // ignore
  }
}
