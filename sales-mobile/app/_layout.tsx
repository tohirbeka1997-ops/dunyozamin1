import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { t } from '@/i18n';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="orders/[id]"
          options={{
            headerShown: true,
            title: t('orderDetail'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="orders/sales/[id]"
          options={{
            headerShown: true,
            title: t('saleDetail'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="orders/sales/[id]/return"
          options={{
            headerShown: true,
            title: t('returnScreen'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="products/[id]"
          options={{
            headerShown: true,
            title: t('products'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="sell/receipt"
          options={{
            headerShown: true,
            title: t('receipt'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="customers/[id]"
          options={{
            headerShown: true,
            title: t('customerDetail'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="customers/create"
          options={{
            headerShown: true,
            title: t('createCustomer'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="customers/edit"
          options={{
            headerShown: true,
            title: t('editCustomer'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="suppliers/[id]"
          options={{
            headerShown: true,
            title: t('supplierDetail'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="purchase-orders/[id]"
          options={{
            headerShown: true,
            title: t('poDetail'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="purchase-orders/create"
          options={{
            headerShown: true,
            title: t('createPO'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="expenses/index"
          options={{
            headerShown: true,
            title: t('expenses'),
            headerStyle: { backgroundColor: '#166534' },
            headerTintColor: '#fff',
          }}
        />
      </Stack>
    </>
  );
}
