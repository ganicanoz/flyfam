import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme/colors';

export default function AuthLayout() {
  const { t } = useTranslation();

  const headerOptions = {
    headerStyle: { backgroundColor: colors.primary },
    headerTintColor: colors.white,
    headerTitleStyle: { fontWeight: '700' as const },
    headerBackVisible: true,
  };

  return (
    <Stack screenOptions={{ headerShown: false, ...headerOptions }}>
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen
        name="sign-in"
        options={{
          headerShown: true,
          title: t('signIn.title'),
          headerBackTitle: t('common.backToWelcome'),
        }}
      />
      <Stack.Screen
        name="sign-up"
        options={{
          headerShown: true,
          title: t('signUp.title'),
          headerBackTitle: t('common.backToWelcome'),
        }}
      />
      <Stack.Screen
        name="privacy-notice"
        options={{
          headerShown: true,
          title: t('legal.privacyTitle'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="terms-disclaimer"
        options={{
          headerShown: true,
          title: t('legal.termsTitle'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="consent"
        options={{
          headerShown: true,
          title: t('consent.title'),
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="complete-profile"
        options={{
          headerShown: true,
          title: t('nav.completeSetup'),
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="reset-password"
        options={{
          headerShown: true,
          title: t('resetPassword.title'),
          headerBackVisible: false,
        }}
      />
    </Stack>
  );
}
