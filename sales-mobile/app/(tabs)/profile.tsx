import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { staffLogout } from '@/api/client';
import { loadUser } from '@/auth/session';
import {
  isBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled,
} from '@/lib/biometrics';
import { getOfflineQueueCount, getPermanentSyncFailures, clearPermanentFailures } from '@/lib/offlineQueue';
import { syncWithFeedback } from '@/lib/syncFeedback';
import type { QueuedSale } from '@/lib/offlineQueue';
import {
  isNotificationsEnabled,
  setNotificationsEnabled,
} from '@/lib/notificationsPref';
import { getLocale, setLocale, t, type Locale } from '@/i18n';
import type { StaffUser } from '@/types/orders';

const LOCALES: Locale[] = ['uz', 'ru', 'en'];

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [notifOn, setNotifOn] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [failedItems, setFailedItems] = useState<QueuedSale[]>([]);

  const refreshSyncState = useCallback(async () => {
    setPendingSync(await getOfflineQueueCount());
    setFailedItems(await getPermanentSyncFailures());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadUser().then(setUser);
      setLocaleState(getLocale());
      void isBiometricAvailable().then(setBioAvailable);
      void isBiometricEnabled().then(setBioOn);
      void isNotificationsEnabled().then(setNotifOn);
      void refreshSyncState().then(() =>
        syncWithFeedback().then(() => refreshSyncState()),
      );
    }, [refreshSyncState]),
  );

  async function handleLogout() {
    await staffLogout();
    router.replace('/(auth)/login');
  }

  function pickLocale(loc: Locale) {
    setLocale(loc);
    setLocaleState(loc);
  }

  async function toggleBiometric(next: boolean) {
    setBioOn(next);
    await setBiometricEnabled(next);
  }

  async function toggleNotifications(next: boolean) {
    setNotifOn(next);
    await setNotificationsEnabled(next);
  }

  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncWithFeedback();
      await refreshSyncState();
    } finally {
      setSyncing(false);
    }
  }

  async function dismissFailed() {
    await clearPermanentFailures();
    await refreshSyncState();
  }

  function confirmLogout() {
    Alert.alert(t('logout'), '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: () => void handleLogout() },
    ]);
  }

  const appVersion = Constants.expoConfig?.version || '—';

  return (
    <View style={styles.root}>
      {/* Akkaunt */}
      <View style={styles.card}>
        <Text style={styles.userName}>{user?.full_name || user?.username || '—'}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('role')}</Text>
          <Text style={styles.metaValue}>{user?.role || '—'}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('store')}</Text>
          <Text style={styles.metaValue}>{user?.tenant || '—'}</Text>
        </View>
      </View>

      {/* Til */}
      <Text style={styles.section}>{t('language')}</Text>
      <View style={styles.langRow}>
        {LOCALES.map((loc) => (
          <Pressable
            key={loc}
            style={[styles.langBtn, locale === loc && styles.langBtnActive]}
            onPress={() => pickLocale(loc)}
          >
            <Text style={[styles.langText, locale === loc && styles.langTextActive]}>
              {loc.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Bildirishnomalar */}
      <Text style={styles.section}>{t('notifications')}</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchTextWrap}>
          <Text style={styles.switchTitle}>{t('notifications')}</Text>
          <Text style={styles.switchHint}>{t('notificationsHint')}</Text>
        </View>
        <Switch
          value={notifOn}
          onValueChange={(v) => void toggleNotifications(v)}
          trackColor={{ true: '#166534', false: '#cbd5e1' }}
        />
      </View>

      {pendingSync > 0 ? (
        <>
          <Text style={styles.section}>{t('pendingSync')}</Text>
          <Pressable style={styles.syncCard} onPress={() => void handleSyncNow()} disabled={syncing}>
            <Text style={styles.syncTitle}>
              {t('pendingSyncCount').replace('{n}', String(pendingSync))}
            </Text>
            <Text style={styles.syncHint}>{syncing ? t('processing') : t('syncNow')}</Text>
          </Pressable>
        </>
      ) : null}

      {failedItems.length > 0 ? (
        <>
          <Text style={styles.section}>{t('syncFailedPermanent')}</Text>
          {failedItems.map((item) => (
            <View key={item.id} style={styles.failCard}>
              <Text style={styles.failTitle}>
                {String(item.created_at || '').slice(0, 16).replace('T', ' ')}
              </Text>
              <Text style={styles.failHint}>
                {t('syncFailedHint')}: {item.last_error || t('saleFailed')}
              </Text>
            </View>
          ))}
          <Pressable style={styles.dismissFail} onPress={() => void dismissFailed()}>
            <Text style={styles.dismissFailText}>{t('cancel')}</Text>
          </Pressable>
        </>
      ) : null}

      {/* Xavfsizlik */}
      {bioAvailable ? (
        <>
          <Text style={styles.section}>{t('security')}</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>{t('biometricLock')}</Text>
              <Text style={styles.switchHint}>{t('biometricLockHint')}</Text>
            </View>
            <Switch
              value={bioOn}
              onValueChange={(v) => void toggleBiometric(v)}
              trackColor={{ true: '#166534', false: '#cbd5e1' }}
            />
          </View>
        </>
      ) : null}

      <View style={styles.spacer} />

      <Text style={styles.version}>
        {t('appVersion')} {appVersion}
      </Text>

      <Pressable style={styles.logout} onPress={confirmLogout}>
        <Text style={styles.logoutText}>{t('logout')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc', padding: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  userName: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  metaLabel: { fontSize: 14, color: '#64748b' },
  metaValue: { fontSize: 14, fontWeight: '600', color: '#334155', textTransform: 'capitalize' },
  section: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 10 },
  langRow: { flexDirection: 'row', gap: 8, marginBottom: 28 },
  langBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  langBtnActive: { backgroundColor: '#166534', borderColor: '#166534' },
  langText: { fontWeight: '600', color: '#334155' },
  langTextActive: { color: '#fff' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
  },
  switchTextWrap: { flex: 1, paddingRight: 12 },
  switchTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  switchHint: { fontSize: 12, color: '#64748b', marginTop: 2 },
  syncCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    padding: 14,
    marginBottom: 20,
  },
  syncTitle: { fontSize: 15, fontWeight: '600', color: '#1e40af' },
  syncHint: { fontSize: 13, color: '#3b82f6', marginTop: 4, fontWeight: '600' },
  failCard: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 14,
    marginBottom: 8,
  },
  failTitle: { fontSize: 14, fontWeight: '600', color: '#991b1b' },
  failHint: { fontSize: 13, color: '#b91c1c', marginTop: 4 },
  dismissFail: { alignSelf: 'flex-end', marginBottom: 16, paddingVertical: 6 },
  dismissFailText: { color: '#64748b', fontWeight: '600' },
  spacer: { flex: 1 },
  version: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginBottom: 12 },
  logout: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: { color: '#dc2626', fontWeight: '600', fontSize: 16 },
});
