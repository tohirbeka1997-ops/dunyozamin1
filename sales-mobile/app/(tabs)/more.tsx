import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { staffLogout } from '@/api/client';
import { loadUser } from '@/auth/session';
import { useQueueBadge } from '@/hooks/useQueueBadge';
import { t } from '@/i18n';
import {
  canAccessExpenses,
  canAccessPurchasing,
  canAccessSuppliers,
  canAccessWebOrders,
} from '@/lib/staffAccess';
import { clearCart } from '@/store/cart';
import type { StaffUser } from '@/types/orders';

type HubGroupId = 'sales' | 'ops' | 'settings';

type HubLink = {
  titleKey: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  group: HubGroupId;
  allowed: (role?: string | null) => boolean;
  badge?: 'queues';
};

const LINKS: HubLink[] = [
  {
    titleKey: 'dashboard',
    route: '/(tabs)/dashboard',
    icon: 'stats-chart-outline',
    group: 'sales',
    allowed: () => true,
  },
  {
    titleKey: 'products',
    route: '/(tabs)/products',
    icon: 'cube-outline',
    group: 'sales',
    allowed: () => true,
  },
  {
    titleKey: 'customers',
    route: '/(tabs)/customers',
    icon: 'person-outline',
    group: 'sales',
    allowed: () => true,
  },
  {
    titleKey: 'queues',
    route: '/(tabs)/index',
    icon: 'layers-outline',
    group: 'sales',
    allowed: canAccessWebOrders,
    badge: 'queues',
  },
  {
    titleKey: 'suppliers',
    route: '/(tabs)/suppliers',
    icon: 'bus-outline',
    group: 'ops',
    allowed: canAccessSuppliers,
  },
  {
    titleKey: 'purchasing',
    route: '/(tabs)/purchasing',
    icon: 'basket-outline',
    group: 'ops',
    allowed: canAccessPurchasing,
  },
  {
    titleKey: 'expenses',
    route: '/expenses',
    icon: 'wallet-outline',
    group: 'ops',
    allowed: canAccessExpenses,
  },
  {
    titleKey: 'profile',
    route: '/(tabs)/profile',
    icon: 'settings-outline',
    group: 'settings',
    allowed: () => true,
  },
  {
    titleKey: 'privacy',
    route: '/privacy',
    icon: 'shield-checkmark-outline',
    group: 'settings',
    allowed: () => true,
  },
];

const GROUP_ORDER: HubGroupId[] = ['sales', 'ops', 'settings'];
const GROUP_TITLE: Record<HubGroupId, string> = {
  sales: 'moreGroupSales',
  ops: 'moreGroupOps',
  settings: 'moreGroupSettings',
};

export default function MoreScreen() {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const queueBadge = useQueueBadge();

  useFocusEffect(
    useCallback(() => {
      void loadUser().then(setUser);
    }, []),
  );

  useEffect(() => {
    void loadUser().then(setUser);
  }, []);

  const role = user?.role ?? null;
  const visible = useMemo(() => LINKS.filter((link) => link.allowed(role)), [role]);

  const groups = useMemo(() => {
    return GROUP_ORDER.map((id) => ({
      id,
      titleKey: GROUP_TITLE[id],
      links: visible.filter((l) => l.group === id),
    })).filter((g) => g.links.length > 0);
  }, [visible]);

  const onPress = useCallback(
    (route: string) => {
      router.push(route as never);
    },
    [router],
  );

  async function handleLogout() {
    Alert.alert(t('logout'), t('logoutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('logout'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            clearCart();
            await staffLogout();
            router.replace('/(auth)/login');
          })();
        },
      },
    ]);
  }

  const displayName = user?.full_name || user?.username || '—';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.userCard}>
        <View style={styles.userIcon}>
          <Ionicons name="person" size={22} color="#166534" />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.userRole} numberOfLines={1}>
            {user?.role ? `${t('role')}: ${user.role}` : t('profile')}
          </Text>
        </View>
        <Pressable style={styles.logoutBtn} onPress={handleLogout} hitSlop={8}>
          <Text style={styles.logoutText}>{t('logout')}</Text>
        </Pressable>
      </View>

      {groups.map((group) => (
        <View key={group.id} style={styles.section}>
          <Text style={styles.sectionTitle}>{t(group.titleKey)}</Text>
          <View style={styles.list}>
            {group.links.map((link, index) => {
              const badge =
                link.badge === 'queues' && queueBadge > 0 ? queueBadge : 0;
              const isLast = index === group.links.length - 1;
              return (
                <Pressable
                  key={link.route}
                  style={[styles.row, !isLast && styles.rowBorder]}
                  onPress={() => onPress(link.route)}
                >
                  <View style={styles.iconWrap}>
                    <Ionicons name={link.icon} size={20} color="#166534" />
                  </View>
                  <Text style={styles.rowTitle}>{t(link.titleKey)}</Text>
                  {badge > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 12, paddingBottom: 28 },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    padding: 10,
    marginBottom: 14,
    gap: 10,
  },
  userIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  userRole: { fontSize: 12, color: '#64748b', marginTop: 1 },
  logoutBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  logoutText: { fontSize: 12, fontWeight: '600', color: '#dc2626' },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 6,
    marginLeft: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  list: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 10,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
