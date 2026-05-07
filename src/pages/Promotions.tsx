import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getPromotions, deletePromotion, activatePromotion, pausePromotion } from '@/db/api';
import type { Promotion, PromotionStatus, PromotionType } from '@/types/database';
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  Pause,
  Eye,
  Tag,
  Loader2,
  Search,
  BarChart3,
  CalendarRange,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { formatPromotionDbError } from '@/utils/promotionErrors';
import {
  PROMOTION_STATUS_LABELS,
  PROMOTION_TYPE_LABELS,
  promotionStatusBadgeClass,
  formatPromotionRewardShort,
  type PromotionRewardLike,
} from '@/lib/promotionUi';
import { cn } from '@/lib/utils';

type PromotionRow = Promotion & {
  usage_count?: number;
  total_discount?: number;
  reward?: PromotionRewardLike;
  scope?: { scope_type: string; scope_ids: string | null } | null;
};

type TimeFilter = 'all' | 'active_now' | 'ending_7d';

function promotionOverlapsDateRange(p: Promotion, from: string, to: string): boolean {
  if (!from && !to) return true;
  const ps = p.start_at.slice(0, 10);
  const pe = p.end_at.slice(0, 10);
  if (from && pe < from) return false;
  if (to && ps > to) return false;
  return true;
}

export default function Promotions() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: promotions = [], isLoading } = useQuery({
    queryKey: ['promotions', statusFilter, typeFilter],
    queryFn: async () => {
      const filters: Record<string, string> = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      if (typeFilter !== 'all') filters.type = typeFilter;
      return getPromotions(filters);
    },
  });

  const filteredPromotions = useMemo(() => {
    let list = promotions as PromotionRow[];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code && String(p.code).toLowerCase().includes(q))
      );
    }
    const now = Date.now();
    if (timeFilter === 'active_now') {
      list = list.filter((p) => {
        const s = new Date(p.start_at).getTime();
        const e = new Date(p.end_at).getTime();
        return p.status === 'active' && s <= now && e >= now;
      });
    } else if (timeFilter === 'ending_7d') {
      const week = now + 7 * 86400000;
      list = list.filter((p) => {
        const e = new Date(p.end_at).getTime();
        return e >= now && e <= week;
      });
    }
    if (dateFrom || dateTo) {
      list = list.filter((p) => promotionOverlapsDateRange(p, dateFrom, dateTo));
    }
    return list;
  }, [promotions, searchQuery, timeFilter, dateFrom, dateTo]);

  const deleteMutation = useMutation({
    mutationFn: deletePromotion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      toast({ title: "Aksiya o'chirildi" });
    },
    onError: (err: Error) => {
      toast({
        title: 'O‘chirish amalga oshmadi',
        description: formatPromotionDbError(err.message),
        variant: 'destructive',
      });
    },
  });

  const activateMutation = useMutation({
    mutationFn: activatePromotion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      toast({ title: 'Aksiya faollashtirildi' });
    },
    onError: (err: Error) => {
      toast({
        title: 'Faollashtirish amalga oshmadi',
        description: formatPromotionDbError(err.message),
        variant: 'destructive',
      });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pausePromotion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      toast({ title: "Aksiya to'xtatildi" });
    },
    onError: (err: Error) => {
      toast({
        title: 'To‘xtatish amalga oshmadi',
        description: formatPromotionDbError(err.message),
        variant: 'destructive',
      });
    },
  });

  const mutationsBusy =
    deleteMutation.isPending || activateMutation.isPending || pauseMutation.isPending;

  const handleDelete = async (p: PromotionRow) => {
    const usage = Number(p.usage_count ?? 0);
    const usageNote =
      usage > 0
        ? ` Bu aksiya ${usage} marta savdolarda ishlatilgan. O‘chirishda ishlatilish yozuvlari ham olib tashlanadi; buyurtma qatorlaridagi havola tozalanadi, lekin buyurtma summalari o‘zgarmaydi.`
        : '';
    const ok = await confirmDialog({
      title: 'Aksiyani o‘chirish',
      description: `“${p.name}” aksiyasini butunlay o‘chirmoqchimisiz?${usageNote}`,
      confirmText: 'O‘chirish',
      variant: 'destructive',
    });
    if (ok) deleteMutation.mutate(p.id);
  };

  const handleActivate = (id: string) => activateMutation.mutate(id);
  const handlePause = (id: string) => pauseMutation.mutate(id);

  const hasFilters =
    searchQuery.trim() !== '' ||
    timeFilter !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    statusFilter !== 'all' ||
    typeFilter !== 'all';

  return (
    <div className="w-full min-w-0 space-y-4">
      <PageBreadcrumb items={[{ label: 'Aksiyalar', href: '/promotions' }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Tag className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 space-y-0.5">
            <h1 className="page-heading">Aksiyalar</h1>
            <p className="page-heading-sub">Chegirmalar va aksiya qoidalari</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild className="h-8 shrink-0 text-xs">
            <Link to="/reports/sales/promotions">
              <BarChart3 className="mr-2 h-3.5 w-3.5" />
              Ishlatilish hisoboti
            </Link>
          </Button>
          <Button size="sm" className="h-8 shrink-0 text-xs" onClick={() => navigate('/promotions/new')}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Yangi aksiya
          </Button>
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="relative h-8 min-w-0 flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 bg-background py-1 pl-8 text-xs sm:text-sm"
                  placeholder="Nom yoki kod bo‘yicha qidiruv…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Aksiyalar qidiruvi"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-full bg-background text-xs sm:w-[160px] [&_span]:truncate">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha statuslar</SelectItem>
                  {(Object.keys(PROMOTION_STATUS_LABELS) as PromotionStatus[]).map((v) => (
                    <SelectItem key={v} value={v}>
                      {PROMOTION_STATUS_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-full bg-background text-xs sm:w-[180px] [&_span]:truncate">
                  <SelectValue placeholder="Turi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha turlar</SelectItem>
                  {(Object.keys(PROMOTION_TYPE_LABELS) as PromotionType[]).map((v) => (
                    <SelectItem key={v} value={v}>
                      {PROMOTION_TYPE_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
                <SelectTrigger className="h-8 w-full bg-background text-xs sm:w-[200px] [&_span]:truncate">
                  <SelectValue placeholder="Vaqt" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha muddatlar</SelectItem>
                  <SelectItem value="active_now">Hozir faol (muddat ichida)</SelectItem>
                  <SelectItem value="ending_7d">7 kun ichida tugaydi</SelectItem>
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-8 w-full justify-start gap-2 px-2 text-xs font-normal sm:w-[220px] bg-background',
                      (dateFrom || dateTo) && 'border-primary/40 bg-primary/5'
                    )}
                  >
                    <CalendarRange className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="truncate">
                      {dateFrom || dateTo ? (
                        <>
                          {dateFrom || '…'} — {dateTo || '…'}
                        </>
                      ) : (
                        'Sana oralig‘i'
                      )}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(100vw-2rem,22rem)] sm:w-auto sm:min-w-[300px]">
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Aksiya muddati tanlangan kunlar bilan <span className="font-medium text-foreground">kesishadi</span>.
                      Bo‘sh qoldirish — cheklov yo‘q.
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Dan</Label>
                        <Input
                          type="date"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                          className="h-8 bg-background text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Gacha</Label>
                        <Input
                          type="date"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                          min={dateFrom || undefined}
                          className="h-8 bg-background text-xs"
                        />
                      </div>
                    </div>
                    {(dateFrom || dateTo) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setDateFrom('');
                          setDateTo('');
                        }}
                      >
                        Sanalarni tozalash
                      </Button>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Aksiyalar ro&apos;yxati</span>
            {!isLoading && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                ({filteredPromotions.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span>Aksiyalar yuklanmoqda…</span>
            </div>
          ) : promotions.length === 0 ? (
            <div className="mx-4 my-8 flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center">
              <div className="rounded-full bg-muted p-3">
                <Tag className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">Hozircha aksiyalar yo‘q</p>
                <p className="text-sm text-muted-foreground">
                  Chegirma yoki maxsus narx qoidalari yaratish uchun yangi aksiya oching. POS va onlayn savdoda
                  avtomatik qo‘llanadi.
                </p>
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={() => navigate('/promotions/new')}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Birinchi aksiyani yaratish
              </Button>
            </div>
          ) : filteredPromotions.length === 0 ? (
            <div className="space-y-3 py-10 text-center text-sm text-muted-foreground">
              <p>Filtr yoki qidiruv bo‘yicha natija topilmadi.</p>
              {hasFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setTypeFilter('all');
                    setTimeFilter('all');
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Filtrlarni tozalash
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold sm:text-sm">Nomi</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Turi</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Chegirma / narx</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Status</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Muddati</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">Ishlatilish</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">Chegirma jami</TableHead>
                    <TableHead className="w-[140px] text-xs font-semibold sm:text-sm">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPromotions.map((p) => (
                    <TableRow key={p.id} className="text-sm hover:bg-muted/40">
                      <TableCell className="py-2">
                        <div className="font-medium">{p.name}</div>
                        {p.code ? (
                          <div className="text-xs text-muted-foreground font-mono">{p.code}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs">
                        {PROMOTION_TYPE_LABELS[p.type]}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs">
                        {formatPromotionRewardShort(p.type, p.reward ?? null)}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={`${promotionStatusBadgeClass(p.status)} px-1.5 py-0 text-[10px] font-normal sm:text-xs`}
                        >
                          {PROMOTION_STATUS_LABELS[p.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs">
                        {formatDate(p.start_at)} — {formatDate(p.end_at)}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums">
                        {p.usage_count ?? 0}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums">
                        {formatMoneyUZS(p.total_discount ?? 0)}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={mutationsBusy}
                            onClick={() => navigate(`/promotions/${p.id}`)}
                            title="Ko'rish"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={mutationsBusy}
                            onClick={() => navigate(`/promotions/${p.id}/edit`)}
                            title="Tahrirlash"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {p.status === 'active' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={mutationsBusy}
                              onClick={() => handlePause(p.id)}
                              title="To'xtatish"
                            >
                              {pauseMutation.isPending && pauseMutation.variables === p.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Pause className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {(p.status === 'paused' || p.status === 'draft') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={mutationsBusy}
                              onClick={() => handleActivate(p.id)}
                              title="Faollashtirish"
                            >
                              {activateMutation.isPending && activateMutation.variables === p.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={mutationsBusy}
                            onClick={() => handleDelete(p)}
                            title="O'chirish"
                          >
                            {deleteMutation.isPending && deleteMutation.variables === p.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
