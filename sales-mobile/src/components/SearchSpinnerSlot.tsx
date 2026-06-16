import { ActivityIndicator, StyleSheet, View } from 'react-native';

/** Fixed-height slot so showing/hiding a spinner does not shift list scroll. */
export function SearchSpinnerSlot({ visible, color = '#166534' }: { visible: boolean; color?: string }) {
  return (
    <View style={styles.slot}>
      {visible ? <ActivityIndicator color={color} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { height: 32, justifyContent: 'center', alignItems: 'center' },
});
