import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { bulkUpdateSettings, getSettingsByCategory } from '@/db/api';
import { Loader2, Save, Send, Sparkles } from 'lucide-react';

type TelegramReportsForm = {
  enabled: boolean;
  chatId: string;
  creditSale: boolean;
  shiftClosed: boolean;
  dailyDigest: boolean;
  balanceChange: boolean;
  aiEnabled: boolean;
  aiMarketing: boolean;
  morningBrief: boolean;
  morningBriefTime: string;
  dailyPoster: boolean;
  dailyPosterTime: string;
  weeklyAi: boolean;
  weeklyAiTime: string;
  weeklyAiWeekday: string;
  eveningPackage: boolean;
  botButtons: boolean;
  scheduleTime: string;
};

const DEFAULTS: TelegramReportsForm = {
  enabled: false,
  chatId: '',
  creditSale: true,
  shiftClosed: true,
  dailyDigest: true,
  balanceChange: true,
  aiEnabled: false,
  aiMarketing: true,
  morningBrief: true,
  morningBriefTime: '08:00',
  dailyPoster: true,
  dailyPosterTime: '10:00',
  weeklyAi: false,
  weeklyAiTime: '08:00',
  weeklyAiWeekday: '1',
  eveningPackage: false,
  botButtons: true,
  scheduleTime: '21:00',
};

function toBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return fallback;
}

function normalizeScheduleTime(raw: string, fallback = '21:00'): string {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return fallback;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

type SendResult = {
  ok?: boolean;
  reason?: string;
  hint?: string;
  sent?: number;
  mode?: string;
  fallbackReason?: string;
};

type AiKeyStatus = {
  hasApiKey?: boolean;
  hasOpenAi?: boolean;
  hasGemini?: boolean;
  provider?: string | null;
  model?: string | null;
};

function unwrapIpcResult<T extends object>(raw: unknown): T {
  if (raw && typeof raw === 'object') {
    const obj = raw as { success?: boolean; data?: T; error?: { code?: string; message?: string } };
    if (obj.success === false && obj.error) {
      return {
        ok: false,
        reason: obj.error.code || 'error',
        hint: obj.error.message || undefined,
      } as unknown as T;
    }
    if ('data' in obj) {
      return (obj.data || {}) as T;
    }
  }
  return (raw || {}) as T;
}

function formatSendFailDesc(
  out: SendResult,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const reason = String(out?.reason || '').trim();
  if (reason === 'no_chat_id' || reason === 'no_channel_id') {
    return t('settings.telegramReports.noChatIdHint');
  }
  if (reason === 'no_bot_token' || reason === 'no_credentials' || reason === 'no_token_or_chat') {
    return t('settings.telegramReports.noTokenHint');
  }
  if (reason === 'chat_not_found') {
    return t('settings.telegramReports.errChatNotFound');
  }
  if (reason === 'bot_not_admin') {
    return t('settings.telegramReports.errBotNotAdmin');
  }
  if (reason === 'invalid_bot_token') {
    return t('settings.telegramReports.errInvalidToken');
  }
  if (reason === 'NOT_FOUND' || /unknown channel/i.test(String(out?.hint || ''))) {
    return t('settings.telegramReports.errUnknownChannel');
  }
  if (out?.hint) return String(out.hint);
  if (reason && reason !== 'unknown') return reason;
  return t('settings.telegramReports.errUnknown');
}

export function TelegramReportsSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [form, setForm] = useState<TelegramReportsForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testingPoster, setTestingPoster] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiKeyStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);

  const loadAiStatus = useCallback(async () => {
    try {
      setAiStatusLoading(true);
      const api = (
        window as unknown as {
          posApi?: { settings?: { openaiStatus?: () => Promise<unknown> } };
        }
      )?.posApi?.settings;
      if (!api?.openaiStatus) {
        setAiStatus(null);
        return;
      }
      const out = unwrapIpcResult<AiKeyStatus>(await api.openaiStatus());
      const hasOpenAi = Boolean(out?.hasOpenAi ?? (out?.provider === 'openai' && out?.hasApiKey));
      const hasGemini = Boolean(out?.hasGemini ?? (out?.provider === 'gemini' && out?.hasApiKey));
      const hasApiKey = Boolean(out?.hasApiKey || hasOpenAi || hasGemini);
      setAiStatus({
        hasApiKey,
        hasOpenAi,
        hasGemini,
        provider: out?.provider ?? (hasOpenAi ? 'openai' : hasGemini ? 'gemini' : null),
        model: out?.model ?? null,
      });
    } catch {
      setAiStatus(null);
    } finally {
      setAiStatusLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const reports = (await getSettingsByCategory('reports')) as Record<string, unknown>;
      setForm({
        enabled: toBool(reports['telegram.enabled'], DEFAULTS.enabled),
        chatId: String(reports['telegram.chat_id'] || ''),
        creditSale: toBool(reports['telegram.credit_sale'], DEFAULTS.creditSale),
        shiftClosed: toBool(reports['telegram.shift_closed'], DEFAULTS.shiftClosed),
        dailyDigest: toBool(reports['telegram.daily_digest'], DEFAULTS.dailyDigest),
        balanceChange: toBool(reports['telegram.balance_change'], DEFAULTS.balanceChange),
        aiEnabled: toBool(reports['telegram.ai_enabled'], DEFAULTS.aiEnabled),
        aiMarketing: toBool(reports['telegram.ai_marketing'], DEFAULTS.aiMarketing),
        morningBrief: toBool(reports['telegram.morning_brief'], DEFAULTS.morningBrief),
        morningBriefTime: normalizeScheduleTime(
          String(reports['telegram.morning_brief_time'] || DEFAULTS.morningBriefTime),
          DEFAULTS.morningBriefTime,
        ),
        dailyPoster: toBool(reports['telegram.daily_poster'], DEFAULTS.dailyPoster),
        dailyPosterTime: normalizeScheduleTime(
          String(reports['telegram.daily_poster_time'] || DEFAULTS.dailyPosterTime),
          DEFAULTS.dailyPosterTime,
        ),
        weeklyAi: toBool(reports['telegram.weekly_ai'], DEFAULTS.weeklyAi),
        weeklyAiTime: normalizeScheduleTime(
          String(reports['telegram.weekly_ai_time'] || DEFAULTS.weeklyAiTime),
          DEFAULTS.weeklyAiTime,
        ),
        weeklyAiWeekday: String(
          reports['telegram.weekly_ai_weekday'] ?? DEFAULTS.weeklyAiWeekday,
        ).trim() || DEFAULTS.weeklyAiWeekday,
        eveningPackage: toBool(reports['telegram.evening_package'], DEFAULTS.eveningPackage),
        botButtons: toBool(reports['telegram.bot_buttons'], DEFAULTS.botButtons),
        scheduleTime: normalizeScheduleTime(
          String(reports['telegram.schedule_time'] || DEFAULTS.scheduleTime),
          DEFAULTS.scheduleTime,
        ),
      });
    } catch (e: unknown) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: e instanceof Error ? e.message : t('settings.telegramReports.loadErr'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
    void loadAiStatus();
  }, [load, loadAiStatus]);

  const patch = (partial: Partial<TelegramReportsForm>) => {
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
    const scheduleTime = normalizeScheduleTime(form.scheduleTime, DEFAULTS.scheduleTime);
    const morningBriefTime = normalizeScheduleTime(
      form.morningBriefTime,
      DEFAULTS.morningBriefTime,
    );
    const dailyPosterTime = normalizeScheduleTime(
      form.dailyPosterTime,
      DEFAULTS.dailyPosterTime,
    );
    const weeklyAiTime = normalizeScheduleTime(form.weeklyAiTime, DEFAULTS.weeklyAiTime);
    const weeklyAiWeekday = (() => {
      const n = Number.parseInt(String(form.weeklyAiWeekday || '1'), 10);
      if (!Number.isFinite(n) || n < 0 || n > 6) return DEFAULTS.weeklyAiWeekday;
      return String(n);
    })();
    try {
      setSaving(true);
      await bulkUpdateSettings(
        'reports',
        {
          'reports.telegram.enabled': form.enabled,
          'reports.telegram.chat_id': String(form.chatId || '').trim(),
          'reports.telegram.credit_sale': form.creditSale,
          'reports.telegram.shift_closed': form.shiftClosed,
          'reports.telegram.daily_digest': form.dailyDigest,
          'reports.telegram.balance_change': form.balanceChange,
          'reports.telegram.ai_enabled': form.aiEnabled,
          'reports.telegram.ai_marketing': form.aiMarketing,
          'reports.telegram.morning_brief': form.morningBrief,
          'reports.telegram.morning_brief_time': morningBriefTime,
          'reports.telegram.daily_poster': form.dailyPoster,
          'reports.telegram.daily_poster_time': dailyPosterTime,
          'reports.telegram.weekly_ai': form.weeklyAi,
          'reports.telegram.weekly_ai_time': weeklyAiTime,
          'reports.telegram.weekly_ai_weekday': weeklyAiWeekday,
          'reports.telegram.evening_package': form.eveningPackage,
          'reports.telegram.bot_buttons': form.botButtons,
          'reports.telegram.schedule_time': scheduleTime,
        },
        profile.id,
      );
      setForm((prev) => ({
        ...prev,
        scheduleTime,
        morningBriefTime,
        dailyPosterTime,
        weeklyAiTime,
        weeklyAiWeekday,
      }));
      toast({
        title: t('settings.toast.savedTitle'),
        description: t('settings.toast.savedDesc'),
      });
      void loadAiStatus();
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

  const handleTest = async () => {
    try {
      setTesting(true);
      const api = (
        window as unknown as {
          posApi?: { settings?: { testTelegramReport?: () => Promise<unknown> } };
        }
      )?.posApi?.settings;
      if (!api?.testTelegramReport) {
        throw new Error(t('settings.telegramReports.testDesktopOnly'));
      }
      const out = unwrapIpcResult<SendResult>(await api.testTelegramReport());
      if (out?.ok) {
        toast({
          title: t('settings.telegramReports.testOkTitle'),
          description: t('settings.telegramReports.testOkDesc', { count: out.sent ?? 1 }),
        });
      } else {
        toast({
          title: t('settings.telegramReports.testFailTitle'),
          description: formatSendFailDesc(out, t),
          variant: 'destructive',
        });
      }
    } catch (e: unknown) {
      toast({
        title: t('settings.telegramReports.testFailTitle'),
        description: e instanceof Error ? e.message : t('settings.telegramReports.testFailTitle'),
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestAi = async () => {
    try {
      setTestingAi(true);
      const api = (
        window as unknown as {
          posApi?: { settings?: { testTelegramAiAnalysis?: () => Promise<unknown> } };
        }
      )?.posApi?.settings;
      if (!api?.testTelegramAiAnalysis) {
        throw new Error(t('settings.telegramReports.testDesktopOnly'));
      }
      const out = unwrapIpcResult<SendResult>(await api.testTelegramAiAnalysis());
      if (out?.ok) {
        const modeHint =
          out.mode === 'ai'
            ? t('settings.telegramReports.aiTestOkAi')
            : t('settings.telegramReports.aiTestOkFallback', {
                reason: out.fallbackReason || 'no_api_key',
              });
        toast({
          title: t('settings.telegramReports.aiTestOkTitle'),
          description: `${modeHint} (${t('settings.telegramReports.testOkDesc', { count: out.sent ?? 1 })})`,
        });
      } else {
        toast({
          title: t('settings.telegramReports.aiTestFailTitle'),
          description: formatSendFailDesc(out, t),
          variant: 'destructive',
        });
      }
      void loadAiStatus();
    } catch (e: unknown) {
      toast({
        title: t('settings.telegramReports.aiTestFailTitle'),
        description: e instanceof Error ? e.message : t('settings.telegramReports.aiTestFailTitle'),
        variant: 'destructive',
      });
    } finally {
      setTestingAi(false);
    }
  };

  const handleTestPoster = async () => {
    try {
      setTestingPoster(true);
      const api = (
        window as unknown as {
          posApi?: { settings?: { testTelegramDailyPoster?: () => Promise<unknown> } };
        }
      )?.posApi?.settings;
      if (!api?.testTelegramDailyPoster) {
        throw new Error(t('settings.telegramReports.testDesktopOnly'));
      }
      const out = unwrapIpcResult<SendResult>(await api.testTelegramDailyPoster());
      if (out?.ok) {
        toast({
          title: t('settings.telegramReports.posterTestOkTitle'),
          description: t('settings.telegramReports.testOkDesc', { count: out.sent ?? 1 }),
        });
      } else {
        toast({
          title: t('settings.telegramReports.posterTestFailTitle'),
          description: formatSendFailDesc(out, t),
          variant: 'destructive',
        });
      }
    } catch (e: unknown) {
      toast({
        title: t('settings.telegramReports.posterTestFailTitle'),
        description:
          e instanceof Error ? e.message : t('settings.telegramReports.posterTestFailTitle'),
        variant: 'destructive',
      });
    } finally {
      setTestingPoster(false);
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
        <CardTitle>{t('settings.telegramReports.title')}</CardTitle>
        <CardDescription>{t('settings.telegramReports.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label>{t('settings.telegramReports.enabled')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.telegramReports.enabledHint')}</p>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tg_reports_chat">{t('settings.telegramReports.chatId')}</Label>
          <Input
            id="tg_reports_chat"
            value={form.chatId}
            onChange={(e) => patch({ chatId: e.target.value })}
            placeholder="-100xxxxxxxxxx"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{t('settings.telegramReports.chatIdHint')}</p>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <p className="text-sm font-medium">{t('settings.telegramReports.eventsTitle')}</p>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.creditSale')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.telegramReports.creditSaleHint')}</p>
            </div>
            <Switch checked={form.creditSale} onCheckedChange={(v) => patch({ creditSale: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.shiftClosed')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.telegramReports.shiftClosedHint')}</p>
            </div>
            <Switch checked={form.shiftClosed} onCheckedChange={(v) => patch({ shiftClosed: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.dailyDigest')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.telegramReports.dailyDigestHint')}</p>
            </div>
            <Switch checked={form.dailyDigest} onCheckedChange={(v) => patch({ dailyDigest: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.balanceChange')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.balanceChangeHint')}
              </p>
            </div>
            <Switch
              checked={form.balanceChange}
              onCheckedChange={(v) => patch({ balanceChange: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.morningBrief')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.morningBriefHint')}
              </p>
            </div>
            <Switch
              checked={form.morningBrief}
              onCheckedChange={(v) => patch({ morningBrief: v })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tg_morning_time">{t('settings.telegramReports.morningBriefTime')}</Label>
            <Input
              id="tg_morning_time"
              value={form.morningBriefTime}
              onChange={(e) => patch({ morningBriefTime: e.target.value })}
              placeholder="08:00"
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.telegramReports.morningBriefTimeHint')}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.dailyPoster')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.dailyPosterHint')}
              </p>
            </div>
            <Switch
              checked={form.dailyPoster}
              onCheckedChange={(v) => patch({ dailyPoster: v })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tg_poster_time">{t('settings.telegramReports.dailyPosterTime')}</Label>
            <Input
              id="tg_poster_time"
              value={form.dailyPosterTime}
              onChange={(e) => patch({ dailyPosterTime: e.target.value })}
              placeholder="10:00"
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.telegramReports.dailyPosterTimeHint')}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.aiEnabled')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.telegramReports.aiEnabledHint')}</p>
            </div>
            <Switch checked={form.aiEnabled} onCheckedChange={(v) => patch({ aiEnabled: v })} />
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{t('settings.telegramReports.aiStatusLabel')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('settings.telegramReports.aiStatusHint')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {aiStatusLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : aiStatus == null ? (
                  <span className="text-xs text-muted-foreground">
                    {t('settings.telegramReports.aiStatusUnknown')}
                  </span>
                ) : aiStatus.hasApiKey ? (
                  <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    {aiStatus.provider === 'gemini'
                      ? t('settings.telegramReports.aiStatusYesGemini')
                      : t('settings.telegramReports.aiStatusYesOpenAi')}
                    {aiStatus.model ? ` (${aiStatus.model})` : ''}
                  </span>
                ) : (
                  <span className="rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-800 dark:text-amber-400">
                    {t('settings.telegramReports.aiStatusNo')}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadAiStatus()}
                  disabled={aiStatusLoading}
                >
                  {t('settings.telegramReports.aiStatusRefresh')}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.aiMarketing')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.aiMarketingHint')}
              </p>
            </div>
            <Switch
              checked={form.aiMarketing}
              onCheckedChange={(v) => patch({ aiMarketing: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.eveningPackage')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.eveningPackageHint')}
              </p>
            </div>
            <Switch
              checked={form.eveningPackage}
              onCheckedChange={(v) => patch({ eveningPackage: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.weeklyAi')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.weeklyAiHint')}
              </p>
            </div>
            <Switch checked={form.weeklyAi} onCheckedChange={(v) => patch({ weeklyAi: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tg_weekly_time">{t('settings.telegramReports.weeklyAiTime')}</Label>
              <Input
                id="tg_weekly_time"
                value={form.weeklyAiTime}
                onChange={(e) => patch({ weeklyAiTime: e.target.value })}
                placeholder="08:00"
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.weeklyAiTimeHint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tg_weekly_wd">{t('settings.telegramReports.weeklyAiWeekday')}</Label>
              <select
                id="tg_weekly_wd"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.weeklyAiWeekday}
                onChange={(e) => patch({ weeklyAiWeekday: e.target.value })}
              >
                <option value="0">{t('settings.telegramReports.weekdaySun')}</option>
                <option value="1">{t('settings.telegramReports.weekdayMon')}</option>
                <option value="2">{t('settings.telegramReports.weekdayTue')}</option>
                <option value="3">{t('settings.telegramReports.weekdayWed')}</option>
                <option value="4">{t('settings.telegramReports.weekdayThu')}</option>
                <option value="5">{t('settings.telegramReports.weekdayFri')}</option>
                <option value="6">{t('settings.telegramReports.weekdaySat')}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegramReports.weeklyAiWeekdayHint')}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>{t('settings.telegramReports.botButtons')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.telegramReports.botButtonsHint')}</p>
            </div>
            <Switch checked={form.botButtons} onCheckedChange={(v) => patch({ botButtons: v })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tg_digest_time">{t('settings.telegramReports.scheduleTime')}</Label>
            <Input
              id="tg_digest_time"
              value={form.scheduleTime}
              onChange={(e) => patch({ scheduleTime: e.target.value })}
              placeholder="21:00"
            />
            <p className="text-xs text-muted-foreground">{t('settings.telegramReports.scheduleTimeHint')}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t('settings.telegramReports.envNote')}</p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
          </Button>
          <Button variant="outline" onClick={() => void handleTest()} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {t('settings.telegramReports.testSend')}
          </Button>
          <Button variant="secondary" onClick={() => void handleTestAi()} disabled={testingAi}>
            {testingAi ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {t('settings.telegramReports.aiTestSend')}
          </Button>
          <Button variant="outline" onClick={() => void handleTestPoster()} disabled={testingPoster}>
            {testingPoster ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {t('settings.telegramReports.posterTestSend')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
