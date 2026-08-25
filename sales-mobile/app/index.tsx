import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { APP_VERSION_LABEL, BOOT_BANNER } from '@/lib/bootBanner';

/**
 * Cold start: paint an unmistakable frame first so we can tell
 * install vs blank/crash. Then go to login (no SecureStore / biometrics / push).
 */
export default function Index() {
  const [go, setGo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGo(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!go) {
    return (
      <View style={styles.boot} testID="boot-ok-screen">
        <Text style={styles.banner}>{BOOT_BANNER}</Text>
        <Text style={styles.title}>DZ Sotuvchi</Text>
        <Text style={styles.ver}>v{APP_VERSION_LABEL}</Text>
        <Text style={styles.hint}>Agar shu yozuv ko‘rinsa — APK ochildi</Text>
      </View>
    );
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: '#166534',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  banner: {
    color: '#fef08c',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 16,
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  ver: { color: '#bbf7d0', fontSize: 16, marginTop: 8, fontWeight: '700' },
  hint: {
    color: '#dcfce7',
    fontSize: 13,
    marginTop: 20,
    textAlign: 'center',
    lineHeight: 18,
  },
});
