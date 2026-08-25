import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadUser } from '@/auth/session';
import { t } from '@/i18n';
import {
  canAccessExpenses,
  canAccessPurchasing,
  canAccessSuppliers,
  canAccessWebOrders,
} from '@/lib/staffAccess';

type HubLink = {
  titleKey: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  allowed: (role?: string | null) => boolean;
};

const LINKS: HubLink[] = [
  { titleKey: 'products', route: '/(tabs)/products', icon: 'cube-outline', allowed: () => true },
  { titleKey: 'customers', route: '/(tabs)/customers', icon: 'person-outline', allowed: () => true },
  {
    titleKey: 'suppliers',
    route: '/(tabs)/suppliers',
    icon: 'bus-outline',
    allowed: canAccessSuppliers,
  },
  {
    titleKey: 'purchasing',
    route: '/(tabs)/purchasing',
    icon: 'basket-outline',
    allowed: canAccessPurchasing,
  },
  { titleKey: 'expenses', route: '/expenses', icon: 'wallet-outline', allowed: canAccessExpenses },
  { titleKey: 'queues', route: '/(tabs)/index', icon: 'layers-outline', allowed: canAccessWebOrders },
  { titleKey: 'profile', route: '/(tabs)/profile', icon: 'settings-outline', allowed: () => true },
];

export default function MoreScreen() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    void loadUser().then((u) => setRole(u?.role ?? null));
  }, []);

  const visible = LINKS.filter((link) => link.allowed(role));

  const onPress = useCallback(
    (route: string) => {
      router.push(route as never);
    },
    [router],
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t('moreMenu')}</Text>
      <View style={styles.grid}>
        {visible.map((link) => (
          <Pressable key={link.route} style={styles.card} onPress={() => onPress(link.route)}>
            <View style={styles.iconWrap}>
              <Ionicons name={link.icon} size={28} color="#166534" />
            </View>
            <Text style={styles.cardTitle}>{t(link.titleKey)}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 32 },
  heading: { fontSize: 15, color: '#64748b', marginBottom: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    alignItems: 'center',
    minHeight: 100,
    justifyContent: 'center',
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
});
