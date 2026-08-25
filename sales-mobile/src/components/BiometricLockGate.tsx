import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePathname } from 'expo-router';
import { clearSessionAndGoToLogin, hasSession } from '@/auth/session';
import {
  authenticateBiometric,
  shouldRequireBiometricLock,
  subscribeBiometricForeground,
  touchAppActive,
} from '@/lib/biometrics';
import { t } from '@/i18n';

function isAuthRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname.includes('(auth)') || pathname.endsWith('/login') || pathname === '/login';
}

/**
 * App-wide resume lock: after background ≥ grace, require biometric again
 * while a session exists (skipped on login screen / when biometrics unavailable).
 */
export function BiometricLockGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [locked, setLocked] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const checkingRef = useRef(false);
  const promptingRef = useRef(false);

  const runUnlock = useCallback(async () => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    setPrompting(true);
    try {
      const ok = await authenticateBiometric(t('unlockPrompt'));
      if (ok) {
        await touchAppActive();
        setLocked(false);
      }
    } finally {
      promptingRef.current = false;
      setPrompting(false);
    }
  }, []);

  const onForeground = useCallback(async () => {
    if (checkingRef.current) return;
    if (isAuthRoute(pathname)) {
      setLocked(false);
      return;
    }
    checkingRef.current = true;
    try {
      const authed = await hasSession();
      if (!authed) {
        setLocked(false);
        return;
      }
      const need = await shouldRequireBiometricLock();
      if (need) {
        setLocked(true);
      } else {
        await touchAppActive();
        setLocked(false);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [pathname]);

  useEffect(() => subscribeBiometricForeground(() => {
    void onForeground();
  }), [onForeground]);

  useEffect(() => {
    if (!locked) return;
    void runUnlock();
  }, [locked, runUnlock]);

  useEffect(() => {
    if (isAuthRoute(pathname)) setLocked(false);
  }, [pathname]);

  return (
    <>
      {children}
      <Modal visible={locked} animationType="fade" transparent={false} onRequestClose={() => {}}>
        <View style={styles.center}>
          <Text style={styles.title}>{t('unlockTitle')}</Text>
          <Text style={styles.hint}>{t('biometricLockHint')}</Text>
          {prompting ? (
            <ActivityIndicator size="large" color="#166534" style={{ marginVertical: 24 }} />
          ) : (
            <Text style={styles.fail}>{t('unlockFailed')}</Text>
          )}
          <Pressable
            style={[styles.retry, prompting && styles.disabled]}
            onPress={() => void runUnlock()}
            disabled={prompting}
          >
            <Text style={styles.retryText}>{t('retry')}</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() => void clearSessionAndGoToLogin()}
            disabled={prompting}
          >
            <Text style={styles.secondaryText}>{t('loginWithPassword')}</Text>
          </Pressable>
          <Pressable style={styles.linkBtn} onPress={() => void clearSessionAndGoToLogin()}>
            <Text style={styles.linkText}>{t('logout')}</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  hint: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 16 },
  fail: { fontSize: 14, color: '#dc2626', marginBottom: 24, textAlign: 'center' },
  retry: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginBottom: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  disabled: { opacity: 0.6 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondary: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginBottom: 12,
    minWidth: 220,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#166534',
  },
  secondaryText: { color: '#166534', fontWeight: '600', fontSize: 16 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  linkText: { color: '#64748b', fontWeight: '600', fontSize: 15 },
});
