import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { APP_VERSION_LABEL, BOOT_BANNER } from '@/lib/bootBanner';
import { t } from '@/i18n';

const REMEMBER_KEYS = {
  enabled: 'dz_staff_remember_login',
  username: 'dz_staff_saved_username',
  password: 'dz_staff_saved_password',
} as const;

const DEFAULT_TENANT = process.env.EXPO_PUBLIC_DEFAULT_TENANT || 'default';

export default function LoginScreen() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getItem } = await import('@/lib/secureStorage');
        const [enabled, savedUser, savedPass] = await Promise.all([
          getItem(REMEMBER_KEYS.enabled),
          getItem(REMEMBER_KEYS.username),
          getItem(REMEMBER_KEYS.password),
        ]);
        if (cancelled) return;
        const on = enabled !== '0';
        setRememberLogin(on);
        if (on && savedUser) setUsername(savedUser);
        if (on && savedPass) setPassword(savedPass);
      } catch {
        // ignore — empty form is fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persistRememberedCredentials() {
    const { setItem, deleteItem } = await import('@/lib/secureStorage');
    if (rememberLogin) {
      await setItem(REMEMBER_KEYS.enabled, '1');
      await setItem(REMEMBER_KEYS.username, username.trim());
      await setItem(REMEMBER_KEYS.password, password);
    } else {
      await setItem(REMEMBER_KEYS.enabled, '0');
      await deleteItem(REMEMBER_KEYS.username);
      await deleteItem(REMEMBER_KEYS.password);
    }
  }

  async function handleLogin() {
    setError(null);
    if (!username.trim() || !password) {
      setError(t('credentialsRequired'));
      return;
    }
    setLoading(true);
    try {
      // Lazy-load after first paint — native SecureStore / API must not blank boot.
      const [{ staffLogin }, { saveSession }, { getOrCreateDeviceId }, { schedulePushRegistration }] =
        await Promise.all([
          import('@/api/client'),
          import('@/auth/session'),
          import('@/lib/device'),
          import('@/lib/pushNotifications'),
        ]);
      const deviceId = await getOrCreateDeviceId();
      const result = await staffLogin({
        tenant: DEFAULT_TENANT,
        username: username.trim(),
        password,
        device_id: deviceId,
        platform: Platform.OS,
      });
      await saveSession(result, result.user);
      await persistRememberedCredentials();
      schedulePushRegistration();
      router.replace('/(tabs)/sell');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Xatolik';
      if (msg.includes('Network') || msg.includes('Failed to fetch')) {
        setError(t('networkError'));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.bootStrip}>
        <Text style={styles.bootStripText}>{BOOT_BANNER}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.kicker}>DunyoZamin | v{APP_VERSION_LABEL}</Text>
        <Text style={styles.title}>{t('appName')}</Text>
        <Text style={styles.subtitle}>Onlayn buyurtmalar</Text>

        <Text style={styles.label}>{t('username')}</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="username"
          textContentType="username"
          placeholder="email yoki username"
        />

        <Text style={styles.label}>{t('password')}</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          placeholder="••••••••"
        />

        <Pressable
          style={styles.rememberRow}
          onPress={() => setRememberLogin((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rememberLogin }}
        >
          <View style={[styles.checkbox, rememberLogin && styles.checkboxOn]}>
            {rememberLogin ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.rememberLabel}>{t('rememberLogin')}</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('login')}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f0fdf4',
    justifyContent: 'center',
    padding: 24,
  },
  bootStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#14532d',
    paddingTop: 40,
    paddingBottom: 10,
    alignItems: 'center',
    zIndex: 10,
  },
  bootStripText: {
    color: '#fef08c',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  kicker: { fontSize: 13, color: '#166534', fontWeight: '600', marginBottom: 4 },
  title: { fontSize: 28, fontWeight: '700', color: '#14532d' },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#f8fafc',
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  rememberLabel: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '500',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#dc2626', marginTop: 12, fontSize: 13 },
});
