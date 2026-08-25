import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2, Search, Sparkles, Image as ImageIcon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { getProducts } from '@/db/api';
import { formatMoneyUZS } from '@/lib/format';
import { todayYMD, tashkentLocalToUtcIso, utcIsoToTashkentLocal } from '@/lib/datetime';

// ─── Types mirror the service shape (kept local — small surface) ──────────
type Banner = {
  id: number;
  emoji: string | null;
  title: string;
  subtitle: string;
  cta_text: string | null;
  cta_link: string | null;
  theme: 'primary' | 'cream' | 'teal' | string;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

type DailyDeal = {
  id: number;
  featured_date: string;
  product_id: string;
  badge_text: string | null;
  product: {
    id: string;
    name: string;
    price_uzs: number;
    image_url: string | null;
    is_active?: boolean;
  } | null;
} | null;

type DailyDealHistory = {
  id: number;
  featured_date: string;
  product_id: string;
  badge_text: string | null;
  product_name: string | null;
  product_image: string | null;
};

const THEME_OPTIONS: Array<{ value: Banner['theme']; label: string; preview: string }> = [
  { value: 'primary', label: 'To‘q yashil (asosiy)', preview: 'bg-emerald-800 text-white' },
  { value: 'cream', label: 'Krem (yumshoq)', preview: 'bg-amber-50 text-emerald-900 border border-emerald-200' },
  { value: 'teal', label: 'Teal (tinch suv)', preview: 'bg-teal-700 text-white' },
];

function todayISO(): string {
  // Shop timezone (Asia/Tashkent) "today" so the admin default date matches
  // the public mini-app daily-deal read near midnight (UTC+5 boundary).
  return todayYMD();
}

function ipcApi() {
  return getElectronAPI();
}

export default function MarketplaceContent() {
  const { toast } = useToast();
  const confirm = useConfirmDialog();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Partial<Banner> | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // ── Banners ─────────────────────────────────────────────────────────────
  const bannersQuery = useQuery({
    queryKey: ['mkt-banners'],
    queryFn: async () => {
      const api = ipcApi();
      if (!api?.marketplaceContent) return [] as Banner[];
      const rows = await handleIpcResponse<Banner[]>(api.marketplaceContent.listBanners({}));
      return Array.isArray(rows) ? rows : [];
    },
  });

  // React Query v5 dropped onSuccess/onError from useMutation options; the
  // handlers below are passed to each mutate() call instead so they still run.
  const saveBanner = useMutation({
    mutationFn: async (payload: Partial<Banner>) => {
      const api = ipcApi();
      if (!api?.marketplaceContent) throw new Error('Electron required');
      return handleIpcResponse<Banner>(api.marketplaceContent.saveBanner(payload));
    },
  });

  const deleteBanner = useMutation({
    mutationFn: async (id: number) => {
      const api = ipcApi();
      if (!api?.marketplaceContent) throw new Error('Electron required');
      return handleIpcResponse(api.marketplaceContent.deleteBanner(id));
    },
  });

  const reorder = useMutation({
    mutationFn: async (items: Array<{ id: number; sort_order: number }>) => {
      const api = ipcApi();
      if (!api?.marketplaceContent) throw new Error('Electron required');
      return handleIpcResponse(api.marketplaceContent.reorderBanners(items));
    },
  });

  const moveBanner = useCallback(
    (id: number, dir: -1 | 1) => {
      const list = [...(bannersQuery.data || [])].sort((a, b) => a.sort_order - b.sort_order);
      const idx = list.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const swap = idx + dir;
      if (swap < 0 || swap >= list.length) return;
      const a = list[idx];
      const b = list[swap];
      reorder.mutate(
        [
          { id: a.id, sort_order: b.sort_order },
          { id: b.id, sort_order: a.sort_order },
        ],
        { onSuccess: () => qc.invalidateQueries({ queryKey: ['mkt-banners'] }) },
      );
    },
    [bannersQuery.data, reorder, qc],
  );

  const handleDeleteBanner = async (b: Banner) => {
    const ok = await confirm({
      title: 'Bannerni o‘chirish',
      description: `“${b.title}” bannerini o‘chirmoqchimisiz?`,
      confirmText: 'O‘chirish',
      variant: 'destructive',
    });
    if (ok)
      deleteBanner.mutate(b.id, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['mkt-banners'] });
          toast({ title: 'Banner o‘chirildi' });
        },
        onError: (e: Error) => toast({ title: 'Xatolik', description: e.message, variant: 'destructive' }),
      });
  };

  // ── Daily deal ──────────────────────────────────────────────────────────
  const [dealDate, setDealDate] = useState(todayISO());
  const dailyDealQuery = useQuery({
    queryKey: ['mkt-daily-deal', dealDate],
    queryFn: async () => {
      const api = ipcApi();
      if (!api?.marketplaceContent) return null as DailyDeal;
      return handleIpcResponse<DailyDeal>(api.marketplaceContent.getDailyDeal(dealDate));
    },
  });

  const dailyDealHistoryQuery = useQuery({
    queryKey: ['mkt-daily-deal-history'],
    enabled: showHistory,
    queryFn: async () => {
      const api = ipcApi();
      if (!api?.marketplaceContent) return [] as DailyDealHistory[];
      return handleIpcResponse<DailyDealHistory[]>(api.marketplaceContent.dailyDealHistory(60));
    },
  });

  const setDeal = useMutation({
    mutationFn: async (payload: { featured_date: string; product_id: string | null; badge_text?: string | null }) => {
      const api = ipcApi();
      if (!api?.marketplaceContent) throw new Error('Electron required');
      return handleIpcResponse(api.marketplaceContent.setDailyDeal(payload));
    },
  });

  // React Query v5: pass these to every setDeal.mutate() call so the
  // invalidations + toasts still run (mutation-level callbacks are dead in v5).
  const setDealCallbacks = {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mkt-daily-deal'] });
      qc.invalidateQueries({ queryKey: ['mkt-daily-deal-history'] });
      toast({ title: 'Kun mahsuloti yangilandi' });
    },
    onError: (e: Error) => toast({ title: 'Xatolik', description: e.message, variant: 'destructive' }),
  };

  // ── Product picker ──────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [badgeDraft, setBadgeDraft] = useState('');

  useEffect(() => {
    if (dailyDealQuery.data?.badge_text) setBadgeDraft(dailyDealQuery.data.badge_text);
    else setBadgeDraft('');
  }, [dailyDealQuery.data?.badge_text]);

  const productsQuery = useQuery({
    queryKey: ['mkt-product-picker', productSearch],
    enabled: pickerOpen,
    queryFn: async () =>
      getProducts(false, {
        searchTerm: productSearch.trim() || undefined,
        status: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 30,
      }),
  });

  const sortedBanners = useMemo(
    () => [...(bannersQuery.data || [])].sort((a, b) => a.sort_order - b.sort_order),
    [bannersQuery.data],
  );

  return (
    <div className="container mx-auto space-y-6 p-4">
      <PageBreadcrumb
        items={[
          { label: 'Marketplace', href: '/marketplace-content' },
          { label: 'Bosh sahifa kontenti', href: '/marketplace-content' },
        ]}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mini-app — bosh sahifa</h1>
          <p className="text-sm text-muted-foreground">
            Mijozlar ko‘radigan promo bannerlar va “Kun mahsuloti”ni shu yerdan boshqaring.
          </p>
        </div>
      </div>

      {/* ─── PROMO BANNERS ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle>Promo bannerlar</CardTitle>
            <p className="text-xs text-muted-foreground">
              Bosh sahifadagi rotatsiyali aksiya bannerlari. Tartib pastdan
              yuqoriga: 1 — birinchi ko‘rinadi.
            </p>
          </div>
          <Button onClick={() => setEditing({ theme: 'primary', is_active: true, sort_order: (sortedBanners.at(-1)?.sort_order ?? 0) + 1 })}>
            <Plus className="mr-1.5 h-4 w-4" /> Qo‘shish
          </Button>
        </CardHeader>
        <CardContent>
          {bannersQuery.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sortedBanners.length === 0 ? (
            <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
              Hali bannerlar yo‘q. “Qo‘shish” tugmasi bilan birinchisini yarating.
            </div>
          ) : (
            <ul className="space-y-2">
              {sortedBanners.map((b, i) => {
                const themeMeta = THEME_OPTIONS.find((t) => t.value === b.theme) || THEME_OPTIONS[0];
                return (
                  <li
                    key={b.id}
                    className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={i === 0 || reorder.isPending}
                        onClick={() => moveBanner(b.id, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <span className="text-xs font-mono text-muted-foreground">#{b.sort_order}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={i === sortedBanners.length - 1 || reorder.isPending}
                        onClick={() => moveBanner(b.id, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>

                    <div
                      className={`flex h-20 w-32 shrink-0 items-center justify-center rounded-lg text-2xl ${themeMeta.preview}`}
                    >
                      {b.emoji || '✦'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wider text-muted-foreground">{b.title}</span>
                        {!b.is_active && <Badge variant="outline">o‘chirilgan</Badge>}
                      </div>
                      <h3 className="mt-0.5 truncate font-semibold">{b.subtitle}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {b.cta_text && (
                          <span className="rounded bg-muted px-1.5 py-0.5">▸ {b.cta_text}</span>
                        )}
                        {b.cta_link && <span className="font-mono">{b.cta_link}</span>}
                      </div>
                    </div>

                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(b)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => handleDeleteBanner(b)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ─── DAILY DEAL ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" /> Kun mahsuloti
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ushbu sanaga aniq bir mahsulotni yopishtirib qo‘ying. Belgilanmasa,
              tizim avtomatik trendinglar ichidan tanlaydi.
            </p>
          </div>
          <Input
            type="date"
            value={dealDate}
            onChange={(e) => setDealDate(e.target.value)}
            className="w-44"
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {dailyDealQuery.isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : dailyDealQuery.data?.product ? (
            <div className="flex items-center gap-4 rounded-lg border bg-amber-50/40 p-3 dark:bg-amber-900/10">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
                {dailyDealQuery.data.product.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={dailyDealQuery.data.product.image_url}
                    alt={dailyDealQuery.data.product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wider text-amber-700">{dealDate}</div>
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{dailyDealQuery.data.product.name}</span>
                  {dailyDealQuery.data.product.is_active === false && (
                    <Badge variant="destructive" className="shrink-0">mahsulot nofaol</Badge>
                  )}
                </div>
                <div className="text-sm font-bold text-amber-700">
                  {formatMoneyUZS(dailyDealQuery.data.product.price_uzs)} so‘m
                </div>
                {dailyDealQuery.data.product.is_active === false && (
                  <p className="mt-1 text-xs text-destructive">
                    Bu mahsulot arxivlangan/nofaol — mini-app uni ko‘rsatmaydi va avtomatik
                    trendingga qaytadi. Faol mahsulot tanlang.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                  Almashtirish
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setDeal.mutate({ featured_date: dealDate, product_id: null }, setDealCallbacks)}
                  disabled={setDeal.isPending}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Avtomatga qaytarish
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <p className="mb-3 text-sm text-muted-foreground">
                Bu sanaga override qo‘yilmagan — mini-app trending feed‘dan
                determinsitik mahsulot ko‘rsatadi.
              </p>
              <Button onClick={() => setPickerOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Mahsulot tanlash
              </Button>
            </div>
          )}

          {dailyDealQuery.data?.product && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="badge">Badge matni (ixtiyoriy)</Label>
                <Input
                  id="badge"
                  placeholder="✦ Bugun -20%"
                  value={badgeDraft}
                  onChange={(e) => setBadgeDraft(e.target.value)}
                  maxLength={60}
                />
              </div>
              <Button
                onClick={() =>
                  setDeal.mutate(
                    {
                      featured_date: dealDate,
                      product_id: dailyDealQuery.data!.product!.id,
                      badge_text: badgeDraft.trim() || null,
                    },
                    setDealCallbacks,
                  )
                }
                disabled={setDeal.isPending}
              >
                Saqlash
              </Button>
            </div>
          )}

          <div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowHistory((s) => !s)}
            >
              {showHistory ? 'Tarixni yashirish' : 'Tarixni ko‘rsatish'}
            </button>
            {showHistory && (
              <div className="mt-2 max-h-72 overflow-auto rounded-md border">
                <ul className="divide-y">
                  {(dailyDealHistoryQuery.data || []).map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                    >
                      <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                        {row.featured_date}
                      </span>
                      <span className="flex-1 truncate">{row.product_name || row.product_id}</span>
                      {row.badge_text && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          {row.badge_text}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDealDate(row.featured_date)}
                      >
                        Ochish
                      </Button>
                    </li>
                  ))}
                  {dailyDealHistoryQuery.data?.length === 0 && (
                    <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                      Tarix bo‘sh.
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── BANNER EDIT DIALOG ───────────────────────────────────────────── */}
      <BannerEditor
        open={!!editing}
        value={editing}
        onChange={setEditing}
        onSave={() =>
          editing &&
          saveBanner.mutate(editing, {
            onSuccess: () => {
              qc.invalidateQueries({ queryKey: ['mkt-banners'] });
              setEditing(null);
              toast({ title: 'Banner saqlandi' });
            },
            onError: (e: Error) => toast({ title: 'Xatolik', description: e.message, variant: 'destructive' }),
          })
        }
        saving={saveBanner.isPending}
      />

      {/* ─── PRODUCT PICKER ───────────────────────────────────────────────── */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Mahsulot tanlash · {dealDate}</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Nom yoki SKU bo‘yicha qidiring…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="max-h-[60vh] overflow-auto rounded border">
            {productsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ul className="divide-y">
                {(productsQuery.data || []).map((p: any) => (
                  <li
                    key={p.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40"
                    onClick={() => {
                      setDeal.mutate(
                        {
                          featured_date: dealDate,
                          product_id: p.id,
                          badge_text: badgeDraft.trim() || null,
                        },
                        setDealCallbacks,
                      );
                      setPickerOpen(false);
                    }}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatMoneyUZS(p.sale_price ?? 0)} so‘m
                      </div>
                    </div>
                  </li>
                ))}
                {productsQuery.data?.length === 0 && (
                  <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                    Mahsulot topilmadi.
                  </li>
                )}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── BANNER EDIT MODAL ───────────────────────────────────────────────────────
function BannerEditor({
  open,
  value,
  onChange,
  onSave,
  saving,
}: {
  open: boolean;
  value: Partial<Banner> | null;
  onChange: (v: Partial<Banner> | null) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onChange(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{value?.id ? 'Bannerni tahrirlash' : 'Yangi banner'}</DialogTitle>
        </DialogHeader>
        {value && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="emoji">Emoji</Label>
                <Input
                  id="emoji"
                  placeholder="🚚"
                  maxLength={4}
                  value={value.emoji || ''}
                  onChange={(e) => onChange({ ...value, emoji: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="theme">Mavzu / fon</Label>
                <Select
                  value={(value.theme as string) || 'primary'}
                  onValueChange={(t) => onChange({ ...value, theme: t as Banner['theme'] })}
                >
                  <SelectTrigger id="theme"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {THEME_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="title">Yuqori matn (kichik)</Label>
              <Input
                id="title"
                placeholder="300K dan ortiq xaridga"
                maxLength={80}
                value={value.title || ''}
                onChange={(e) => onChange({ ...value, title: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="subtitle">Asosiy matn (katta)</Label>
              <Textarea
                id="subtitle"
                placeholder="BEPUL yetkazib berish"
                maxLength={120}
                rows={2}
                value={value.subtitle || ''}
                onChange={(e) => onChange({ ...value, subtitle: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cta_text">Tugma matni</Label>
                <Input
                  id="cta_text"
                  placeholder="Hoziroq xarid →"
                  maxLength={40}
                  value={value.cta_text || ''}
                  onChange={(e) => onChange({ ...value, cta_text: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cta_link">Havola</Label>
                <Input
                  id="cta_link"
                  placeholder="/catalog"
                  maxLength={200}
                  value={value.cta_link || ''}
                  onChange={(e) => onChange({ ...value, cta_link: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="starts_at">Boshlanish (ixtiyoriy)</Label>
                <Input
                  id="starts_at"
                  type="datetime-local"
                  value={utcIsoToTashkentLocal(value.starts_at)}
                  onChange={(e) =>
                    onChange({ ...value, starts_at: tashkentLocalToUtcIso(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="ends_at">Tugash (ixtiyoriy)</Label>
                <Input
                  id="ends_at"
                  type="datetime-local"
                  value={utcIsoToTashkentLocal(value.ends_at)}
                  onChange={(e) =>
                    onChange({ ...value, ends_at: tashkentLocalToUtcIso(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-medium">Faol</div>
                <div className="text-xs text-muted-foreground">
                  O‘chirilgan bannerlar mini-app‘da ko‘rinmaydi.
                </div>
              </div>
              <Switch
                checked={value.is_active !== false}
                onCheckedChange={(v) => onChange({ ...value, is_active: v })}
              />
            </div>

            <div>
              <Label htmlFor="sort_order">Tartib raqami</Label>
              <Input
                id="sort_order"
                type="number"
                min={0}
                value={value.sort_order ?? 0}
                onChange={(e) => onChange({ ...value, sort_order: Number(e.target.value) })}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onChange(null)} disabled={saving}>
            Bekor qilish
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
