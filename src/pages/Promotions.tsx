import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Plus, Pencil, Trash2, Play, Pause, Eye, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { formatPromotionDbError } from '@/utils/promotionErrors';
import { Loader2 } from 'lucide-react';

const STATUS_LABELS: Record<PromotionStatus, string> = {
  draft: 'Qoralama',
  scheduled: 'Rejalashtirilgan',
  active: 'Faol',
  paused: 'To\'xtatilgan',
  expired: 'Muddati tugagan',
  archived: 'Arxiv',
  cancelled: 'Bekor qilingan',
};

const TYPE_LABELS: Record<PromotionType, string> = {
  percent_discount: 'Foizli chegirma',
  amount_discount: 'Summali chegirma',
  fixed_price: 'Fixed narx',
};

const STATUS_COLORS: Record<PromotionStatus, string> = {
  draft: 'bg-gray-500',
  scheduled: 'bg-blue-500',
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  expired: 'bg-gray-400',
  archived: 'bg-gray-600',
  cancelled: 'bg-red-500',
};

export default function Promotions() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const { data: promotions = [], isLoading } = useQuery({
    queryKey: ['promotions', statusFilter, typeFilter],
    queryFn: async () => {
      const filters: any = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      if (typeFilter !== 'all') filters.type = typeFilter;
      return getPromotions(filters);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePromotion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      toast({ title: 'Aksiya o\'chirildi' });
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
      toast({ title: 'Aksiya to\'xtatildi' });
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

  const handleDelete = async (p: Promotion & { usage_count?: number; total_discount?: number }) => {
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

  return (
    <div className="space-y-6 p-6">
      <PageBreadcrumb items={[{ label: 'Aksiyalar', href: '/promotions' }]} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Aksiyalar
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barchasi</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Turi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha turlar</SelectItem>
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => navigate('/promotions/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Yangi aksiya
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span>Aksiyalar yuklanmoqda...</span>
            </div>
          ) : promotions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Aksiyalar topilmadi. Yangi aksiya yaratish uchun tugmani bosing.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomi</TableHead>
                  <TableHead>Turi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Muddati</TableHead>
                  <TableHead className="text-right">Ishlatilish</TableHead>
                  <TableHead className="text-right">Chegirma jami</TableHead>
                  <TableHead className="w-[140px]">Amallar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(promotions as (Promotion & { usage_count?: number; total_discount?: number })[]).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      {p.code && <div className="text-xs text-muted-foreground">{p.code}</div>}
                    </TableCell>
                    <TableCell>{TYPE_LABELS[p.type]}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      {formatDate(p.start_at)} — {formatDate(p.end_at)}
                    </TableCell>
                    <TableCell className="text-right">{p.usage_count ?? 0}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(p.total_discount ?? 0)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={mutationsBusy}
                          onClick={() => navigate(`/promotions/${p.id}`)}
                          title="Ko'rish"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
