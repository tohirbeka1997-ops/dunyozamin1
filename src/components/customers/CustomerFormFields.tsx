import type { ReactNode, Ref } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import NumberInput from '@/components/common/NumberInput';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CustomerDupCandidate, CustomerFormValues } from './customerFormShared';

type Layout = 'page' | 'dialog';

function fieldId(idPrefix: string, id: string) {
  return idPrefix ? `${idPrefix}${id}` : id;
}

function Section({
  title,
  layout,
  children,
}: {
  title: string;
  layout: Layout;
  children: ReactNode;
}) {
  if (layout === 'dialog') {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {children}
      </section>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function CustomerDuplicateCandidates({
  candidates,
  onSelect,
}: {
  candidates: CustomerDupCandidate[];
  onSelect: (id: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <CardTitle className="text-base">O‘xshash mijozlar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {candidates.map((d) => (
          <button
            key={`${d.id}-${d.match}`}
            type="button"
            className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => onSelect(d.id)}
          >
            <span>
              {d.name} {d.phone ? `(${d.phone})` : ''} — {d.match}
            </span>
            <span className="text-xs text-muted-foreground">Ochish</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export default function CustomerFormFields({
  values,
  onChange,
  isAdmin,
  isEdit = false,
  layout = 'page',
  idPrefix = '',
  autoFocusName = false,
  nameInputRef,
}: {
  values: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  isAdmin: boolean;
  isEdit?: boolean;
  layout?: Layout;
  idPrefix?: string;
  autoFocusName?: boolean;
  nameInputRef?: Ref<HTMLInputElement>;
}) {
  const setField = <K extends keyof CustomerFormValues>(field: K, value: CustomerFormValues[K]) => {
    onChange({ [field]: value } as Partial<CustomerFormValues>);
  };
  const fid = (id: string) => fieldId(idPrefix, id);
  const showBonus = isEdit || isAdmin;

  return (
    <div className={layout === 'dialog' ? 'space-y-5' : 'contents'}>
      <Section title="Asosiy ma'lumotlar" layout={layout}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={fid('name')}>
              To'liq ismi <span className="text-destructive">*</span>
            </Label>
            <Input
              id={fid('name')}
              ref={nameInputRef}
              value={values.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Mijoz ismini kiriting"
              required
              autoFocus={autoFocusName}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fid('type')}>
              Mijoz turi <span className="text-destructive">*</span>
            </Label>
            <Select value={values.type} onValueChange={(value) => setField('type', value as CustomerFormValues['type'])}>
              <SelectTrigger id={fid('type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Jismoniy shaxs</SelectItem>
                <SelectItem value="company">Yuridik shaxs</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fid('pricing_tier')}>Narx turi</Label>
            <Select
              value={values.pricing_tier}
              onValueChange={(value) => setField('pricing_tier', value as CustomerFormValues['pricing_tier'])}
            >
              <SelectTrigger id={fid('pricing_tier')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">Oddiy mijoz</SelectItem>
                <SelectItem value="master">Usta</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Usta bo‘lsa POS’da usta narxi avtomatik qo‘llanadi (min miqdor sharti bilan).
            </p>
          </div>

          {showBonus && (
            <div className="space-y-2">
              <Label htmlFor={fid('bonus_points')}>Bonus ball</Label>
              <NumberInput
                id={fid('bonus_points')}
                value={values.bonus_points > 0 ? values.bonus_points : null}
                onValueChange={(v) =>
                  setField('bonus_points', Math.max(0, Math.floor(v ?? 0)))
                }
                placeholder="0"
                min={0}
                disabled={!isAdmin}
              />
              {!isAdmin && (
                <p className="text-xs text-muted-foreground">Bonusni faqat admin o‘zgartiradi.</p>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="space-y-2">
              <Label htmlFor={fid('credit_limit')}>Kredit limiti (UZS)</Label>
              <NumberInput
                id={fid('credit_limit')}
                value={values.credit_limit > 0 ? values.credit_limit : null}
                onValueChange={(v) => setField('credit_limit', Math.max(0, Number(v ?? 0)))}
                placeholder="0 = nasiya/qarz berish yo‘q"
                min={0}
                allowZero
              />
              <p className="text-xs text-muted-foreground">
                0 yoki bo‘sh — yangi qarz berish va nasiya sotuv bloklanadi.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={fid('phone')}>Telefon raqami</Label>
            <Input
              id={fid('phone')}
              type="tel"
              value={values.phone}
              onChange={(e) => setField('phone', e.target.value)}
              placeholder="90 123 45 67"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fid('telegram')}>Telegram</Label>
            <Input
              id={fid('telegram')}
              value={values.telegram}
              onChange={(e) => setField('telegram', e.target.value)}
              placeholder="@username yoki chat id"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Nasiya eslatmasi uchun: @username yoki raqamli chat id. Mini App bogʻlangan boʻlsa, u ustuvor.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fid('email')}>Email</Label>
            <Input
              id={fid('email')}
              type="email"
              value={values.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="customer@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fid('status')}>
              Holati <span className="text-destructive">*</span>
            </Label>
            <Select
              value={values.status}
              onValueChange={(value) => setField('status', value as CustomerFormValues['status'])}
            >
              <SelectTrigger id={fid('status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Faol</SelectItem>
                <SelectItem value="inactive">Faol emas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fid('address')}>Manzil</Label>
            <Input
              id={fid('address')}
              value={values.address}
              onChange={(e) => setField('address', e.target.value)}
              placeholder="Manzilni kiriting"
            />
          </div>
        </div>
      </Section>

      {values.type === 'company' && (
        <Section title="Kompaniya ma'lumotlari" layout={layout}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={fid('company_name')}>
                Kompaniya nomi <span className="text-destructive">*</span>
              </Label>
              <Input
                id={fid('company_name')}
                value={values.company_name}
                onChange={(e) => setField('company_name', e.target.value)}
                placeholder="Kompaniya nomini kiriting"
                required={values.type === 'company'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fid('tax_number')}>STIR / INN</Label>
              <Input
                id={fid('tax_number')}
                value={values.tax_number}
                onChange={(e) => setField('tax_number', e.target.value)}
                placeholder="STIR raqamini kiriting"
              />
            </div>
          </div>
        </Section>
      )}

      <Section title="Qo'shimcha ma'lumotlar" layout={layout}>
        <div className="space-y-2">
          <Label htmlFor={fid('notes')}>Izoh</Label>
          <Textarea
            id={fid('notes')}
            value={values.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Bu mijoz haqida qo'shimcha izohlar qo'shing..."
            rows={4}
          />
        </div>
      </Section>
    </div>
  );
}
