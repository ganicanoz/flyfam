import { View, StyleSheet } from 'react-native';
import { ConsentHistoryList } from '../components/ConsentHistoryList';
import { colors } from '../theme/colors';

export default function ConsentHistory() {
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ConsentHistoryList />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
});
