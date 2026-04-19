import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export type ConfirmDialogOptions = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmText?: React.ReactNode;
  cancelText?: React.ReactNode;
  variant?: 'default' | 'destructive';
};

type ConfirmFn = (options: ConfirmDialogOptions) => Promise<boolean>;

const ConfirmDialogContext = React.createContext<ConfirmFn | null>(null);

type QueueItem = {
  options: ConfirmDialogOptions;
  resolve: (result: boolean) => void;
};

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmDialogOptions>({});

  const activeResolveRef = React.useRef<((result: boolean) => void) | null>(null);
  const queueRef = React.useRef<QueueItem[]>([]);

  const openNext = React.useCallback(() => {
    if (open) return;
    if (activeResolveRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;

    activeResolveRef.current = next.resolve;
    setOptions(next.options);
    setOpen(true);
  }, [open]);

  const finish = React.useCallback(
    (result: boolean) => {
      const resolve = activeResolveRef.current;
      if (!resolve) return; // already finished

      activeResolveRef.current = null;
      setOpen(false);
      resolve(result);

      // Let Radix unmount overlay/content before opening the next one.
      setTimeout(() => openNext(), 0);
    },
    [openNext]
  );

  const confirm = React.useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        queueRef.current.push({ options: opts, resolve });
        openNext();
      }),
    [openNext]
  );

  const title = options.title ?? t('common.confirm');
  const cancelText = options.cancelText ?? t('common.cancel');
  const confirmText = options.confirmText ?? t('common.confirm');
  const variant = options.variant ?? 'default';

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}

      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          // Treat outside click / ESC close as cancel
          if (!nextOpen) finish(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {options.description ? (
              <AlertDialogDescription>{options.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" onClick={() => finish(false)}>
                {cancelText}
              </Button>
            </AlertDialogCancel>

            <AlertDialogAction asChild>
              <Button
                type="button"
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                onClick={() => finish(true)}
              >
                {confirmText}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): ConfirmFn {
  const ctx = React.useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error('useConfirmDialog must be used within ConfirmDialogProvider');
  }
  return ctx;
}









