import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { searchCustomers } from '@/api/client';
import { SearchSpinnerSlot } from '@/components/SearchSpinnerSlot';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { formatCustomerBalance, t } from '@/i18n';
import { setSelectedCustomer, useSelectedCustomer } from '@/store/cart';
import type { CustomerSummary } from '@/types/customers';

export function CustomerPickerBanner() {
  const selectedCustomer = useSelectedCustomer();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <Pressable style={styles.customerRow} onPress={() => setPickerOpen(true)}>
        <Text style={styles.customerLabel}>
          {selectedCustomer ? selectedCustomer.name : t('selectCustomer')}
        </Text>
        {selectedCustomer ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              setSelectedCustomer(null);
            }}
          >
            <Text style={styles.clearCust}>{t('clearCustomer')}</Text>
          </Pressable>
        ) : null}
      </Pressable>
      {selectedCustomer ? (
        <>
          <Text style={styles.customerBal}>
            {formatCustomerBalance(Number(selectedCustomer.balance_uzs ?? selectedCustomer.balance ?? 0))}
          </Text>
          {Number(selectedCustomer.balance_usd ?? 0) !== 0 ? (
            <Text style={styles.customerBalUsd}>
              {formatCustomerBalance(Number(selectedCustomer.balance_usd ?? 0), 'USD')}
            </Text>
          ) : null}
        </>
      ) : null}
      <CustomerPickerModal visible={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}

function CustomerResultRow({
  item,
  onSelect,
}: {
  item: CustomerSummary;
  onSelect: (item: CustomerSummary) => void;
}) {
  const meta = item.phone || item.email;
  return (
    <Pressable style={styles.pickRow} onPress={() => onSelect(item)}>
      <Text style={styles.pickName} numberOfLines={2}>
        {item.name}
      </Text>
      {meta ? <Text style={styles.pickPhone}>{meta}</Text> : null}
      <Text style={styles.pickMeta}>
        {formatCustomerBalance(Number(item.balance_uzs ?? item.balance ?? 0))}
        {Number(item.balance_usd ?? 0) !== 0
          ? ` · ${formatCustomerBalance(Number(item.balance_usd ?? 0), 'USD')}`
          : ''}
      </Text>
    </Pressable>
  );
}

export function CustomerPickerModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [custQuery, setCustQuery] = useState('');

  useEffect(() => {
    if (visible) setCustQuery('');
  }, [visible]);

  const custFetcher = useCallback(async (q: string) => {
    const rows = await searchCustomers(q, 50);
    return rows.filter((c) => c.id !== 'default-customer-001');
  }, []);
  const {
    results: custResults,
    searching: custSearching,
    error: custError,
  } = useDebouncedSearch(custQuery, custFetcher, { enabled: visible, clearWhenDisabled: true });

  function handleClose() {
    setCustQuery('');
    onClose();
  }

  function handleSelect(item: CustomerSummary) {
    setSelectedCustomer(item);
    handleClose();
  }

  const trimmedQuery = custQuery.trim();
  const hasResults = custResults.length > 0;
  const showLoadingInList = custSearching && !hasResults;
  const showEmpty = !custSearching && !custError && !hasResults;
  const emptyMessage = trimmedQuery ? t('noCustomers') : t('loadingCustomers');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('selectCustomer')}</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('searchCustomers')}
            value={custQuery}
            onChangeText={setCustQuery}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <SearchSpinnerSlot visible={custSearching} />
          {custError ? <Text style={styles.searchError}>{custError}</Text> : null}
          <View style={styles.resultsContainer}>
            {showLoadingInList || showEmpty ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>
                  {showLoadingInList ? t('loadingCustomers') : emptyMessage}
                </Text>
                {showEmpty && trimmedQuery ? (
                  <Text style={styles.emptyHint}>{t('customerSearchHint')}</Text>
                ) : null}
              </View>
            ) : (
              <ScrollView
                style={styles.resultsScroll}
                contentContainerStyle={styles.resultsContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {custResults.map((item) => (
                  <CustomerResultRow key={item.id} item={item} onSelect={handleSelect} />
                ))}
              </ScrollView>
            )}
          </View>
          <Pressable style={styles.modalClose} onPress={handleClose}>
            <Text style={styles.modalCloseText}>{t('cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  customerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  customerLabel: { fontSize: 14, fontWeight: '600', color: '#166534', flex: 1 },
  clearCust: { fontSize: 12, color: '#64748b' },
  customerBal: { fontSize: 12, color: '#475569', marginBottom: 2 },
  customerBalUsd: { fontSize: 12, color: '#475569', marginBottom: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '75%',
    minHeight: 420,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10, color: '#0f172a' },
  searchInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 8,
  },
  resultsContainer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 240,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  resultsScroll: { flex: 1 },
  resultsContent: { flexGrow: 1 },
  pickRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  pickName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  pickPhone: { fontSize: 12, color: '#64748b', marginTop: 2 },
  pickMeta: { fontSize: 12, color: '#166534', marginTop: 2, fontWeight: '600' },
  emptyState: {
    flex: 1,
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  emptyTitle: { textAlign: 'center', color: '#64748b', fontSize: 15, fontWeight: '600' },
  emptyHint: { textAlign: 'center', color: '#94a3b8', fontSize: 13, marginTop: 8, lineHeight: 18 },
  searchError: { color: '#dc2626', fontSize: 13, marginBottom: 8 },
  modalClose: { marginTop: 12, alignItems: 'center', paddingVertical: 10 },
  modalCloseText: { color: '#64748b', fontWeight: '600' },
});
