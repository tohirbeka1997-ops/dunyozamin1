import { useState } from 'react';
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
import { staffLogin } from '@/api/client';
import { saveSession } from '@/auth/session';
import { getOrCreateDeviceId } from '@/lib/device';
import { t } from '@/i18n';

export default function LoginScreen() {
  const router = useRouter();
  const [tenant, setTenant] = useState(process.env.EXPO_PUBLIC_DEFAULT_TENANT || 'default');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    if (!tenant.trim() || !username.trim() || !password) {
      setError(t('credentialsRequired'));
      return;
    }
    setLoading(true);
    try {
      const deviceId = await getOrCreateDeviceId();
      const result = await staffLogin({
        tenant: tenant.trim(),
        username: username.trim(),
        password,
        device_id: deviceId,
        platform: Platform.OS,
      });
      await saveSession(result, result.user);
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
      <View style={styles.card}>
        <Text style={styles.kicker}>DunyoZamin</Text>
        <Text style={styles.title}>{t('appName')}</Text>
        <Text style={styles.subtitle}>Onlayn buyurtmalar</Text>

        <Text style={styles.label}>{t('tenant')}</Text>
        <TextInput
          style={styles.input}
          value={tenant}
          onChangeText={setTenant}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="default"
        />

        <Text style={styles.label}>{t('username')}</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="email yoki username"
        />

        <Text style={styles.label}>{t('password')}</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />

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
