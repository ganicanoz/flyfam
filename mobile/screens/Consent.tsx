import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { saveRequiredConsents } from '../lib/consents';
import { LegalConsentFields } from '../components/LegalConsentFields';
import { colors } from '../theme/colors';

export default function Consent() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const { profile, refreshProfile } = useSession();
  const [acceptPrivacyNotice, setAcceptPrivacyNotice] = useState(false);
  const [acceptTermsDisclaimer, setAcceptTermsDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);

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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: colors.text }]}>{t('consent.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('consent.subtitle')}</Text>

        <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <LegalConsentFields
            acceptPrivacyNotice={acceptPrivacyNotice}
            onTogglePrivacyNotice={() => setAcceptPrivacyNotice((v) => !v)}
            acceptTermsDisclaimer={acceptTermsDisclaimer}
            onToggleTermsDisclaimer={() => setAcceptTermsDisclaimer((v) => !v)}
            onOpenPrivacyNotice={() => navigation.navigate('PrivacyNotice')}
            onOpenTermsDisclaimer={() => navigation.navigate('TermsDisclaimer')}
            disabled={loading}
          />
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }, loading && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('common.continue')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 15, marginBottom: 20, lineHeight: 22 },
  box: {
    marginBottom: 20,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  button: { padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
