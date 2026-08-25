import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import NumberInput from '@/components/common/NumberInput';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { bulkUpdateSettings, getSettingsByCategory } from '@/db/api';
import { Loader2, Save } from 'lucide-react';

type ChannelMode = 'telegram_first' | 'sms_first' | 'both' | 'sms_only' | 'telegram_only';

type CreditReminderForm = {
  enabled: boolean;
  dailyEnabled: boolean;
  balanceChangeNotify: boolean;
  smsEnabled: boolean;
  telegramEnabled: boolean;
  staffInAppEnabled: boolean;
  channel: ChannelMode;
  scheduleTime: string;
  minAmount: number;
  dailySmsLimit: number;
  template: string;
  defaultDueDays: number;
};

const DEFAULTS: CreditReminderForm = {
  enabled: true,
  dailyEnabled: true,
  balanceChangeNotify: true,
  smsEnabled: true,
  telegramEnabled: true,
  staffInAppEnabled: true,
  channel: 'telegram_first',
  scheduleTime: '09:00',
  minAmount: 0,
  dailySmsLimit: 0,
  template: '',
  defaultDueDays: 7,
};

const CHANNELS: ChannelMode[] = [
  'telegram_first',
  'sms_first',
  'both',
  'sms_only',
  'telegram_only',
];

function toBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return fallback;
}

function toNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeScheduleTime(raw: string): string {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return '09:00';
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function CreditReminderSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [form, setForm] = useState<CreditReminderForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const credit = (await getSettingsByCategory('credit')) as Record<string, unknown>;
      const channelRaw = String(credit['reminder.channel'] || DEFAULTS.channel)
        .trim()
        .toLowerCase() as ChannelMode;
      setForm({
        enabled: toBool(credit['reminder.enabled'], DEFAULTS.enabled),
        dailyEnabled: toBool(credit['reminder.daily_enabled'], DEFAULTS.dailyEnabled),
        balanceChangeNotify: toBool(
          credit['reminder.balance_change_notify'],
          DEFAULTS.balanceChangeNotify,
        ),
        smsEnabled: toBool(credit['reminder.sms_enabled'], DEFAULTS.smsEnabled),
        telegramEnabled: toBool(credit['reminder.telegram_enabled'], DEFAULTS.telegramEnabled),
        staffInAppEnabled: toBool(
          credit['reminder.staff_in_app_enabled'],
          DEFAULTS.staffInAppEnabled,
        ),
        channel: CHANNELS.includes(channelRaw) ? channelRaw : DEFAULTS.channel,
        scheduleTime: normalizeScheduleTime(
          String(credit['reminder.schedule_time'] || DEFAULTS.scheduleTime),
        ),
        minAmount: Math.max(0, toNum(credit['reminder.min_amount'], DEFAULTS.minAmount)),
        dailySmsLimit: Math.max(0, toNum(credit['reminder.daily_sms_limit'], DEFAULTS.dailySmsLimit)),
        template: String(credit['reminder.template'] || ''),
        defaultDueDays: Math.max(
          1,
          Math.min(365, Math.floor(toNum(credit['due.default_days'], DEFAULTS.defaultDueDays))),
        ),
      });
    } catch (e: unknown) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: e instanceof Error ? e.message : t('settings.creditReminder.loadErr'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (partial: Partial<CreditReminderForm>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = async () => {
    if (!profile?.id) {
      toast({
        title: t('settings.toast.loginRequiredTitle'),
        description: t('settings.toast.loginRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }
    const scheduleTime = normalizeScheduleTime(form.scheduleTime);
    try {
      setSaving(true);
      await bulkUpdateSettings(
        'credit',
        {
          'reminder.enabled': form.enabled,
          'reminder.daily_enabled': form.dailyEnabled,
          'reminder.balance_change_notify': form.balanceChangeNotify,
          'reminder.sms_enabled': form.smsEnabled,
          'reminder.telegram_enabled': form.telegramEnabled,
          'reminder.staff_in_app_enabled': form.staffInAppEnabled,
          'reminder.channel': form.channel,
          'reminder.schedule_time': scheduleTime,
          'reminder.min_amount': Math.max(0, Number(form.minAmount) || 0),
          'reminder.daily_sms_limit': Math.max(0, Math.floor(Number(form.dailySmsLimit) || 0)),
          'reminder.template': String(form.template || '').trim(),
          'due.default_days': Math.max(1, Math.min(365, Math.floor(Number(form.defaultDueDays) || 7))),
        },
        profile.id,
      );
      setForm((prev) => ({ ...prev, scheduleTime }));
      toast({
        title: t('settings.toast.savedTitle'),
        description: t('settings.toast.savedDesc'),
      });
    } catch (e: unknown) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: e instanceof Error ? e.message : t('settings.toast.saveErr'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="text-sm">{t('settings.common.loading')}</span>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.creditReminder.title')}</CardTitle>
        <CardDescription>{t('settings.creditReminder.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label>{t('settings.creditReminder.enabled')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.creditReminder.enabledHint')}</p>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label>{t('settings.creditReminder.dailyEnabled')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.creditReminder.dailyEnabledHint')}</p>
          </div>
          <Switch
            checked={form.dailyEnabled}
            onCheckedChange={(v) => patch({ dailyEnabled: v })}
            disabled={!form.enabled}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label>{t('settings.creditReminder.balanceChangeNotify')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.creditReminder.balanceChangeNotifyHint')}
            </p>
          </div>
          <Switch
            checked={form.balanceChangeNotify}
            onCheckedChange={(v) => patch({ balanceChangeNotify: v })}
            disabled={!form.enabled}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="credit-schedule">{t('settings.creditReminder.scheduleTime')}</Label>
            <Input
              id="credit-schedule"
              type="time"
              value={form.scheduleTime}
              onChange={(e) => patch({ scheduleTime: e.target.value })}
              disabled={!form.enabled}
            />
            <p className="text-xs text-muted-foreground">{t('settings.creditReminder.scheduleHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="credit-min">{t('settings.creditReminder.minAmount')}</Label>
            <NumberInput
              id="credit-min"
              value={form.minAmount}
              onValueChange={(v) => patch({ minAmount: Math.max(0, Number(v) || 0) })}
              disabled={!form.enabled}
              min={0}
              allowZero
            />
            <p className="text-xs text-muted-foreground">{t('settings.creditReminder.minAmountHint')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('settings.creditReminder.channel')}</Label>
          <Select
            value={form.channel}
            onValueChange={(v) => patch({ channel: v as ChannelMode })}
            disabled={!form.enabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((ch) => (
                <SelectItem key={ch} value={ch}>
                  {t(`settings.creditReminder.channel_${ch}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <Label>{t('settings.creditReminder.smsEnabled')}</Label>
            <Switch
              checked={form.smsEnabled}
              onCheckedChange={(v) => patch({ smsEnabled: v })}
              disabled={!form.enabled}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label>{t('settings.creditReminder.telegramEnabled')}</Label>
            <Switch
              checked={form.telegramEnabled}
              onCheckedChange={(v) => patch({ telegramEnabled: v })}
              disabled={!form.enabled}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.creditReminder.staffInApp')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.creditReminder.staffInAppHint')}</p>
            </div>
            <Switch
              checked={form.staffInAppEnabled}
              onCheckedChange={(v) => patch({ staffInAppEnabled: v })}
              disabled={!form.enabled}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="credit-sms-limit">{t('settings.creditReminder.dailySmsLimit')}</Label>
            <NumberInput
              id="credit-sms-limit"
              value={form.dailySmsLimit}
              onValueChange={(v) => patch({ dailySmsLimit: Math.max(0, Math.floor(Number(v) || 0)) })}
              disabled={!form.enabled}
              min={0}
              allowZero
            />
            <p className="text-xs text-muted-foreground">{t('settings.creditReminder.dailySmsLimitHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="credit-due-days">{t('settings.creditReminder.defaultDueDays')}</Label>
            <NumberInput
              id="credit-due-days"
              value={form.defaultDueDays}
              onValueChange={(v) =>
                patch({ defaultDueDays: Math.max(1, Math.min(365, Math.floor(Number(v) || 7))) })
              }
              disabled={!form.enabled}
              min={1}
              max={365}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="credit-template">{t('settings.creditReminder.template')}</Label>
          <Textarea
            id="credit-template"
            value={form.template}
            onChange={(e) => patch({ template: e.target.value })}
            disabled={!form.enabled}
            rows={3}
            placeholder={t('settings.creditReminder.templatePh')}
          />
          <p className="text-xs text-muted-foreground">{t('settings.creditReminder.templateHint')}</p>
        </div>

        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('settings.creditReminder.envNote')}
        </p>

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={saving}>
            {t('settings.common.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="mr-2 h-4 w-4" aria-hidden />
            )}
            {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
