import React from 'react';

/**
 * Splits `text` into segments based on `query` matches and returns a ReactNode
 * with matching parts wrapped in a <mark> element.
 */
export function highlightMatch(
  text: string,
  query: string,
  className = 'bg-yellow-200/80 text-gray-900 dark:bg-yellow-500/40 dark:text-white px-0.5 rounded font-medium'
): React.ReactNode {
  const raw = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q) return raw;

  // Build a regex from all whitespace-separated tokens so multi-word queries work
  const tokens = q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (tokens.length === 0) return raw;

  const pattern = new RegExp(`(${tokens.join('|')})`, 'gi');
  const parts = raw.split(pattern);

  if (parts.length === 1) return raw;

  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark key={i} className={className}>
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

/**
 * Returns true if `text` contains the query (case-insensitive, token-based).
 */
export function matchesQuery(text: string, query: string): boolean {
  const raw = String(text ?? '').toLowerCase();
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).every((token) => raw.includes(token));
}
