import { useCallback, useEffect } from 'react';
import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasSession } from '@/auth/session';
import { useQueueBadge } from '@/hooks/useQueueBadge';
import { t } from '@/i18n';
import { hydrateCart, useCartItemCount } from '@/store/cart';

const HIDDEN_TAB = { href: null } as const;
const ACTIVE = '#166534';
const INACTIVE = '#94a3b8';

function TabIcon({
  name,
  color,
  size,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabsLayout() {
  const router = useRouter();
  const cartCount = useCartItemCount();
  const queueBadge = useQueueBadge();

  useEffect(() => {
    void hydrateCart();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void hasSession().then((ok) => {
        if (!ok) router.replace('/(auth)/login');
      });
    }, [router]),
  );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: ACTIVE },
        headerTintColor: '#fff',
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
      }}
    >
      <Tabs.Screen
        name="sell"
        options={{
          title: t('sell'),
          tabBarLabel: t('sell'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="pricetag-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: t('cart'),
          tabBarLabel: t('cart'),
          tabBarBadge: cartCount > 0 ? cartCount : undefined,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="cart-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('orders'),
          tabBarLabel: t('orders'),
          tabBarBadge: queueBadge > 0 ? queueBadge : undefined,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="list-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="shift"
        options={{
          title: t('shift'),
          tabBarLabel: t('shift'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="time-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('more'),
          tabBarLabel: t('more'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="grid-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen name="index" options={{ ...HIDDEN_TAB, title: t('queues') }} />
      <Tabs.Screen name="products" options={{ ...HIDDEN_TAB, title: t('products') }} />
      <Tabs.Screen name="customers" options={{ ...HIDDEN_TAB, title: t('customers') }} />
      <Tabs.Screen name="suppliers" options={{ ...HIDDEN_TAB, title: t('suppliers') }} />
      <Tabs.Screen name="purchasing" options={{ ...HIDDEN_TAB, title: t('purchasing') }} />
      <Tabs.Screen name="profile" options={{ ...HIDDEN_TAB, title: t('profile') }} />
    </Tabs>
  );
}
