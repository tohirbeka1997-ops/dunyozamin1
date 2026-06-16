import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createExpense, fetchExpenseCategories, fetchExpenses } from '@/api/client';
import { t } from '@/i18n';
import type { Expense, ExpenseCategory } from '@/types/customers';

function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensesScreen() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rows, cats] = await Promise.all([fetchExpenses(todayYmd()), fetchExpenseCategories()]);
      setExpenses(rows);
      setCategories(cats);
      setCategoryId((prev) => prev ?? (cats[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  async function handleSave() {
    if (saving || !categoryId) return;
    const value = Number(amount.replace(/\s/g, ''));
    const description = notes.trim();
    if (!Number.isFinite(value) || value <= 0) return;
    if (!description) {
      setSaveMsg(t('expenseDescriptionRequired'));
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      await createExpense({
        category_id: categoryId,
        amount: value,
        description,
        notes: description,
        expense_date: todayYmd(),
      });
      setAmount('');
      setNotes('');
      setModalOpen(false);
      setSaveMsg(t('expenseCreated'));
      await load();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setSaving(false);
    }
  }

  const selectedCategory = categories.find((c) => c.id === categoryId);

  if (loading && expenses.length === 0 && categories.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saveMsg && !modalOpen ? <Text style={styles.info}>{saveMsg}</Text> : null}

      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>{t('noExpenses')}</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.category_name || item.description}</Text>
              <Text style={styles.rowMeta}>
                {String(item.expense_date || '').slice(0, 10)} · {item.description}
              </Text>
            </View>
            <Text style={styles.rowAmt}>{formatMoney(Number(item.amount || 0))}</Text>
          </View>
        )}
      />

      <Pressable style={styles.fab} onPress={() => setModalOpen(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('addExpense')}</Text>

            <Text style={styles.fieldLabel}>{t('expenseCategory')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
              {categories.map((cat) => (
                <Pressable
                  key={cat.id}
                  style={[styles.catChip, categoryId === cat.id && styles.catChipActive]}
                  onPress={() => setCategoryId(cat.id)}
                >
                  <Text style={[styles.catChipText, categoryId === cat.id && styles.catChipTextActive]}>
                    {cat.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {!selectedCategory && categories.length === 0 ? (
              <Text style={styles.hint}>{t('selectCategory')}</Text>
            ) : null}

            <Text style={styles.fieldLabel}>{t('expenseAmount')}</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
            />

            <Text style={styles.fieldLabel}>{t('expenseNotes')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('expenseNotes')}
              multiline
            />

            {saveMsg && modalOpen ? <Text style={styles.modalMsg}>{saveMsg}</Text> : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                <Text style={styles.cancelText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, saving && styles.btnDisabled]}
                onPress={() => void handleSave()}
                disabled={saving}
              >
                <Text style={styles.saveText}>{saving ? t('processing') : t('save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16, paddingBottom: 88 },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 8,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  rowMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  rowAmt: { fontSize: 15, fontWeight: '700', color: '#dc2626', marginLeft: 8 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '300', marginTop: -2 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 28,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: '#64748b', marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  catScroll: { marginBottom: 4 },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  catChipActive: { backgroundColor: '#166534', borderColor: '#166534' },
  catChipText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  catChipTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  cancelText: { fontWeight: '600', color: '#64748b' },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#166534',
    alignItems: 'center',
  },
  saveText: { fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.6 },
  modalMsg: { color: '#dc2626', marginTop: 8, textAlign: 'center' },
  hint: { fontSize: 12, color: '#b45309', marginBottom: 8 },
  error: { color: '#dc2626', padding: 16, textAlign: 'center' },
  info: { color: '#166534', paddingHorizontal: 16, paddingTop: 8, fontWeight: '600' },
});
