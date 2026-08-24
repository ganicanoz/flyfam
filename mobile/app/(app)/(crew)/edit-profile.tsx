import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import EditProfile from '@/screens/EditProfile';

/**
 * Expo Router crew stack — `screens/EditProfile` React Navigation `goBack` ile uyumludur.
 */
export default function CrewEditProfileScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t('nav.editProfile'), headerBackTitle: t('common.back') }} />
      <EditProfile />
    </>
  );
}
