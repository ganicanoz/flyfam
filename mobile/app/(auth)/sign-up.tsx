import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { CONSENT_VERSION } from '@/lib/consents';

export default function SignUp() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'crew' | 'family' | null>(null);
  const [acceptPrivacyNotice, setAcceptPrivacyNotice] = useState(false);
  const [acceptTermsDisclaimer, setAcceptTermsDisclaimer] = useState(false);
  const [acceptMarketingConsent, setAcceptMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async () => {
    if (!email.trim() || !password || !confirmPassword || !fullName.trim() || !role) {
      Alert.alert(t('common.error'), t('signUp.errorFillAll'));
      return;
    }
    if (!acceptPrivacyNotice || !acceptTermsDisclaimer) {
      Alert.alert(t('common.error'), t('signUp.errorConsentRequired'));
      return;
    }

    if (password.length < 6) {
      Alert.alert(t('common.error'), t('signUp.errorPasswordLength'));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t('common.error'), t('signUp.errorPasswordMismatch'));
      return;
    }

    setLoading(true);
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);

    if (authError) {
      Alert.alert(t('common.error'), authError.message);
      return;
    }

    if (authData.user) {
      const { error: profileError } = await supabase.rpc('create_profile', {
        p_role: role,
        p_full_name: fullName.trim(),
        p_phone: null,
      });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        Alert.alert(
          t('signUp.accountCreated'),
          t('signUp.canSignInNow')
        );
      }

      const locale = i18n.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
      const consentRows = [
        {
          user_id: authData.user.id,
          consent_type: 'privacy_notice',
          accepted: true,
          policy_version: CONSENT_VERSION,
          locale,
          source: 'signup',
        },
        {
          user_id: authData.user.id,
          consent_type: 'terms_disclaimer',
          accepted: true,
          policy_version: CONSENT_VERSION,
          locale,
          source: 'signup',
        },
        {
          user_id: authData.user.id,
          consent_type: 'marketing_optional',
          accepted: acceptMarketingConsent,
          policy_version: CONSENT_VERSION,
          locale,
          source: 'signup',
        },
      ];
      const { error: consentError } = await supabase.from('user_consents').insert(consentRows);
      if (consentError) {
        console.error('Consent insert error:', consentError);
        Alert.alert(t('common.error'), t('signUp.errorConsentSave'));
      }
    }

    Alert.alert(
      t('signUp.accountCreated'),
      t('signUp.canSignInNow'),
      [{ text: t('common.ok'), onPress: () => router.replace('/(auth)/sign-in') }]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{t('signUp.title')}</Text>
        <Text style={styles.subtitle}>{t('signUp.subtitle')}</Text>

        <TextInput
          style={styles.input}
          placeholder={t('signUp.fullName')}
          placeholderTextColor="#71717a"
          value={fullName}
          onChangeText={setFullName}
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder={t('signUp.email')}
          placeholderTextColor="#71717a"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder={t('signUp.password')}
          placeholderTextColor="#71717a"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder={t('signUp.confirmPassword')}
          placeholderTextColor="#71717a"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          editable={!loading}
        />

        <Text style={styles.label}>{t('signUp.iAm')}</Text>
        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[
              styles.roleButton,
              role === 'crew' && styles.roleButtonActive,
            ]}
            onPress={() => setRole('crew')}
            disabled={loading}
          >
            <Text
              style={[
                styles.roleButtonText,
                role === 'crew' && styles.roleButtonTextActive,
              ]}
            >
              {t('signUp.crew')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleButton,
              role === 'family' && styles.roleButtonActive,
            ]}
            onPress={() => setRole('family')}
            disabled={loading}
          >
            <Text
              style={[
                styles.roleButtonText,
                role === 'family' && styles.roleButtonTextActive,
              ]}
            >
              {t('signUp.family')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.consentBox}>
          <TouchableOpacity
            style={styles.consentRow}
            onPress={() => setAcceptPrivacyNotice((v) => !v)}
            disabled={loading}
          >
            <View style={[styles.checkbox, acceptPrivacyNotice && styles.checkboxChecked]}>
              {acceptPrivacyNotice ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>{t('signUp.acceptPrivacyNotice')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/privacy-notice')}
            disabled={loading}
          >
            <Text style={styles.consentLink}>{t('signUp.readPrivacyNotice')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.consentRow}
            onPress={() => setAcceptTermsDisclaimer((v) => !v)}
            disabled={loading}
          >
            <View style={[styles.checkbox, acceptTermsDisclaimer && styles.checkboxChecked]}>
              {acceptTermsDisclaimer ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>{t('signUp.acceptTermsDisclaimer')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/terms-disclaimer')}
            disabled={loading}
          >
            <Text style={styles.consentLink}>{t('signUp.readDisclaimer')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.consentRow}
            onPress={() => setAcceptMarketingConsent((v) => !v)}
            disabled={loading}
          >
            <View style={[styles.checkbox, acceptMarketingConsent && styles.checkboxChecked]}>
              {acceptMarketingConsent ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>{t('signUp.acceptMarketingOptional')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('signUp.createAccount')}</Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/welcome" asChild>
          <TouchableOpacity style={styles.link}>
            <Text style={styles.linkText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginTop: 60,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#a1a1aa',
    marginBottom: 32,
  },
  input: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  label: {
    color: '#a1a1aa',
    fontSize: 14,
    marginBottom: 8,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  consentBox: {
    gap: 6,
    marginBottom: 20,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#111113',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#52525b',
    backgroundColor: '#18181b',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    borderColor: '#22c55e',
    backgroundColor: '#14532d',
  },
  checkboxTick: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  consentText: {
    flex: 1,
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 18,
  },
  consentLink: {
    color: '#22c55e',
    fontSize: 12,
    marginBottom: 6,
    marginLeft: 30,
  },
  roleButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#18181b',
    borderWidth: 2,
    borderColor: '#27272a',
    alignItems: 'center',
  },
  roleButtonActive: {
    borderColor: '#22c55e',
    backgroundColor: '#14532d',
  },
  roleButtonText: {
    color: '#a1a1aa',
    fontSize: 16,
    fontWeight: '600',
  },
  roleButtonTextActive: {
    color: '#22c55e',
  },
  button: {
    backgroundColor: '#22c55e',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    color: '#22c55e',
    fontSize: 14,
  },
});
