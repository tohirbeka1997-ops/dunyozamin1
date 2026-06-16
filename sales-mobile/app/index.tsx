import { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { hasSession } from '@/auth/session';
import { authenticateBiometric, isBiometricEnabled } from '@/lib/biometrics';
import { loadStoredLocale, t } from '@/i18n';

type Phase = 'loading' | 'login' | 'locked' | 'ready';

export default function Index() {
  const [phase, setPhase] = useState<Phase>('loading');

  const boot = useCallback(async () => {
    setPhase('loading');
    await loadStoredLocale();
    const authed = await hasSession();
    if (!authed) {
      setPhase('login');
      return;
    }
    const lockOn = await isBiometricEnabled();
    if (!lockOn) {
      setPhase('ready');
      return;
    }
    const ok = await authenticateBiometric(t('unlockPrompt'));
    setPhase(ok ? 'ready' : 'locked');
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (phase === 'locked') {
    return (
      <View style={styles.center}>
        <Text style={styles.lockTitle}>{t('unlockTitle')}</Text>
        <Text style={styles.lockMsg}>{t('unlockFailed')}</Text>
        <Pressable style={styles.retry} onPress={() => void boot()}>
          <Text style={styles.retryText}>{t('retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'ready') return <Redirect href="/(tabs)/sell" />;
  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f8fafc' },
  lockTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  lockMsg: { fontSize: 14, color: '#dc2626', marginBottom: 24 },
  retry: { backgroundColor: '#166534', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 28 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
