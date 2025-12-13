import { useEffect, useCallback } from 'react';
import { usePOSStore } from '@/store/pos.store';
import { useCartStore } from '@/store/cart.store';

interface ShortcutHandlers {
  onF1?: () => void; // Open payment dialog
  onF2?: () => void; // Open customer credit modal
  onF3?: () => void; // Hold order
  onF4?: () => void; // Resume hold
  onF9?: () => void; // Quick payment
  onEscape?: () => void; // Close dialogs
  onEnter?: () => void; // Confirm action
}

export const usePOSShortcuts = (handlers: ShortcutHandlers) => {
  const { setPaymentDialogOpen, setHoldOrderDialogOpen } = usePOSStore();
  const { items } = useCartStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (isInput) return;

      // F1: Open payment dialog
      if (e.key === 'F1') {
        e.preventDefault();
        if (items.length > 0) {
          handlers.onF1?.() || setPaymentDialogOpen(true);
        }
        return;
      }

      // F2: Open customer credit modal
      if (e.key === 'F2') {
        e.preventDefault();
        handlers.onF2?.();
        return;
      }

      // F3: Hold order
      if (e.key === 'F3') {
        e.preventDefault();
        if (items.length > 0) {
          handlers.onF3?.() || setHoldOrderDialogOpen(true);
        }
        return;
      }

      // F4: Resume hold
      if (e.key === 'F4') {
        e.preventDefault();
        handlers.onF4?.();
        return;
      }

      // F9: Quick payment (cash)
      if (e.key === 'F9') {
        e.preventDefault();
        if (items.length > 0) {
          handlers.onF9?.();
        }
        return;
      }

      // ESC: Close dialogs
      if (e.key === 'Escape') {
        e.preventDefault();
        handlers.onEscape?.();
        return;
      }

      // ENTER: Confirm (context-dependent)
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        handlers.onEnter?.();
      }
    },
    [items.length, handlers, setPaymentDialogOpen, setHoldOrderDialogOpen]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
};








