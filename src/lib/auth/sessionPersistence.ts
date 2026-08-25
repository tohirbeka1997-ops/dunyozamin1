/**
 * Remember-aware session persistence.
 *
 * Where the live session (token + cached profile) is stored depends on the
 * "Meni eslab qol" (remember me) choice:
 *   - remember ON  → localStorage  (survives full restart, new tabs, F5)
 *   - remember OFF → sessionStorage (survives F5 in the SAME tab, gone when the
 *                    tab closes; a brand-new tab requires a fresh login)
 *
 * Reads transparently fall back to the other store so tokens written under the
 * legacy "always localStorage" scheme keep working after upgrade.
 *
 * IMPORTANT: the remember flag (`REMEMBER_LOGIN_ENABLED_KEY`) must be set
 * BEFORE the token is written at login time, otherwise the token lands in the
 * wrong store. The login form sets it prior to calling `signIn`.
 */
import { REMEMBER_LOGIN_ENABLED_KEY } from '@/lib/auth/rememberLogin';

function safeLocal(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function isRememberMeEnabled(): boolean {
  try {
    return safeLocal()?.getItem(REMEMBER_LOGIN_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the remember-me intent. Call BEFORE writing the session token. */
export function setRememberMeEnabled(enabled: boolean): void {
  try {
    const ls = safeLocal();
    if (!ls) return;
    if (enabled) ls.setItem(REMEMBER_LOGIN_ENABLED_KEY, '1');
    else ls.removeItem(REMEMBER_LOGIN_ENABLED_KEY);
  } catch {
    // ignore
  }
}

/** The store a freshly written session value should live in. */
function primaryStore(): Storage | null {
  return isRememberMeEnabled() ? safeLocal() : safeSession();
}

function allStores(): Storage[] {
  const out: Storage[] = [];
  const ls = safeLocal();
  const ss = safeSession();
  if (ls) out.push(ls);
  if (ss) out.push(ss);
  return out;
}

/**
 * Read a session value, preferring the store implied by remember-me but
 * falling back to the other (back-compat with the old always-localStorage
 * token, and so a same-tab reload still finds a sessionStorage token).
 */
export function readSessionValue(key: string): string | null {
  const ls = safeLocal();
  const ss = safeSession();
  const ordered = isRememberMeEnabled() ? [ls, ss] : [ss, ls];
  for (const store of ordered) {
    if (!store) continue;
    try {
      const v = store.getItem(key);
      if (v != null) return v;
    } catch {
      // ignore
    }
  }
  return null;
}

/** Write a session value to the remember-aware store; clear it from the other. */
export function writeSessionValue(key: string, value: string): void {
  const target = primaryStore();
  try {
    target?.setItem(key, value);
  } catch {
    // ignore
  }
  for (const store of allStores()) {
    if (store === target) continue;
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/** Remove a session value from BOTH stores. */
export function removeSessionValue(key: string): void {
  for (const store of allStores()) {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
  }
}
