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
import { createCustomer, searchCustomers } from '@/api/client';
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
        <View style={styles.customerMain}>
          <Text style={styles.customerLabel} numberOfLines={1}>
            {selectedCustomer ? selectedCustomer.name : t('selectCustomer')}
          </Text>
          {selectedCustomer ? (
            <Text
              style={[
                styles.customerBal,
                Number(selectedCustomer.balance_uzs ?? selectedCustomer.balance ?? 0) < -0.009 &&
                  styles.customerDebt,
              ]}
              numberOfLines={1}
            >
              {formatCustomerBalance(Number(selectedCustomer.balance_uzs ?? selectedCustomer.balance ?? 0))}
              {Number(selectedCustomer.balance_usd ?? 0) !== 0
                ? ` · ${formatCustomerBalance(Number(selectedCustomer.balance_usd ?? 0), 'USD')}`
                : ''}
            </Text>
          ) : null}
        </View>
        {selectedCustomer ? (
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation?.();
              setSelectedCustomer(null);
            }}
          >
            <Text style={styles.clearCust}>×</Text>
          </Pressable>
        ) : null}
      </Pressable>
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
  const bal = Number(item.balance_uzs ?? item.balance ?? 0);
  return (
    <Pressable style={styles.pickRow} onPress={() => onSelect(item)}>
      <Text style={styles.pickName} numberOfLines={2}>
        {item.name}
      </Text>
      {meta ? <Text style={styles.pickPhone}>{meta}</Text> : null}
      <Text style={[styles.pickMeta, bal < -0.009 && styles.pickDebt]}>
        {formatCustomerBalance(bal)}
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
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPhone, setCreatePhone] = useState('+998');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCustQuery('');
      setCreating(false);
      setCreateName('');
      setCreatePhone('+998');
      setCreateError(null);
    }
  }, [visible]);

  const custFetcher = useCallback(async (q: string) => {
    const rows = await searchCustomers(q, 50);
    return rows.filter((c) => c.id !== 'default-customer-001');
  }, []);
  const {
    results: custResults,
    searching: custSearching,
    error: custError,
  } = useDebouncedSearch(custQuery, custFetcher, { enabled: visible && !creating, clearWhenDisabled: true });

  function handleClose() {
    setCustQuery('');
    setCreating(false);
    setCreateError(null);
    onClose();
  }

  function handleSelect(item: CustomerSummary) {
    setSelectedCustomer(item);
    handleClose();
  }

  async function handleCreate() {
    if (createBusy) return;
    const trimmed = createName.trim();
    if (!trimmed) {
      setCreateError(t('nameRequired'));
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await createCustomer({
        name: trimmed,
        phone: createPhone.trim() || null,
      });
      setSelectedCustomer(created);
      handleClose();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setCreateBusy(false);
    }
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
          <Text style={styles.modalTitle}>
            {creating ? t('createCustomer') : t('selectCustomer')}
          </Text>

          {creating ? (
            <View style={styles.createForm}>
              <Text style={styles.createLabel}>{t('customerName')} *</Text>
              <TextInput
                style={styles.searchInput}
                value={createName}
                onChangeText={setCreateName}
                placeholder={t('customerName')}
                autoFocus
              />
              <Text style={styles.createLabel}>{t('customerPhone')}</Text>
              <TextInput
                style={styles.searchInput}
                value={createPhone}
                onChangeText={setCreatePhone}
                keyboardType="phone-pad"
                autoCapitalize="none"
              />
              {createError ? <Text style={styles.searchError}>{createError}</Text> : null}
              <Pressable
                style={[styles.createSaveBtn, createBusy && styles.createSaveDisabled]}
                onPress={() => void handleCreate()}
                disabled={createBusy}
              >
                <Text style={styles.createSaveText}>
                  {createBusy ? t('processing') : t('save')}
                </Text>
              </Pressable>
              <Pressable
                style={styles.modalClose}
                onPress={() => {
                  setCreating(false);
                  setCreateError(null);
                }}
              >
                <Text style={styles.modalCloseText}>{t('back')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
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
              <Pressable
                style={styles.createLink}
                onPress={() => {
                  setCreateName(trimmedQuery);
                  setCreating(true);
                }}
              >
                <Text style={styles.createLinkText}>{t('createCustomer')}</Text>
              </Pressable>
              <Pressable style={styles.modalClose} onPress={handleClose}>
                <Text style={styles.modalCloseText}>{t('cancel')}</Text>
              </Pressable>
            </>
          )}
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
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbf7d0',
    gap: 6,
  },
  customerMain: { flex: 1, minWidth: 0 },
  customerLabel: { fontSize: 13, fontWeight: '600', color: '#166534' },
  clearCust: { fontSize: 18, color: '#64748b', fontWeight: '600', paddingHorizontal: 4 },
  customerBal: { fontSize: 11, color: '#475569', marginTop: 1 },
  customerDebt: { color: '#dc2626', fontWeight: '700' },
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
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  searchInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 8,
  },
  searchError: { color: '#dc2626', fontSize: 13, marginBottom: 6 },
  resultsContainer: { minHeight: 160, maxHeight: 320 },
  resultsScroll: { flexGrow: 0 },
  resultsContent: { paddingBottom: 8 },
  emptyState: { paddingVertical: 24, alignItems: 'center', paddingHorizontal: 12 },
  emptyTitle: { fontSize: 14, color: '#64748b', textAlign: 'center' },
  emptyHint: { fontSize: 12, color: '#94a3b8', marginTop: 6, textAlign: 'center' },
  pickRow: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  pickName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  pickPhone: { fontSize: 12, color: '#64748b', marginTop: 2 },
  pickMeta: { fontSize: 12, color: '#475569', marginTop: 2 },
  pickDebt: { color: '#dc2626', fontWeight: '700' },
  createLink: {
    marginTop: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
  },
  createLinkText: { color: '#166534', fontWeight: '700', fontSize: 14 },
  createForm: { paddingBottom: 4 },
  createLabel: { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 4 },
  createSaveBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  createSaveDisabled: { opacity: 0.6 },
  createSaveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalClose: { alignItems: 'center', paddingVertical: 12 },
  modalCloseText: { color: '#64748b', fontWeight: '600', fontSize: 15 },
});
