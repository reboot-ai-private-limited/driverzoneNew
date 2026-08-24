import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, space } from '@driverzone/mobile-ui';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>DriverZone Driver</Text>
      <Text style={styles.body}>Scaffold. Offer screen lands in phase 6 — see docs/LLD/roadmap.md.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: space.lg,
  },
  title: { fontSize: fontSize.xl, color: colors.fg, marginBottom: space.sm },
  body: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center' },
});
