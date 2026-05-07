import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getPromotionById, activatePromotion, pausePromotion, getCategories, getProducts } from '@/db/api';
import type { PromotionWithDetails } from '@/types/database';
import { ArrowLeft, Pencil, Play, Pause, Tag, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import {
  PROMOTION_STATUS_LABELS,
  PROMOTION_TYPE_LABELS,
  promotionStatusBadgeClass,
  formatPromotionRewardShort,
} from '@/lib/promotionUi';

const MAX_SCOPE_NAMES = 20;

export default function PromotionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [promo, setPromo] = useState<PromotionWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [scopeSummary, setScopeSummary] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        setLoading(true);
        const p = await getPromotionById(id);
        setPromo(p);
      } catch (e) {
        toast({ title: 'Yuklash xatosi', description: (e as Error).message, variant: 'destructive' });
        navigate('/promotions');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, navigate, toast]);

  useEffect(() => {
    if (!promo?.scope) {
      setScopeSummary([]);
      return;
    }
    const st = (promo.scope.scope_type || '').toLowerCase();
    if (st === 'all') {
      setScopeSummary(['Barcha mahsulotlar']);
      return;
    }
    let ids: string[] = [];
    try {
      ids = JSON.parse(String(promo.scope.scope_ids || '[]'));
    } catch {
      setScopeSummary(['(noto‘g‘ri ID ro‘yxati)']);
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      setScopeSummary(['—']);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        if (st === 'categories') {
          const cats = await getCategories({ includeInactive: true });
          if (cancelled) return;
          const map = new Map(cats.map((c) => [String(c.id), c.name]));
          const names = ids.map((i) => map.get(String(i)) || `ID: ${String(i).slice(0, 8)}…`);
          setScopeSummary(names);
          return;
        }
        if (st === 'products') {
          const prods = await getProducts(false, { status: 'all', limit: 10000, offset: 0 });
          if (cancelled) return;
          const map = new Map(prods.map((p) => [String(p.id), p.name]));
          const names = ids.map((i) => map.get(String(i)) || `ID: ${String(i).slice(0, 8)}…`);
          setScopeSummary(names);
          return;
        }
        setScopeSummary(ids.map(String));
      } catch {
        if (!cancelled) setScopeSummary(ids.map((i) => String(i)));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [promo]);

  const scopeDisplay = useMemo(() => {
    if (scopeSummary.length === 0) return null;
    const shown = scopeSummary.slice(0, MAX_SCOPE_NAMES);
    const rest = scopeSummary.length - shown.length;
    return { lines: shown, rest };
  }, [scopeSummary]);

  const handleActivate = async () => {
    if (!id) return;
    try {
      await activatePromotion(id);
      const p = await getPromotionById(id);
      setPromo(p);
      toast({ title: 'Aksiya faollashtirildi' });
    } catch (e) {
      toast({ title: 'Xato', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handlePause = async () => {
    if (!id) return;
    try {
      await pausePromotion(id);
      const p = await getPromotionById(id);
      setPromo(p);
      toast({ title: "Aksiya to'xtatildi" });
    } catch (e) {
      toast({ title: 'Xato', description: (e as Error).message, variant: 'destructive' });
    }
  };

  if (loading || !promo) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 min-h-[40vh] text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <span>Aksiya yuklanmoqda…</span>
      </div>
    );
  }

  const rewardLine = formatPromotionRewardShort(promo.type, promo.reward ?? null);

  return (
    <div className="space-y-6 p-6">
      <PageBreadcrumb
        items={[
          { label: 'Aksiyalar', href: '/promotions' },
          { label: promo.name, href: '#' },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={() => navigate('/promotions')} className="w-fit">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Orqaga
        </Button>
        <div className="flex flex-wrap gap-2">
          {promo.status === 'active' && (
            <Button variant="outline" onClick={handlePause}>
              <Pause className="h-4 w-4 mr-2" />
              To'xtatish
            </Button>
          )}
          {(promo.status === 'paused' || promo.status === 'draft') && (
            <Button variant="outline" onClick={handleActivate}>
              <Play className="h-4 w-4 mr-2" />
              Faollashtirish
            </Button>
          )}
          <Button onClick={() => navigate(`/promotions/${promo.id}/edit`)}>
            <Pencil className="h-4 w-4 mr-2" />
            Tahrirlash
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
              <Tag className="h-5 w-5 shrink-0 text-primary" />
              <span>{promo.name}</span>
              {promo.code ? (
                <span className="text-sm font-normal font-mono text-muted-foreground">({promo.code})</span>
              ) : null}
            </CardTitle>
            <Badge variant="outline" className={promotionStatusBadgeClass(promo.status)}>
              {PROMOTION_STATUS_LABELS[promo.status]}
            </Badge>
          </div>
          {promo.description ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{promo.description}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-3">Asosiy</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Turi</div>
                <div className="font-medium">{PROMOTION_TYPE_LABELS[promo.type]}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Chegirma / narx</div>
                <div className="font-medium tabular-nums">{rewardLine}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Muddati</div>
                <div className="font-medium whitespace-nowrap">
                  {formatDate(promo.start_at)} — {formatDate(promo.end_at)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Prioritet</div>
                <div className="font-medium tabular-nums">{promo.priority}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Ishlatilish soni</div>
                <div className="font-medium tabular-nums">{promo.usage_count ?? 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Jami chegirma</div>
                <div className="font-medium tabular-nums">
                  {formatMoneyUZS(promo.total_discount ?? 0)}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {promo.scope && (
            <div>
              <h3 className="text-sm font-medium mb-2">Qamrov</h3>
              {promo.scope.scope_type === 'all' ? (
                <p className="text-sm text-muted-foreground">Barcha mahsulotlar</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-2">
                    {promo.scope.scope_type === 'categories' && 'Tanlangan kategoriyalar'}
                    {promo.scope.scope_type === 'products' && 'Tanlangan mahsulotlar'}
                  </p>
                  {scopeDisplay && (
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      {scopeDisplay.lines.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                      {scopeDisplay.rest > 0 ? (
                        <li className="list-none text-xs italic">+ yana {scopeDisplay.rest} ta</li>
                      ) : null}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {promo.condition &&
            (promo.condition.min_qty != null ||
              promo.condition.min_amount != null ||
              promo.condition.promo_code) && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium mb-2">Shartlar</h3>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    {promo.condition.min_qty != null && (
                      <li>Minimal miqdor: {promo.condition.min_qty}</li>
                    )}
                    {promo.condition.min_amount != null && (
                      <li>Minimal chek: {formatMoneyUZS(promo.condition.min_amount)}</li>
                    )}
                    {promo.condition.promo_code && (
                      <li>
                        Promo kod:{' '}
                        <span className="font-mono">{promo.condition.promo_code}</span>
                      </li>
                    )}
                  </ul>
                </div>
              </>
            )}

        </CardContent>
      </Card>
    </div>
  );
}
