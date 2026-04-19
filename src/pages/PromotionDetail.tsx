import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getPromotionById, activatePromotion, pausePromotion } from '@/db/api';
import type { PromotionWithDetails, PromotionStatus, PromotionType } from '@/types/database';
import { ArrowLeft, Pencil, Play, Pause, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';

const STATUS_LABELS: Record<PromotionStatus, string> = {
  draft: 'Qoralama',
  scheduled: 'Rejalashtirilgan',
  active: 'Faol',
  paused: "To'xtatilgan",
  expired: 'Muddati tugagan',
  archived: 'Arxiv',
  cancelled: 'Bekor qilingan',
};

const TYPE_LABELS: Record<PromotionType, string> = {
  percent_discount: 'Foizli chegirma',
  amount_discount: 'Summali chegirma',
  fixed_price: 'Fixed narx',
};

export default function PromotionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [promo, setPromo] = useState<PromotionWithDetails | null>(null);
  const [loading, setLoading] = useState(true);

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
  }, [id]);

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
    return <div className="p-6">Yuklanmoqda...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <PageBreadcrumb
        items={[
          { label: 'Aksiyalar', href: '/promotions' },
          { label: promo.name, href: '#' },
        ]}
      />

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/promotions')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Orqaga
        </Button>
        <div className="flex gap-2">
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            {promo.name}
            {promo.code && <span className="text-sm font-normal text-muted-foreground">({promo.code})</span>}
            <Badge>{STATUS_LABELS[promo.status]}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {promo.description && <p className="text-muted-foreground">{promo.description}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Turi</div>
              <div className="font-medium">{TYPE_LABELS[promo.type]}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Muddati</div>
              <div className="font-medium">{formatDate(promo.start_at)} — {formatDate(promo.end_at)}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Prioritet</div>
              <div className="font-medium">{promo.priority}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Ishlatilish soni</div>
              <div className="font-medium">{promo.usage_count ?? 0}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Jami chegirma</div>
              <div className="font-medium">{formatMoneyUZS(promo.total_discount ?? 0)}</div>
            </div>
          </div>

          {promo.scope && (
            <div>
              <div className="text-sm font-medium mb-2">Qamrov</div>
              <div className="text-muted-foreground">
                {promo.scope.scope_type === 'all' && 'Barcha mahsulotlar'}
                {promo.scope.scope_type === 'categories' && `Kategoriyalar: ${promo.scope.scope_ids || '—'}`}
                {promo.scope.scope_type === 'products' && `Mahsulotlar: ${promo.scope.scope_ids || '—'}`}
              </div>
            </div>
          )}

          {promo.condition && (promo.condition.min_qty || promo.condition.min_amount || promo.condition.promo_code) && (
            <div>
              <div className="text-sm font-medium mb-2">Shartlar</div>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                {promo.condition.min_qty != null && <li>Minimal miqdor: {promo.condition.min_qty}</li>}
                {promo.condition.min_amount != null && <li>Minimal chek: {formatMoneyUZS(promo.condition.min_amount)}</li>}
                {promo.condition.promo_code && <li>Promo kod: {promo.condition.promo_code}</li>}
              </ul>
            </div>
          )}

          {promo.reward && (
            <div>
              <div className="text-sm font-medium mb-2">Natija</div>
              <div className="text-muted-foreground">
                {promo.reward.discount_percent != null && <span>{promo.reward.discount_percent}% chegirma</span>}
                {promo.reward.discount_amount != null && <span>{formatMoneyUZS(promo.reward.discount_amount)} chegirma</span>}
                {promo.reward.fixed_price != null && <span>Fixed narx: {formatMoneyUZS(promo.reward.fixed_price)}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
