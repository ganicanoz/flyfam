import { useMemo, useState } from 'react';
import { View, StyleSheet, Alert, ScrollView, Modal } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSession } from '../contexts/SessionContext';
import { saveRequiredConsents } from '../lib/consents';
import { LegalConsentFields } from '../components/LegalConsentFields';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { FormCard } from '../components/FormCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { BottomActionBar } from '../components/BottomActionBar';
import { LegalTextView, type LegalDocumentKind } from '../components/LegalTextView';
import { colors, useThemeMode } from '../theme/colors';
import { spacing } from '../theme/tokens';

export default function Consent() {
  const { t, i18n } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const { profile, refreshProfile } = useSession();
  const [acceptPrivacyNotice, setAcceptPrivacyNotice] = useState(false);
  const [acceptTermsDisclaimer, setAcceptTermsDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [legalSheet, setLegalSheet] = useState<LegalDocumentKind | null>(null);

  const canContinue = acceptPrivacyNotice && acceptTermsDisclaimer && !loading;

  const handleContinue = async () => {
    if (!acceptPrivacyNotice || !acceptTermsDisclaimer) {
      Alert.alert(t('common.error'), t('signUp.errorConsentRequired'));
      return;
    }
    if (!profile?.id) {
      Alert.alert(t('common.error'), t('consent.errorNoUser'));
      return;
    }

    setLoading(true);
    try {
      const locale = i18n.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
      await saveRequiredConsents({ userId: profile.id, locale, source: 'reconsent' });
      await refreshProfile();
    } catch {
      Alert.alert(t('common.error'), t('signUp.errorConsentSave'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={t('consent.title')} subtitle={t('consent.subtitle')} showBack={false} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="shield-checkmark" size={26} color={colors.primary} />
          </View>
        </View>

        <FormCard>
          <View style={styles.cardBody}>
            <LegalConsentFields
              acceptPrivacyNotice={acceptPrivacyNotice}
              onTogglePrivacyNotice={() => setAcceptPrivacyNotice((v) => !v)}
              acceptTermsDisclaimer={acceptTermsDisclaimer}
              onToggleTermsDisclaimer={() => setAcceptTermsDisclaimer((v) => !v)}
              onOpenPrivacyNotice={() => setLegalSheet('privacy')}
              onOpenTermsDisclaimer={() => setLegalSheet('terms')}
              disabled={loading}
            />
          </View>
        </FormCard>
      </ScrollView>

      <BottomActionBar>
        <PrimaryButton
          title={t('common.continue')}
          onPress={() => void handleContinue()}
          loading={loading}
          disabled={!canContinue}
        />
      </BottomActionBar>

      <Modal
        visible={legalSheet != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLegalSheet(null)}
      >
        {legalSheet ? (
          <LegalTextView
            kind={legalSheet}
            showAccept
            onBack={() => setLegalSheet(null)}
            onAccept={() => {
              if (legalSheet === 'privacy') setAcceptPrivacyNotice(true);
              else setAcceptTermsDisclaimer(true);
              setLegalSheet(null);
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: 8,
      paddingBottom: 24,
      flexGrow: 1,
    },
    hero: {
      alignItems: 'center',
      marginBottom: 20,
      marginTop: 8,
    },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBody: { paddingHorizontal: spacing.md },
  });
}
