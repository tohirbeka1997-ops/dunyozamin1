import type { NavigateFunction } from 'react-router-dom';
import { sanitizeReturnTo } from '@/lib/listState';

type LocationLike = {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
};

type NavigationState = {
  backTo?: string;
  returnTo?: string;
  [key: string]: unknown;
};

export function buildCurrentPath(location: LocationLike): string {
  return `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
}

export function createBackNavigationState(
  location: LocationLike,
  extraState?: Record<string, unknown>
): NavigationState {
  const backTo = buildCurrentPath(location);
  return {
    ...(extraState || {}),
    backTo,
    returnTo: backTo,
  };
}

function readReturnToFromSearch(search?: string): string | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    );
    return params.get('returnTo');
  } catch {
    return null;
  }
}

export function resolveBackTarget(location: LocationLike, fallback: string): string {
  const state = location.state as NavigationState | undefined;
  const fromState =
    (typeof state?.backTo === 'string' && state.backTo) ||
    (typeof state?.returnTo === 'string' && state.returnTo) ||
    null;
  const fromQuery = readReturnToFromSearch(location.search);
  return sanitizeReturnTo(fromState || fromQuery, fallback);
}

/**
 * Prefer browser history when the previous internal entry is the same list module;
 * otherwise navigate to sanitized returnTo / fallback.
 */
export function navigateBackTo(
  navigate: NavigateFunction,
  location: LocationLike,
  fallback: string,
) {
  const target = resolveBackTarget(location, fallback);
  const fallbackBase = fallback.split('?')[0] || fallback;
  const targetBase = target.split('?')[0] || target;

  try {
    if (
      typeof window !== 'undefined' &&
      window.history.length > 1 &&
      targetBase === fallbackBase
    ) {
      // Same list module: history.back restores scroll/stack when possible
      const ref = typeof document !== 'undefined' ? document.referrer : '';
      let sameOriginRef = false;
      try {
        if (ref) {
          const u = new URL(ref);
          sameOriginRef = u.origin === window.location.origin;
        }
      } catch {
        sameOriginRef = false;
      }
      if (sameOriginRef) {
        navigate(-1);
        return;
      }
    }
  } catch {
    /* fall through */
  }

  navigate(target);
}
