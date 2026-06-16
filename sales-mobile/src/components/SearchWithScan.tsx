import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '@/i18n';

export function SearchWithScan({
  value,
  onChangeText,
  onScanPress,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onScanPress: () => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        placeholder={placeholder ?? t('searchProducts')}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={styles.scanBtn}
        onPress={onScanPress}
        accessibilityLabel={t('scanBarcode')}
      >
        <Text style={styles.scanIcon}>📷</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  scanBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanIcon: { fontSize: 20 },
});
