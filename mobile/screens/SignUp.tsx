import { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  TouchableOpacity,
  Modal,
  type TextInput,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { authEmailRedirectTo } from '../lib/authRedirect';
import { promptResendConfirmationEmail } from '../lib/authResendConfirmationUi';
import { supabase } from '../lib/supabase';
import { CONSENT_VERSION, stashPendingSignupConsents } from '../lib/consents';
import { colors, useThemeMode } from '../theme/colors';
import { changeAppLocale, type Locale } from '../lib/i18n';
import { spacing, radius } from '../theme/tokens';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { FormField } from '../components/FormField';
import { SegmentControl } from '../components/SegmentControl';
import { PrimaryButton } from '../components/PrimaryButton';
import { BottomActionBar } from '../components/BottomActionBar';
import { LegalTextView, type LegalDocumentKind } from '../components/LegalTextView';
import {
  FormKeyboardAccessory,
  FORM_KEYBOARD_ACCESSORY_ID,
} from '../components/FormKeyboardAccessory';
import { scrollInputIntoView } from '../components/KeyboardSafeScroll';

function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10 || /[A-Z]/.test(pw) || /[0-9]/.test(pw)) score += 1;
  if (pw.length >= 12 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(3, score) as 0 | 1 | 2 | 3;
}

export default function SignUp() {
  const { t, i18n } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'crew' | 'family'>('crew');
  const [acceptPrivacyNotice, setAcceptPrivacyNotice] = useState(false);
  const [acceptTermsDisclaimer, setAcceptTermsDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [legalSheet, setLegalSheet] = useState<LegalDocumentKind | null>(null);
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
  const fullNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const activeLocale: Locale = i18n.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  const strength = passwordStrength(password);

  const focusScroll = (e: { nativeEvent?: { target?: unknown } }) => {
    setTimeout(() => scrollInputIntoView(scrollRef, e, 160), 80);
  };

  const formValid =
    !!email.trim() &&
    !!password &&
    !!confirmPassword &&
    !!fullName.trim() &&
    password.length >= 6 &&
    password === confirmPassword &&
    acceptPrivacyNotice &&
    acceptTermsDisclaimer;

  const handleSignUp = async () => {
    if (!formValid) {
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
      Alert.alert(t('common.error'), t('signUp.errorFillAll'));
      return;
    }

    const locale = activeLocale;
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
        ],
      );
      return;
    }
    Alert.alert(t('signUp.accountCreated'), t('signUp.canSignInNow'), [
      { text: t('common.ok'), onPress: () => navigation.navigate('SignIn') },
    ]);
  };

  const strengthColors = [colors.border, colors.error, colors.warningText, colors.success];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={t('signUp.title')} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          key={activeLocale}
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            {t('signUp.preferredLanguage')}
          </Text>
          <SegmentControl
            options={[
              { value: 'tr', label: t('signUp.languageTurkish') },
              { value: 'en', label: t('signUp.languageEnglish') },
            ]}
            value={activeLocale}
            onChange={(loc) => void changeAppLocale(loc)}
            style={styles.segment}
          />

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            {t('signUp.accountType')}
          </Text>
          <SegmentControl
            options={[
              { value: 'crew', label: t('signUp.crew') },
              { value: 'family', label: t('signUp.family') },
            ]}
            value={role}
            onChange={setRole}
            style={styles.segment}
          />
          <Text style={[styles.roleHint, { color: colors.textMuted }]}>{t('signUp.roleHint')}</Text>

          <FormField
            ref={fullNameRef}
            label={t('signUp.fullName')}
            value={fullName}
            onChangeText={setFullName}
            placeholder={t('signUp.fullName')}
            autoCapitalize="words"
            textContentType="name"
            editable={!loading}
            returnKeyType="next"
            blurOnSubmit={false}
            enablesReturnKeyAutomatically
            inputAccessoryViewID={FORM_KEYBOARD_ACCESSORY_ID}
            onFocus={focusScroll}
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <FormField
            ref={emailRef}
            label={t('signUp.email')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('signUp.email')}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            editable={!loading}
            returnKeyType="next"
            blurOnSubmit={false}
            enablesReturnKeyAutomatically
            inputAccessoryViewID={FORM_KEYBOARD_ACCESSORY_ID}
            onFocus={focusScroll}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <FormField
            ref={passwordRef}
            label={t('signUp.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('signUp.passwordPlaceholder')}
            secureTextEntry
            textContentType="newPassword"
            editable={!loading}
            returnKeyType="next"
            blurOnSubmit={false}
            enablesReturnKeyAutomatically
            inputAccessoryViewID={FORM_KEYBOARD_ACCESSORY_ID}
            onFocus={focusScroll}
            onSubmitEditing={() => confirmRef.current?.focus()}
            footer={
              password.length > 0 ? (
                <View style={styles.strengthRow}>
                  {[1, 2, 3].map((n) => (
                    <View
                      key={n}
                      style={[
                        styles.strengthBar,
                        {
                          backgroundColor:
                            strength >= n ? strengthColors[strength] : colors.inputFill,
                        },
                      ]}
                    />
                  ))}
                </View>
              ) : null
            }
          />
          <FormField
            ref={confirmRef}
            label={t('signUp.confirmPasswordLabel')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder={t('signUp.confirmPasswordLabel')}
            secureTextEntry
            textContentType="newPassword"
            editable={!loading}
            returnKeyType="done"
            enablesReturnKeyAutomatically
            inputAccessoryViewID={FORM_KEYBOARD_ACCESSORY_ID}
            onFocus={focusScroll}
            onSubmitEditing={() => {
              if (formValid && !loading) void handleSignUp();
            }}
          />

          <ConsentLine
            checked={acceptPrivacyNotice}
            onToggle={() => setAcceptPrivacyNotice((v) => !v)}
            onOpenLink={() => setLegalSheet('privacy')}
            linkLabel={t('signUp.privacyNoticeLink')}
            afterLabel={t('signUp.acceptShortAfter')}
            disabled={loading}
          />
          <ConsentLine
            checked={acceptTermsDisclaimer}
            onToggle={() => setAcceptTermsDisclaimer((v) => !v)}
            onOpenLink={() => setLegalSheet('terms')}
            linkLabel={t('signUp.termsShortLink')}
            afterLabel={t('signUp.acceptShortAfter')}
            disabled={loading}
          />

          <Text style={[styles.switchRow, { color: colors.textMuted }]}>
            {t('signUp.haveAccount')}{' '}
            <Text
              style={{ color: colors.primary, fontWeight: '700' }}
              onPress={() => navigation.navigate('SignIn')}
            >
              {t('welcome.signIn')}
            </Text>
          </Text>
        </ScrollView>

        <BottomActionBar>
          <PrimaryButton
            title={t('signUp.createAccount')}
            onPress={handleSignUp}
            loading={loading}
            disabled={!formValid || loading}
          />
        </BottomActionBar>
      </KeyboardAvoidingView>

      <FormKeyboardAccessory />

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

function ConsentLine({
  checked,
  onToggle,
  onOpenLink,
  linkLabel,
  afterLabel,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  onOpenLink: () => void;
  linkLabel: string;
  afterLabel: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={stylesConsent.row}
      onPress={onToggle}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <View
        style={[
          stylesConsent.box,
          { borderColor: colors.border, backgroundColor: colors.surface },
          checked && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
        ]}
      >
        {checked ? <Text style={[stylesConsent.tick, { color: colors.primary }]}>✓</Text> : null}
      </View>
      <Text style={[stylesConsent.text, { color: colors.text }]}>
        <Text onPress={onOpenLink} style={[stylesConsent.link, { color: colors.primary }]}>
          {linkLabel}
        </Text>
        {afterLabel}
      </Text>
    </TouchableOpacity>
  );
}

const stylesConsent = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tick: { fontSize: 14, fontWeight: '800', lineHeight: 16 },
  text: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  link: { fontSize: 13, lineHeight: 18, fontWeight: '700', textDecorationLine: 'underline' },
});

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
    sectionLabel: {
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
    },
    segment: { marginBottom: 8 },
    roleHint: {
      fontSize: 12,
      lineHeight: 17,
      marginBottom: 16,
      marginTop: 2,
    },
    strengthRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 8,
    },
    strengthBar: {
      flex: 1,
      height: 4,
      borderRadius: radius.pill,
    },
    switchRow: {
      marginTop: 20,
      textAlign: 'center',
      fontSize: 14,
      fontWeight: '500',
    },
  });
}
