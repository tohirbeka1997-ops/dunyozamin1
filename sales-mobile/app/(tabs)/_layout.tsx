import { useCallback } from 'react';

import { Tabs, useFocusEffect, useRouter } from 'expo-router';

import { hasSession } from '@/auth/session';

import { useQueueBadge } from '@/hooks/useQueueBadge';

import { t } from '@/i18n';

import { useCartItemCount } from '@/store/cart';



const HIDDEN_TAB = { href: null } as const;



export default function TabsLayout() {

  const router = useRouter();

  const cartCount = useCartItemCount();
  const queueBadge = useQueueBadge();



  // Guard: protected tabs must not fetch before a session exists (e.g. after

  // server restart cleared tokens, or user deep-linked into a tab).

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

        headerStyle: { backgroundColor: '#166534' },

        headerTintColor: '#fff',

        tabBarActiveTintColor: '#166534',

      }}

    >

      {/* Primary bottom tabs (max 5) */}

      <Tabs.Screen name="sell" options={{ title: t('sell'), tabBarLabel: t('sell') }} />

      <Tabs.Screen

        name="cart"

        options={{

          title: t('cart'),

          tabBarLabel: t('cart'),

          tabBarBadge: cartCount > 0 ? cartCount : undefined,

        }}

      />

      <Tabs.Screen
        name="orders"
        options={{
          title: t('orders'),
          tabBarLabel: t('orders'),
          tabBarBadge: queueBadge > 0 ? queueBadge : undefined,
        }}
      />

      <Tabs.Screen name="shift" options={{ title: t('shift'), tabBarLabel: t('shift') }} />

      <Tabs.Screen name="more" options={{ title: t('more'), tabBarLabel: t('more') }} />



      {/* Accessible via Boshqa hub — hidden from tab bar */}

      <Tabs.Screen name="index" options={{ ...HIDDEN_TAB, title: t('queues') }} />

      <Tabs.Screen name="products" options={{ ...HIDDEN_TAB, title: t('products') }} />

      <Tabs.Screen name="customers" options={{ ...HIDDEN_TAB, title: t('customers') }} />

      <Tabs.Screen name="suppliers" options={{ ...HIDDEN_TAB, title: t('suppliers') }} />

      <Tabs.Screen name="purchasing" options={{ ...HIDDEN_TAB, title: t('purchasing') }} />

      <Tabs.Screen name="profile" options={{ ...HIDDEN_TAB, title: t('profile') }} />

    </Tabs>

  );

}

