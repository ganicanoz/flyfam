import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LegalDocumentView } from '@/components/LegalDocumentView';

export default function PrivacyNoticeScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t('legal.privacyTitle'), headerBackTitle: t('common.back') }} />
      <LegalDocumentView kind="privacy" showTitle={false} />
    </>
  );
}
