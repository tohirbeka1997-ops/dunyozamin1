import type { NavigateFunction } from 'react-router-dom';

type LocationLike = {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
};

type NavigationState = {
  backTo?: string;
  [key: string]: unknown;
};

export function buildCurrentPath(location: LocationLike): string {
  return `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
}

export function createBackNavigationState(
  location: LocationLike,
  extraState?: Record<string, unknown>
): NavigationState {
  return {
    ...(extraState || {}),
    backTo: buildCurrentPath(location),
  };
}

export function resolveBackTarget(location: LocationLike, fallback: string): string {
  const candidate = (location.state as NavigationState | undefined)?.backTo;
  if (typeof candidate === 'string' && candidate.startsWith('/')) {
    return candidate;
  }
  return fallback;
}

export function navigateBackTo(
  navigate: NavigateFunction,
  location: LocationLike,
  fallback: string
) {
  navigate(resolveBackTarget(location, fallback));
}
