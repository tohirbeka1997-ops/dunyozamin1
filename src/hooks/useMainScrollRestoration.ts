import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type Options = {
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  /** When false, skip main scroll tracking (e.g. virtualized inner container). */
  enabled?: boolean;
  /** Restore only after list data is ready. */
  ready?: boolean;
  anchorRef?: RefObject<Element | null>;
};

export function getMainScrollContainer(anchor?: Element | null): HTMLElement | null {
  return (anchor?.closest('main') ?? document.querySelector('main')) as HTMLElement | null;
}

/** Save and restore scroll position on the layout `<main>` scroll container. */
export function useMainScrollRestoration({
  scrollTop,
  setScrollTop,
  enabled = true,
  ready = true,
  anchorRef,
}: Options) {
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const root = getMainScrollContainer(anchorRef?.current ?? null);
    if (!root) return;
    const onScroll = () => setScrollTop(root.scrollTop);
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [enabled, setScrollTop, anchorRef]);

  useLayoutEffect(() => {
    if (!enabled || !ready) return;
    const main = getMainScrollContainer(anchorRef?.current ?? null);
    if (!main || scrollTop <= 0 || restoredRef.current) return;
    main.scrollTop = scrollTop;
    restoredRef.current = true;
  }, [enabled, ready, scrollTop, anchorRef]);

  const saveScroll = () => {
    const main = getMainScrollContainer(anchorRef?.current ?? null);
    if (main) setScrollTop(main.scrollTop);
  };

  const resetRestoreFlag = () => {
    restoredRef.current = false;
  };

  return { saveScroll, resetRestoreFlag };
}
