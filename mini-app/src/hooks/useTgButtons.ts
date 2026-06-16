import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTg, haptic } from '../lib/telegram';

/**
 * Mount Telegram MainButton (the big native button at bottom of WebApp).
 * Visible/text/loading state is reactive to props. Outside Telegram does nothing.
 *
 * @example
 *   useTgMainButton({
 *     text: `Buyurtma berish · ${total.toLocaleString('uz-UZ')} soʻm`,
 *     visible: lines.length > 0,
 *     onClick: () => navigate('/checkout'),
 *   });
 */
export function useTgMainButton(opts: {
  text: string;
  visible?: boolean;
  active?: boolean;
  loading?: boolean;
  color?: string;
  textColor?: string;
  onClick: () => void;
}): void {
  const cbRef = useRef(opts.onClick);
  cbRef.current = opts.onClick;

  useEffect(() => {
    const tg = getTg();
    const mb = tg?.MainButton;
    if (!mb) return;
    const handler = () => {
      try {
        haptic.impact('medium');
      } catch {
        /* ignore */
      }
      cbRef.current();
    };
    mb.onClick(handler);
    return () => {
      try {
        mb.offClick(handler);
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    const tg = getTg();
    const mb = tg?.MainButton;
    if (!mb) return;
    const visible = opts.visible !== false;
    try {
      mb.setParams({
        text: opts.text,
        is_active: opts.active !== false,
        is_visible: visible,
        ...(opts.color ? { color: opts.color } : {}),
        ...(opts.textColor ? { text_color: opts.textColor } : {}),
      });
      if (opts.loading) {
        mb.showProgress(true);
      } else {
        mb.hideProgress();
      }
    } catch {
      /* ignore */
    }
    return () => {
      try {
        mb.hide();
        mb.hideProgress();
      } catch {
        /* ignore */
      }
    };
  }, [opts.text, opts.visible, opts.active, opts.loading, opts.color, opts.textColor]);
}

/**
 * Telegram BackButton — invokes onBack when user taps the native back arrow.
 * If onBack is omitted, defaults to react-router navigate(-1).
 */
export function useTgBackButton(onBack?: () => void): void {
  const nav = useNavigate();
  const cbRef = useRef<() => void>(onBack || (() => nav(-1)));
  cbRef.current = onBack || (() => nav(-1));

  useEffect(() => {
    const tg = getTg();
    const bb = tg?.BackButton;
    if (!bb) return;
    const handler = () => {
      try {
        haptic.selection();
      } catch {
        /* ignore */
      }
      cbRef.current();
    };
    bb.onClick(handler);
    bb.show();
    return () => {
      try {
        bb.offClick(handler);
        bb.hide();
      } catch {
        /* ignore */
      }
    };
  }, []);
}
