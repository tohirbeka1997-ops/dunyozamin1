import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type PosNetConfig = {
  mode?: string;
  configPath?: string;
  localDbPath?: string;
  host?: { port?: number; secret?: string };
  client?: { hostUrl?: string; secret?: string };
};

type Props = {
  config: PosNetConfig;
  loading: boolean;
  saving: boolean;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
  onChange: (next: PosNetConfig) => void;
  onReload: () => void;
  onTest: () => void;
  onSave: () => void;
};

export function DatabaseSourceSettings({
  config,
  loading,
  saving,
  testing,
  testResult,
  onChange,
  onReload,
  onTest,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const isRemote = config.mode === 'client';

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('settings.network.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-xs">{t('settings.network.restartRequired')}</AlertDescription>
      </Alert>

      <div className="space-y-3">
        <Label>{t('settings.network.databaseSource')}</Label>
        <RadioGroup
          value={isRemote ? 'remote' : 'local'}
          onValueChange={(value) => {
            onChange({ ...config, mode: value === 'remote' ? 'client' : 'host' });
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          <label
            htmlFor="db-source-local"
            className="flex cursor-pointer gap-3 rounded-lg border p-4 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-muted/40"
          >
            <RadioGroupItem value="local" id="db-source-local" className="mt-1" />
            <div>
              <div className="font-medium">{t('settings.network.databaseSourceLocal')}</div>
              <p className="text-xs text-muted-foreground">{t('settings.network.databaseSourceLocalDesc')}</p>
            </div>
          </label>
          <label
            htmlFor="db-source-remote"
            className="flex cursor-pointer gap-3 rounded-lg border p-4 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-muted/40"
          >
            <RadioGroupItem value="remote" id="db-source-remote" className="mt-1" />
            <div>
              <div className="font-medium">{t('settings.network.databaseSourceRemote')}</div>
              <p className="text-xs text-muted-foreground">{t('settings.network.databaseSourceRemoteDesc')}</p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {!isRemote && config.localDbPath ? (
        <div className="space-y-2">
          <Label>{t('settings.network.localDbPath')}</Label>
          <Input value={String(config.localDbPath)} readOnly className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">{t('settings.network.localDbPathHint')}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label>{t('settings.network.configFile')}</Label>
        <Input value={config.configPath || ''} readOnly className="font-mono text-xs" />
        <p className="text-xs text-muted-foreground">{t('settings.network.configFileHint')}</p>
      </div>

      {isRemote ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('settings.network.clientUrl')}</Label>
            <Input
              value={String(config.client?.hostUrl || '')}
              onChange={(e) => {
                onChange({ ...config, client: { ...config.client, hostUrl: e.target.value } });
              }}
              placeholder="http://192.168.1.10:3333"
            />
            <p className="text-xs text-muted-foreground">{t('settings.network.clientUrlHint')}</p>
          </div>
          <div className="space-y-2">
            <Label>{t('settings.network.clientSecret')}</Label>
            <Input
              value={String(config.client?.secret || '')}
              onChange={(e) => {
                onChange({ ...config, client: { ...config.client, secret: e.target.value } });
              }}
              placeholder={t('settings.network.clientSecretPh')}
            />
            <p className="text-xs text-muted-foreground">{t('settings.network.clientSecretHint')}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="text-sm font-semibold">{t('settings.network.hostLanTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.network.hostLanDesc')}</p>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('settings.network.hostPort')}</Label>
              <Input
                value={String(config.host?.port ?? 3333)}
                onChange={(e) => {
                  const n = Number(e.target.value || 0);
                  onChange({ ...config, host: { ...config.host, port: n } });
                }}
                placeholder="3333"
              />
              <p className="text-xs text-muted-foreground">{t('settings.network.hostPortHint')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('settings.network.hostSecret')}</Label>
              <Input
                value={String(config.host?.secret || '')}
                onChange={(e) => {
                  onChange({ ...config, host: { ...config.host, secret: e.target.value } });
                }}
                placeholder={t('settings.network.hostSecretPh')}
              />
              <p className="text-xs text-muted-foreground">{t('settings.network.hostSecretHint')}</p>
            </div>
          </div>
        </div>
      )}

      {testResult && (
        <Alert variant={testResult.ok ? 'default' : 'destructive'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{testResult.ok ? t('settings.network.connOk') : t('settings.network.connFail')}</AlertTitle>
          <AlertDescription className="text-xs">{testResult.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-3 border-t pt-6">
        <Button variant="outline" onClick={onReload} disabled={loading || saving}>
          {t('settings.network.reload')}
        </Button>
        {isRemote && (
          <Button variant="outline" onClick={onTest} disabled={testing || saving}>
            {testing ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t('settings.network.testing')}
              </>
            ) : (
              t('settings.network.testConn')
            )}
          </Button>
        )}
        <Button onClick={onSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? t('settings.network.saving') : t('settings.network.saveRestart')}
        </Button>
      </div>
    </div>
  );
}
