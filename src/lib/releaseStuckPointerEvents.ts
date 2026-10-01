/**
 * Radix dialogs set document.body.style.pointerEvents = "none" and
 * aria-hide the rest of the page. If a dialog closes in the same turn as a
 * toast (shift opened, payment done, …), that lock can stay on. In Electron
 * the window is not reloaded, so every text field looks blocked.
 *
 * Native `window.confirm` / `alert` also steal window + input focus. After
 * dismiss, schedule a restore (pointer-events + optional field focus).
 */

const OPEN_MODAL_SELECTOR =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export const POINTER_EVENTS_RELEASE_DELAYS_MS = [0, 50, 250] as const;

export function shouldReleaseBodyPointerEvents(hasOpenModal: boolean, pointerEvents: string): boolean {
  return !hasOpenModal && pointerEvents === 'none';
}

export function planTypingRestoreAfterDialog(input: {
  hasOpenModal: boolean;
  bodyPointerEvents: string;
  htmlPointerEvents?: string;
}): {
  clearBodyPointerEvents: boolean;
  clearHtmlPointerEvents: boolean;
  clearAriaInertAndFocusGuards: boolean;
  shouldRefocus: boolean;
} {
  const hasOpenModal = Boolean(input.hasOpenModal);
  return {
    clearBodyPointerEvents: shouldReleaseBodyPointerEvents(hasOpenModal, input.bodyPointerEvents),
    clearHtmlPointerEvents: shouldReleaseBodyPointerEvents(
      hasOpenModal,
      input.htmlPointerEvents || '',
    ),
    clearAriaInertAndFocusGuards: !hasOpenModal,
    shouldRefocus: !hasOpenModal,
  };
}

export function releaseStuckPointerEvents(doc: Document = document): void {
  const body = doc.body;
  if (!body) return;
  const hasOpenModal = Boolean(doc.querySelector(OPEN_MODAL_SELECTOR));
  const html = doc.documentElement;
  const plan = planTypingRestoreAfterDialog({
    hasOpenModal,
    bodyPointerEvents: body.style.pointerEvents,
    htmlPointerEvents: html?.style?.pointerEvents || '',
  });
  if (plan.clearBodyPointerEvents) {
    body.style.pointerEvents = '';
  }
  if (plan.clearHtmlPointerEvents && html) {
    html.style.pointerEvents = '';
  }
  if (!plan.clearAriaInertAndFocusGuards) return;

  body.querySelectorAll('[data-aria-hidden]').forEach((node) => {
    node.removeAttribute('aria-hidden');
    node.removeAttribute('data-aria-hidden');
  });
  body.querySelectorAll('[data-inert-ed]').forEach((node) => {
    if (node instanceof HTMLElement) node.inert = false;
    node.removeAttribute('inert');
    node.removeAttribute('data-inert-ed');
  });
  doc.querySelectorAll('[data-radix-focus-guard]').forEach((node) => node.remove());
}

/** After a blocking confirm/alert, unlock the page and optionally refocus an input. */
export function scheduleRestoreTypingAfterDialog(
  doc: Document = document,
  focus?: () => void,
): () => void {
  const run = () => {
    releaseStuckPointerEvents(doc);
    if (planTypingRestoreAfterDialog({
      hasOpenModal: Boolean(doc.querySelector?.(OPEN_MODAL_SELECTOR)),
      bodyPointerEvents: doc.body?.style.pointerEvents || '',
    }).shouldRefocus) {
      focus?.();
    }
  };

  if (typeof window === 'undefined') {
    run();
    return () => {};
  }

  try {
    window.focus();
  } catch {
    /* ignore */
  }

  const timers = POINTER_EVENTS_RELEASE_DELAYS_MS.map((ms) => window.setTimeout(run, ms));
  return () => {
    for (const id of timers) window.clearTimeout(id);
  };
}

export function installPointerEventsGuard(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }

  let timers: number[] = [];
  const schedule = () => {
    for (const id of timers) window.clearTimeout(id);
    timers = POINTER_EVENTS_RELEASE_DELAYS_MS.map((ms) =>
      window.setTimeout(() => releaseStuckPointerEvents(), ms),
    );
  };

  const observer = new MutationObserver(schedule);
  const start = () => {
    if (!document.body) return;
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
    });
    schedule();
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  return () => {
    observer.disconnect();
    for (const id of timers) window.clearTimeout(id);
    timers = [];
  };
}
