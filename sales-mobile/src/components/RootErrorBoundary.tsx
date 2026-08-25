import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { APP_VERSION_LABEL, BOOT_BANNER } from '@/lib/bootBanner';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Shows a visible red error instead of a blank white screen when JS throws.
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RootErrorBoundary]', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.banner}>{BOOT_BANNER} — JS xato</Text>
        <Text style={styles.title}>Xatolik (JS) v{APP_VERSION_LABEL}</Text>
        <Text style={styles.hint}>Ilova ochildi, lekin JS yiqildi. Quyidagi xabarni yuboring:</Text>
        <ScrollView style={styles.box} contentContainerStyle={styles.boxInner}>
          <Text style={styles.msg} selectable>
            {error.name}: {error.message}
          </Text>
          {error.stack ? (
            <Text style={styles.stack} selectable>
              {error.stack}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
    paddingTop: 56,
  },
  banner: {
    fontSize: 14,
    fontWeight: '900',
    color: '#854d0e',
    backgroundColor: '#fef08c',
    padding: 8,
    marginBottom: 12,
    textAlign: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', color: '#dc2626', marginBottom: 8 },
  hint: { fontSize: 14, color: '#334155', marginBottom: 12 },
  box: { flex: 1, backgroundColor: '#fef2f2', borderRadius: 8 },
  boxInner: { padding: 12 },
  msg: { fontSize: 14, fontWeight: '700', color: '#991b1b', marginBottom: 12 },
  stack: { fontSize: 11, color: '#7f1d1d', fontFamily: 'monospace' },
});
