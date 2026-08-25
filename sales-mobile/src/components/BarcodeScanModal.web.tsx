import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import jsQR from 'jsqr';
import {
  BarcodeScanModalProps,
  ManualBarcodeForm,
  scanModalStyles as styles,
} from '@/components/BarcodeScanModal.shared';
import {
  isCameraGrantedInSession,
  markCameraGrantedInSession,
  probeWebCameraPermission,
} from '@/lib/cameraPermission';
import { t } from '@/i18n';

type CameraPhase = 'idle' | 'requesting' | 'scanning' | 'denied' | 'unavailable' | 'error';

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function getBarcodeDetectorCtor(): (new (opts?: { formats?: string[] }) => BarcodeDetectorLike) | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as Window & { BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike })
    .BarcodeDetector;
  return ctor ?? null;
}

function WebCameraScanner({
  onScan,
  onManual,
  busy,
  onPhaseChange,
}: {
  onScan: (code: string) => void;
  onManual: () => void;
  busy?: boolean;
  onPhaseChange: (phase: CameraPhase, message?: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scannedRef = useRef(false);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const busyRef = useRef(busy);
  const [cameraPhase, setCameraPhase] = useState<CameraPhase>('idle');

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const emitScan = useCallback(
    (code: string) => {
      if (busyRef.current || scannedRef.current) return;
      const trimmed = String(code || '').trim();
      if (!trimmed) return;
      scannedRef.current = true;
      onScan(trimmed);
    },
    [onScan],
  );

  useEffect(() => {
    scannedRef.current = false;
  }, [busy]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setCameraPhase('requesting');
      onPhaseChange('requesting');
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraPhase('unavailable');
        onPhaseChange('unavailable', t('cameraUnavailable'));
        return;
      }

      if (!isCameraGrantedInSession()) {
        const probe = await probeWebCameraPermission();
        if (probe === 'denied') {
          setCameraPhase('denied');
          onPhaseChange('denied', t('cameraPermissionDenied'));
          return;
        }
      }

      const DetectorCtor = getBarcodeDetectorCtor();
      if (DetectorCtor) {
        try {
          detectorRef.current = new DetectorCtor({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
          });
        } catch {
          detectorRef.current = null;
        }
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        markCameraGrantedInSession();
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        onPhaseChange('scanning');
        setCameraPhase('scanning');

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });

        const tick = () => {
          if (cancelled || busyRef.current || scannedRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || !ctx || v.readyState !== v.HAVE_ENOUGH_DATA) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          const width = v.videoWidth;
          const height = v.videoHeight;
          if (width <= 0 || height <= 0) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          c.width = width;
          c.height = height;
          ctx.drawImage(v, 0, 0, width, height);

          const detector = detectorRef.current;
          if (detector) {
            void detector
              .detect(v)
              .then((codes) => {
                const hit = codes.find((entry) => String(entry.rawValue || '').trim());
                if (hit?.rawValue) emitScan(hit.rawValue);
              })
              .catch(() => {});
          } else {
            const image = ctx.getImageData(0, 0, width, height);
            const qr = jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' });
            if (qr?.data) emitScan(qr.data);
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraPhase('denied');
          onPhaseChange('denied', t('cameraPermissionDenied'));
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setCameraPhase('unavailable');
          onPhaseChange('unavailable', t('cameraUnavailable'));
        } else {
          setCameraPhase('error');
          onPhaseChange('error', t('cameraUnavailable'));
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [emitScan, onPhaseChange, stopCamera]);

  return (
    <View style={webStyles.cameraWrap}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <video ref={videoRef} style={webStyles.video as object} playsInline muted />
      <canvas ref={canvasRef} style={webStyles.hiddenCanvas as object} />
      <View style={webStyles.statusBar}>
        <Text style={webStyles.statusText}>
          {cameraPhase === 'requesting' ? t('cameraStarting') : t('scanHint')}
        </Text>
      </View>
      <View style={webStyles.overlay}>
        <Text style={webStyles.overlayHint}>{t('scanHint')}</Text>
        {busy ? <ActivityIndicator color="#fff" style={{ marginTop: 12 }} /> : null}
      </View>
      <Pressable style={webStyles.manualLink} onPress={onManual} disabled={busy}>
        <Text style={webStyles.manualLinkText}>{t('enterBarcodeManually')}</Text>
      </Pressable>
    </View>
  );
}

/** Web: camera scan (BarcodeDetector → jsQR fallback) with manual entry. */
export function BarcodeScanModal({ visible, onClose, onScan, busy }: BarcodeScanModalProps) {
  const [manualOnly, setManualOnly] = useState(false);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setManualOnly(false);
      setCameraMessage(null);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    setManualOnly(false);
    onClose();
  }, [onClose]);

  const handlePhaseChange = useCallback((phase: CameraPhase, message?: string) => {
    setCameraMessage(message ?? null);
    if (phase === 'denied' || phase === 'unavailable' || phase === 'error') {
      setManualOnly(true);
    }
  }, []);

  const showCameraFallback = manualOnly && !!cameraMessage;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Text style={styles.title}>{t('scanBarcode')}</Text>
          <Pressable onPress={handleClose} hitSlop={8} disabled={busy}>
            <Text style={styles.closeText}>{t('cancel')}</Text>
          </Pressable>
        </View>

        {manualOnly ? (
          <>
            {showCameraFallback && cameraMessage ? (
              <Text style={styles.webNote}>{cameraMessage}</Text>
            ) : null}
            <ManualBarcodeForm
              onSubmit={(code) => void onScan(code)}
              onClose={handleClose}
              busy={busy}
            />
          </>
        ) : (
          <WebCameraScanner
            onScan={(code) => void onScan(code)}
            onManual={() => setManualOnly(true)}
            busy={busy}
            onPhaseChange={handlePhaseChange}
          />
        )}
      </View>
    </Modal>
  );
}

const webStyles = {
  cameraWrap: { flex: 1, position: 'relative' as const, backgroundColor: '#000' },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    backgroundColor: '#000',
  },
  hiddenCanvas: { display: 'none' },
  statusBar: {
    position: 'absolute' as const,
    top: 12,
    left: 16,
    right: 16,
    alignItems: 'center' as const,
  },
  statusText: {
    color: '#e2e8f0',
    fontSize: 13,
    textAlign: 'center' as const,
    backgroundColor: 'rgba(15,23,42,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  overlay: {
    position: 'absolute' as const,
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center' as const,
    paddingHorizontal: 24,
  },
  overlayHint: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center' as const,
    backgroundColor: 'rgba(15,23,42,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  manualLink: { position: 'absolute' as const, bottom: 24, alignSelf: 'center' as const },
  manualLinkText: { color: '#86efac', fontSize: 14, fontWeight: '600' as const },
  centered: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, padding: 24 },
};
