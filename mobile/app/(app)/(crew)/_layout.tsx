import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function CrewLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#fff',
        headerBackTitle: t('common.back'),
        headerBackVisible: true,
      }}
    />
  );
}
