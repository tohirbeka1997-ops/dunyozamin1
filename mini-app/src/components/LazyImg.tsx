import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveProductImageUrl } from '../lib/productImageUrl';

/**
 * Drop-in lazy <img> with a shimmer skeleton placeholder.
 *
 * - Uses native `loading="lazy"` plus IntersectionObserver as a belt-and-
 *   braces fallback (Safari ignored `loading="lazy"` for many years).
 * - Skeleton stays in place until the actual image fires `onLoad`.
 * - Falls back to a small "no image" tile if the URL fails to load.
 */
export function LazyImg({
  src,
  alt,
  className,
  imgClassName,
  fallback,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  imgClassName?: string;
  fallback?: React.ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [inView, setInView] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const resolvedSrc = useMemo(() => resolveProductImageUrl(src), [src]);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [resolvedSrc]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: '120px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className || ''}`}>
      {!loaded || errored ? (
        <div className="dz-shimmer absolute inset-0" aria-hidden />
      ) : null}
      {errored || !resolvedSrc ? (
        <div className="absolute inset-0 flex items-center justify-center text-2xl text-[var(--brand-primary)]/40">
          {fallback ?? '🌿'}
        </div>
      ) : inView ? (
        <img
          src={resolvedSrc}
          alt={alt || ''}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={`relative h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${imgClassName || ''}`}
        />
      ) : null}
    </div>
  );
}
