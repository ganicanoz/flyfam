import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { CONSENT_VERSION } from '@/lib/consents';
import { useSession } from '@/contexts/SessionContext';
import { LegalConsentFields } from '@/components/LegalConsentFields';

export default function ConsentScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { profile, crewProfile, refreshProfile } = useSession();
  const [acceptPrivacyNotice, setAcceptPrivacyNotice] = useState(false);
  const [acceptTermsDisclaimer, setAcceptTermsDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!acceptPrivacyNotice || !acceptTermsDisclaimer) {
      Alert.alert(t('common.error'), t('signUp.errorConsentRequired'));
      return;
    }
    const userId = profile?.id;
    if (!userId) {
      Alert.alert(t('common.error'), t('consent.errorNoUser'));
      return;
    }

    setLoading(true);
    const locale = i18n.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
    const rows = [
      {
        user_id: userId,
        consent_type: 'privacy_notice',
        accepted: true,
        policy_version: CONSENT_VERSION,
        locale,
        source: 'reconsent',
      },
      {
        user_id: userId,
        consent_type: 'terms_disclaimer',
        accepted: true,
        policy_version: CONSENT_VERSION,
        locale,
        source: 'reconsent',
      },
    ];

    const { error } = await supabase
      .from('user_consents')
      .upsert(rows, { onConflict: 'user_id,consent_type,policy_version' });
    setLoading(false);
    if (error) {
      Alert.alert(t('common.error'), t('signUp.errorConsentSave'));
      return;
    }

    await refreshProfile();
    if (profile?.role === 'crew' && !crewProfile) {
      router.replace('/(auth)/complete-profile');
      return;
    }
    if (profile?.role === 'crew') router.replace('/(app)/(crew)/roster');
    else router.replace('/(app)/(family)/dashboard');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{t('consent.title')}</Text>
        <Text style={styles.subtitle}>{t('consent.subtitle')}</Text>

        <View style={styles.box}>
          <LegalConsentFields
            acceptPrivacyNotice={acceptPrivacyNotice}
            onTogglePrivacyNotice={() => setAcceptPrivacyNotice((v) => !v)}
            acceptTermsDisclaimer={acceptTermsDisclaimer}
            onToggleTermsDisclaimer={() => setAcceptTermsDisclaimer((v) => !v)}
            onOpenPrivacyNotice={() => router.push('/(auth)/privacy-notice')}
            onOpenTermsDisclaimer={() => router.push('/(auth)/terms-disclaimer')}
            disabled={loading}
          />
        </View>

        <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleContinue} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('common.continue')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scrollContent: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: 8, marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#a1a1aa', marginBottom: 20, lineHeight: 22 },
  box: {
    marginBottom: 20,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#111113',
  },
  button: { backgroundColor: '#22c55e', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
