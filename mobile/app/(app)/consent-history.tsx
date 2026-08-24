import { View, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ConsentHistoryList } from '@/components/ConsentHistoryList';

export default function ConsentHistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: t('consent.historyTitle') }} />
      <ConsentHistoryList
        onOpenPrivacy={() => router.push('/(app)/privacy-notice')}
        onOpenTerms={() => router.push('/(app)/terms-disclaimer')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 16 },
});
