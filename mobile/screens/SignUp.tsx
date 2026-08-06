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
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { authEmailRedirectTo } from '../lib/authRedirect';
import { promptResendConfirmationEmail } from '../lib/authResendConfirmationUi';
import { supabase } from '../lib/supabase';
import { CONSENT_VERSION, stashPendingSignupConsents } from '../lib/consents';
import { LegalConsentFields } from '../components/LegalConsentFields';
import { colors } from '../theme/colors';
import { changeAppLocale, type Locale } from '../lib/i18n';

export default function SignUp() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'crew' | 'family' | null>(null);
  const [acceptPrivacyNotice, setAcceptPrivacyNotice] = useState(false);
  const [acceptTermsDisclaimer, setAcceptTermsDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation<any>();

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

    const locale: Locale = i18n.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
    setLoading(true);
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authEmailRedirectTo(),
        data: { full_name: fullName.trim(), role, locale },
      },
    });
    setLoading(false);

    if (authError) {
      Alert.alert(t('common.error'), authError.message);
      return;
    }

    const hasSession = Boolean(authData.session);
    if (authData.user && hasSession) {
      const { error: profileError } = await supabase.rpc('create_profile', {
        p_role: role,
        p_full_name: fullName.trim(),
        p_phone: null,
      });
      if (profileError) {
        console.error('Profile creation error:', profileError);
      }

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
      ];
      const { error: consentError } = await supabase.from('user_consents').insert(consentRows);
      if (consentError) {
        console.error('Consent insert error:', consentError);
        Alert.alert(t('common.error'), t('signUp.errorConsentSave'));
      }
    } else if (authData.user && !hasSession) {
      // Email confirmation required — session yok; onayları ilk girişte yazmak için sakla.
      try {
        await stashPendingSignupConsents({ email: email.trim(), locale });
      } catch (e) {
        console.warn('[SignUp] stash pending consents failed', e);
      }
    }

    const needsEmailConfirm = !authData.session;
    const trimmedEmail = email.trim();
    if (needsEmailConfirm) {
      Alert.alert(
        t('signUp.confirmEmailTitle'),
        t('signUp.confirmEmailMessage', { email: trimmedEmail }),
        [
          {
            text: t('signIn.resendConfirmation'),
            onPress: () => promptResendConfirmationEmail(trimmedEmail),
          },
          { text: t('signIn.title'), onPress: () => navigation.navigate('SignIn') },
        ]
      );
      return;
    }
    Alert.alert(t('signUp.accountCreated'), t('signUp.canSignInNow'), [
      { text: t('common.ok'), onPress: () => navigation.navigate('SignIn') },
    ]);
  };

  const activeLocale: Locale = i18n.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  const pickLocale = (loc: Locale) => {
    void changeAppLocale(loc);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView key={activeLocale} contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: colors.text }]}>{t('signUp.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('signUp.subtitle')}</Text>

        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('signUp.preferredLanguage')}</Text>
        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleButton, activeLocale === 'en' && styles.roleButtonActive]}
            onPress={() => pickLocale('en')}
            disabled={loading}
          >
            <Text style={[styles.roleButtonText, activeLocale === 'en' && styles.roleButtonTextActive]}>
              {t('signUp.languageEnglish')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleButton, activeLocale === 'tr' && styles.roleButtonActive]}
            onPress={() => pickLocale('tr')}
            disabled={loading}
          >
            <Text style={[styles.roleButtonText, activeLocale === 'tr' && styles.roleButtonTextActive]}>
              {t('signUp.languageTurkish')}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder={t('signUp.fullName')}
          placeholderTextColor={colors.textMuted}
          value={fullName}
          onChangeText={setFullName}
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder={t('signUp.email')}
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder={t('signUp.password')}
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder={t('signUp.confirmPassword')}
          placeholderTextColor={colors.textMuted}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          editable={!loading}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('signUp.iAm')}</Text>
        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleButton, role === 'crew' && styles.roleButtonActive]}
            onPress={() => setRole('crew')}
            disabled={loading}
          >
            <Text style={[styles.roleButtonText, role === 'crew' && styles.roleButtonTextActive]}>
              {t('signUp.crew')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleButton, role === 'family' && styles.roleButtonActive]}
            onPress={() => setRole('family')}
            disabled={loading}
          >
            <Text style={[styles.roleButtonText, role === 'family' && styles.roleButtonTextActive]}>
              {t('signUp.family')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.consentBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
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

        <TouchableOpacity
          style={styles.link}
          onPress={() => navigation.navigate('Welcome')}
        >
          <Text style={[styles.linkText, { color: colors.primary }]}>{t('common.back')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', marginTop: 60, marginBottom: 4 },
  subtitle: { fontSize: 16, marginBottom: 32 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: 14, marginBottom: 8 },
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  consentBox: {
    marginBottom: 20,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  roleButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
  },
  roleButtonActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  roleButtonText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  roleButtonTextActive: { color: colors.primary },
  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  link: { marginTop: 24, alignItems: 'center' },
  linkText: { fontSize: 14 },
});
