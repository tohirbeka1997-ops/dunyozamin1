import { useCallback } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import {
  BarcodeScanModalProps,
  ManualBarcodeForm,
  scanModalStyles as styles,
} from '@/components/BarcodeScanModal.shared';
import { t } from '@/i18n';

/** Web: camera unavailable — manual barcode/SKU entry only. */
export function BarcodeScanModal({ visible, onClose, onScan, busy }: BarcodeScanModalProps) {
  const handleClose = useCallback(() => onClose(), [onClose]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Text style={styles.title}>{t('scanBarcode')}</Text>
          <Pressable onPress={handleClose} hitSlop={8} disabled={busy}>
            <Text style={styles.closeText}>{t('cancel')}</Text>
          </Pressable>
        </View>
        <ManualBarcodeForm
          onSubmit={(code) => void onScan(code)}
          onClose={handleClose}
          busy={busy}
          showWebNote
        />
      </View>
    </Modal>
  );
}
