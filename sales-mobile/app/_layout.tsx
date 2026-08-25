import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { installGlobalJsErrorHandlers } from '@/lib/globalJsErrors';

// Must run before first paint — catch fatals ErrorBoundary cannot see.
installGlobalJsErrorHandlers();

/**
 * Minimal root shell — no biometric gate, no splash native API, no FCM.
 * Heavy providers stay off the critical path.
 */
export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <View style={styles.root}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)/login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="orders/[id]" options={{ headerShown: true, title: 'Buyurtma' }} />
          <Stack.Screen name="orders/sales/[id]" options={{ headerShown: true, title: 'Sotuv' }} />
          <Stack.Screen name="orders/sales/[id]/return" options={{ headerShown: true, title: 'Qaytarish' }} />
          <Stack.Screen name="products/[id]" options={{ headerShown: true, title: 'Mahsulot' }} />
          <Stack.Screen name="sell/receipt" options={{ headerShown: true, title: 'Chek' }} />
          <Stack.Screen name="customers/[id]" options={{ headerShown: true, title: 'Mijoz' }} />
          <Stack.Screen name="customers/create" options={{ headerShown: true, title: 'Yangi mijoz' }} />
          <Stack.Screen name="customers/edit" options={{ headerShown: true, title: 'Tahrirlash' }} />
          <Stack.Screen name="suppliers/[id]" options={{ headerShown: true, title: 'Yetkazib beruvchi' }} />
          <Stack.Screen name="purchase-orders/[id]" options={{ headerShown: true, title: 'Buyurtma' }} />
          <Stack.Screen name="purchase-orders/create" options={{ headerShown: true, title: 'Yangi PO' }} />
          <Stack.Screen name="expenses/index" options={{ headerShown: true, title: 'Xarajatlar' }} />
          <Stack.Screen name="privacy" options={{ headerShown: true, title: 'Maxfiylik' }} />
        </Stack>
      </View>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#166534' },
});
