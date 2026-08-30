import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { getAllEmployees, getCategories, createInventoryRevision } from '@/db/api';
import type { Category, Profile } from '@/types/database';
import { useToast } from '@/hooks/use-toast';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createdBy?: string | null;
  onCreated: (revision: { id: string; revision_number?: string }) => void;
};

export default function CreateInventoryRevisionDialog({
  open,
  onOpenChange,
  createdBy,
  onCreated,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [revisionType, setRevisionType] = useState<'full' | 'partial'>('full');
  const [countMethod, setCountMethod] = useState('manual');
  const [plannedDate, setPlannedDate] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [shelf, setShelf] = useState('');
  const [zone, setZone] = useState('');
  const [notes, setNotes] = useState('');
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [emps, cats] = await Promise.all([getAllEmployees(), getCategories()]);
        if (cancelled) return;
        setEmployees(Array.isArray(emps) ? emps : []);
        setCategories(Array.isArray(cats) ? cats : []);
        if (createdBy && !responsibleId) setResponsibleId(createdBy);
      } catch {
        /* keep empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, createdBy, responsibleId]);

  const partialScopeValid =
    revisionType === 'full' ||
    Boolean(categoryId) ||
    Boolean(shelf.trim()) ||
    Boolean(zone.trim());

  const canStart =
    Boolean(responsibleId) &&
    partialScopeValid &&
    !submitting;

  const reset = () => {
    setRevisionType('full');
    setCountMethod('manual');
    setPlannedDate('');
    setResponsibleId(createdBy || '');
    setCategoryId('');
    setShelf('');
    setZone('');
    setNotes('');
  };

  const handleStart = async () => {
    if (!canStart) return;
    try {
      setSubmitting(true);
      const scope =
        revisionType === 'partial'
          ? {
              ...(categoryId ? { category_ids: [categoryId] } : {}),
              ...(shelf.trim() ? { shelf: shelf.trim() } : {}),
              ...(zone.trim() ? { zone: zone.trim() } : {}),
            }
          : undefined;
      const rev = await createInventoryRevision({
        revision_type: revisionType,
        scope,
        count_method: countMethod,
        planned_date: plannedDate || undefined,
        responsible_user_id: responsibleId,
        notes: notes.trim() || undefined,
        created_by: createdBy || null,
      });
      reset();
      onOpenChange(false);
      onCreated(rev);
    } catch (err: unknown) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('inventory_revision.create_title')}</DialogTitle>
          <DialogDescription>{t('inventory_revision.create_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t('inventory_revision.field_type')}</Label>
            <Select
              value={revisionType}
              onValueChange={(v) => setRevisionType(v as 'full' | 'partial')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{t('inventory_revision.type_full')}</SelectItem>
                <SelectItem value="partial">{t('inventory_revision.type_partial')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {revisionType === 'partial' && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{t('inventory_revision.scope_hint')}</p>
              <div className="space-y-2">
                <Label>{t('inventory_revision.field_category')}</Label>
                <Select value={categoryId || 'none'} onValueChange={(v) => setCategoryId(v === 'none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('inventory_revision.field_category_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('inventory_revision.scope_none')}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('inventory_revision.field_shelf')}</Label>
                  <Input value={shelf} onChange={(e) => setShelf(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t('inventory_revision.field_zone')}</Label>
                  <Input value={zone} onChange={(e) => setZone(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t('inventory_revision.field_responsible')}</Label>
            <Select value={responsibleId || 'none'} onValueChange={(v) => setResponsibleId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder={t('inventory_revision.field_responsible_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" disabled>
                  {t('inventory_revision.field_responsible_placeholder')}
                </SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name || e.username || e.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('inventory_revision.field_count_method')}</Label>
              <Select value={countMethod} onValueChange={setCountMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">{t('inventory_revision.count_manual')}</SelectItem>
                  <SelectItem value="barcode">{t('inventory_revision.count_barcode')}</SelectItem>
                  <SelectItem value="mixed">{t('inventory_revision.count_mixed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('inventory_revision.field_planned_date')}</Label>
              <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('inventory_revision.field_notes')}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel', { defaultValue: 'Bekor' })}
          </Button>
          <Button type="button" onClick={() => void handleStart()} disabled={!canStart}>
            {submitting ? t('inventory_revision.starting') : t('inventory_revision.start_revision')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
