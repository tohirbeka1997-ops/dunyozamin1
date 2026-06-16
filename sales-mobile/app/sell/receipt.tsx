import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchSaleReceipt } from '@/api/client';
import { t } from '@/i18n';
import type { Receipt } from '@/types/sales';

function receiptPlainText(receipt: Receipt | null): string {
  if (!receipt) return '';
  if (receipt.text) return receipt.text;
  return (receipt.lines || []).map((line) => line.text || '').join('\n');
}

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await fetchSaleReceipt(id);
      setReceipt(data.receipt);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  async function handleShare() {
    const text = receiptPlainText(receipt);
    if (!text) return;
    setShareMsg(null);
    try {
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.share) {
          await nav.share({ text, title: t('receipt') });
          return;
        }
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(text);
          setShareMsg(t('copiedToClipboard'));
          return;
        }
      } else {
        await Share.share({ message: text, title: t('receipt') });
        return;
      }
      setShareMsg(t('networkError'));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setShareMsg(e instanceof Error ? e.message : t('networkError'));
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>{t('saleComplete')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator size="large" color="#166534" style={{ marginTop: 32 }} />
      ) : (
        <ScrollView style={styles.paper} contentContainerStyle={styles.paperContent}>
          {(receipt?.lines || []).map((line, idx) => (
            <Text
              key={idx}
              style={[
                styles.line,
                line.align === 'center' && styles.center,
                line.align === 'right' && styles.right,
                line.bold && styles.bold,
              ]}
            >
              {line.text || ' '}
            </Text>
          ))}
        </ScrollView>
      )}

      {!loading && receipt ? (
        <Pressable style={styles.shareBtn} onPress={() => void handleShare()}>
          <Text style={styles.shareBtnText}>{t('share')}</Text>
        </Pressable>
      ) : null}
      {shareMsg ? <Text style={styles.shareMsg}>{shareMsg}</Text> : null}

      <Pressable style={styles.newSale} onPress={() => router.replace('/(tabs)/sell')}>
        <Text style={styles.newSaleText}>{t('newSale')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  heading: { fontSize: 20, fontWeight: '700', color: '#166534', marginBottom: 12, textAlign: 'center' },
  error: { color: '#dc2626', textAlign: 'center', marginBottom: 8 },
  paper: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  paperContent: { padding: 16 },
  line: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#0f172a',
    lineHeight: 18,
  },
  center: { textAlign: 'center' },
  right: { textAlign: 'right' },
  bold: { fontWeight: '700' },
  shareBtn: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#166534',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  shareBtnText: { color: '#166534', fontWeight: '700', fontSize: 16 },
  shareMsg: { color: '#166534', textAlign: 'center', marginTop: 6, fontSize: 13 },
  newSale: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  newSaleText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
