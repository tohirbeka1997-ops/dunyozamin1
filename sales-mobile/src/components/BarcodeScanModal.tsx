import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  BarcodeScanModalProps,
  ManualBarcodeForm,
  scanModalStyles,
} from '@/components/BarcodeScanModal.shared';
import { t } from '@/i18n';

function NativeCameraScanner({
  onScan,
  onManual,
  busy,
}: {
  onScan: (code: string) => void;
  onManual: () => void;
  busy?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  useEffect(() => {
    scannedRef.current = false;
  }, [busy]);

  const handleBarcode = useCallback(
    (event: { data?: string }) => {
      if (busy || scannedRef.current) return;
      const code = String(event?.data || '').trim();
      if (!code) return;
      scannedRef.current = true;
      onScan(code);
    },
    [busy, onScan],
  );

  if (!permission) {
    return (
      <View style={nativeStyles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={nativeStyles.centered}>
        <Text style={scanModalStyles.hint}>{t('scanHint')}</Text>
        <Pressable style={scanModalStyles.primaryBtn} onPress={() => void requestPermission()}>
          <Text style={scanModalStyles.primaryBtnText}>{t('scanBarcode')}</Text>
        </Pressable>
        <Pressable style={nativeStyles.linkBtn} onPress={onManual}>
          <Text style={nativeStyles.linkBtnText}>{t('enterBarcodeManually')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={nativeStyles.cameraWrap}>
      <CameraView
        style={nativeStyles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr', 'codabar'],
        }}
        onBarcodeScanned={handleBarcode}
      />
      <View style={nativeStyles.cameraOverlay}>
        <Text style={nativeStyles.overlayHint}>{t('scanHint')}</Text>
        {busy ? <ActivityIndicator color="#fff" style={{ marginTop: 12 }} /> : null}
      </View>
      <Pressable style={nativeStyles.manualLink} onPress={onManual} disabled={busy}>
        <Text style={nativeStyles.manualLinkText}>{t('enterBarcodeManually')}</Text>
      </Pressable>
    </View>
  );
}

/** Native: camera barcode scan with manual fallback. */
export function BarcodeScanModal({ visible, onClose, onScan, busy }: BarcodeScanModalProps) {
  const [manualOnly, setManualOnly] = useState(false);

  useEffect(() => {
    if (visible) setManualOnly(false);
  }, [visible]);

  const handleClose = useCallback(() => {
    setManualOnly(false);
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={scanModalStyles.root}>
        <View style={scanModalStyles.topBar}>
          <Text style={scanModalStyles.title}>{t('scanBarcode')}</Text>
          <Pressable onPress={handleClose} hitSlop={8} disabled={busy}>
            <Text style={scanModalStyles.closeText}>{t('cancel')}</Text>
          </Pressable>
        </View>

        {manualOnly ? (
          <ManualBarcodeForm
            onSubmit={(code) => void onScan(code)}
            onClose={handleClose}
            busy={busy}
          />
        ) : (
          <NativeCameraScanner
            onScan={(code) => void onScan(code)}
            onManual={() => setManualOnly(true)}
            busy={busy}
          />
        )}
      </View>
    </Modal>
  );
}

const nativeStyles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  linkBtn: { marginTop: 16 },
  linkBtnText: { color: '#94a3b8', fontSize: 14 },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  cameraOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  overlayHint: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: 'rgba(15,23,42,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  manualLink: { position: 'absolute', bottom: 24, alignSelf: 'center' },
  manualLinkText: { color: '#86efac', fontSize: 14, fontWeight: '600' },
});
