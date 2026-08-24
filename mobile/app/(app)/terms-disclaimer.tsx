import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LegalDocumentView } from '@/components/LegalDocumentView';

export default function TermsDisclaimerScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t('legal.termsTitle'), headerBackTitle: t('common.back') }} />
      <LegalDocumentView kind="terms" showTitle={false} />
    </>
  );
}
