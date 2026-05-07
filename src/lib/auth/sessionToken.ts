/**
 * Centralized session-token guard used by route protectors.
 *
 * Returns `true` if the runtime is allowed to be considered "logged in"
 * given current `posApi._session` state. In Electron (no `_session` helper)
 * we trust React state. In remote/web mode we require an actual token so
 * that wiped localStorage forces a real re-login.
 */
export function hasSessionTokenIfRequired(): boolean {
  if (typeof window === 'undefined') return true;
  const api = (window as unknown as { posApi?: { _session?: { hasToken?: () => boolean } } }).posApi;
  if (!api?._session || typeof api._session.hasToken !== 'function') {
    return true;
  }
  return !!api._session.hasToken();
}
