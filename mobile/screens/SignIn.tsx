import { useState, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  Image,
  TouchableOpacity,
  type TextInput,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { authEmailRedirectTo } from '../lib/authRedirect';
import { promptResendConfirmationEmail } from '../lib/authResendConfirmationUi';
import { runPendingResendOnSignInFocus } from '../lib/authResendSignInFocus';
import { colors, useThemeMode } from '../theme/colors';
import { spacing } from '../theme/tokens';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { splashIconAsset } from '../constants/splashBrand';
import {
  FormKeyboardAccessory,
  FORM_KEYBOARD_ACCESSORY_ID,
} from '../components/FormKeyboardAccessory';
import { scrollInputIntoView } from '../components/KeyboardSafeScroll';

export default function SignIn() {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [unconfirmedHint, setUnconfirmedHint] = useState(false);
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const focusScroll = (e: { nativeEvent?: { target?: unknown } }) => {
    setTimeout(() => scrollInputIntoView(scrollRef, e, 140), 80);
  };
  useFocusEffect(
    useCallback(() => {
      runPendingResendOnSignInFocus(setEmail);
    }, []),
  );

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('signIn.forgotPasswordNeedEmail'));
      return;
    }

    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: authEmailRedirectTo(),
    });
    setForgotLoading(false);

    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }

    Alert.alert(t('signIn.forgotPassword'), t('signIn.forgotPasswordSent'));
  };

  const handleSignIn = async () => {
    if (!canSubmit) return;

    setLoading(true);
    setUnconfirmedHint(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
        setUnconfirmedHint(true);
        return;
      }
      Alert.alert(t('common.error'), error.message);
      return;
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={t('signIn.title')} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.hero}>
            <Image source={splashIconAsset} style={styles.logo} resizeMode="contain" />
            <Text style={[styles.welcome, { color: colors.textMuted }]}>{t('signIn.subtitle')}</Text>
          </View>

          <FormField
            ref={emailRef}
            label={t('signIn.email')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('signIn.email')}
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
            label={t('signIn.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('signIn.password')}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            editable={!loading}
            returnKeyType="go"
            enablesReturnKeyAutomatically
            inputAccessoryViewID={FORM_KEYBOARD_ACCESSORY_ID}
            onFocus={focusScroll}
            onSubmitEditing={() => {
              if (canSubmit) void handleSignIn();
            }}
          />

          <TouchableOpacity
            style={styles.forgotRow}
            onPress={handleForgotPassword}
            disabled={loading || forgotLoading}
            accessibilityRole="button"
          >
            <Text style={[styles.forgotText, { color: colors.primary }]}>
              {forgotLoading ? '…' : t('signIn.forgotPassword')}
            </Text>
          </TouchableOpacity>

          {unconfirmedHint ? (
            <View style={[styles.inlineWarn, { backgroundColor: colors.warningBg, borderColor: colors.warningBorder }]}>
              <Text style={[styles.inlineWarnText, { color: colors.warningText }]}>
                {t('signIn.errorEmailNotConfirmed')}
              </Text>
              <TouchableOpacity
                onPress={() => promptResendConfirmationEmail(email.trim())}
                accessibilityRole="button"
              >
                <Text style={[styles.resendLink, { color: colors.primary }]}>
                  {t('signIn.resendConfirmation')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <PrimaryButton
            title={t('signIn.submit')}
            onPress={handleSignIn}
            loading={loading}
            disabled={!canSubmit}
            style={styles.submit}
          />

          <Text style={[styles.switchRow, { color: colors.textMuted }]}>
            {t('signIn.noAccount')}{' '}
            <Text
              style={{ color: colors.primary, fontWeight: '700' }}
              onPress={() => navigation.navigate('SignUp')}
            >
              {t('welcome.signUp')}
            </Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <FormKeyboardAccessory />
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingBottom: 40,
      paddingTop: 8,
      flexGrow: 1,
    },
    hero: {
      alignItems: 'center',
      marginBottom: 28,
      marginTop: 8,
    },
    logo: {
      width: 48,
      height: 48,
      borderRadius: 12,
    },
    welcome: {
      marginTop: 10,
      fontSize: 15,
      fontWeight: '500',
    },
    forgotRow: {
      alignSelf: 'flex-end',
      marginTop: -6,
      marginBottom: 16,
      paddingVertical: 4,
    },
    forgotText: {
      fontSize: 13,
      fontWeight: '600',
    },
    inlineWarn: {
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth * 2,
      padding: 12,
      marginBottom: 16,
      gap: 8,
    },
    inlineWarnText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
    },
    resendLink: {
      fontSize: 14,
      fontWeight: '700',
    },
    submit: {
      marginTop: 4,
    },
    switchRow: {
      marginTop: 24,
      textAlign: 'center',
      fontSize: 14,
      fontWeight: '500',
    },
  });
}
