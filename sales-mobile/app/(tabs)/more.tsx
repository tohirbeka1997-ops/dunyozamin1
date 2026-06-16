import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '@/i18n';

type HubLink = {
  titleKey: string;
  route: string;
  icon: string;
};

const LINKS: HubLink[] = [
  { titleKey: 'products', route: '/(tabs)/products', icon: '📦' },
  { titleKey: 'customers', route: '/(tabs)/customers', icon: '👤' },
  { titleKey: 'suppliers', route: '/(tabs)/suppliers', icon: '🚚' },
  { titleKey: 'purchasing', route: '/(tabs)/purchasing', icon: '🛒' },
  { titleKey: 'expenses', route: '/expenses', icon: '💸' },
  { titleKey: 'queues', route: '/(tabs)/index', icon: '📋' },
  { titleKey: 'profile', route: '/(tabs)/profile', icon: '⚙️' },
];

export default function MoreScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t('moreMenu')}</Text>
      <View style={styles.grid}>
        {LINKS.map((link) => (
          <Pressable
            key={link.route}
            style={styles.card}
            onPress={() => router.push(link.route as never)}
          >
            <Text style={styles.icon}>{link.icon}</Text>
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
  icon: { fontSize: 28, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
});
