import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { authEmailRedirectTo } from '../lib/authRedirect';
import { promptResendConfirmationEmail } from '../lib/authResendConfirmationUi';
import { runPendingResendOnSignInFocus } from '../lib/authResendSignInFocus';
import { colors } from '../theme/colors';

export default function SignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const navigation = useNavigation<any>();

  useFocusEffect(
    useCallback(() => {
      runPendingResendOnSignInFocus(setEmail);
    }, [])
  );

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

  const handleResendConfirmationPress = () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('signIn.resendConfirmationNeedEmail'));
      return;
    }
    promptResendConfirmationEmail(trimmed);
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      Alert.alert(t('common.error'), t('signIn.errorEmailPassword'));
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
        Alert.alert(t('common.error'), t('signIn.errorEmailNotConfirmed'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('signIn.resendConfirmation'),
            onPress: () => promptResendConfirmationEmail(email.trim()),
          },
        ]);
        return;
      }
      Alert.alert(t('common.error'), error.message);
      return;
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>{t('signIn.title')}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('signIn.subtitle')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('signIn.email')}
        placeholderTextColor={colors.textMuted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder={t('signIn.password')}
        placeholderTextColor={colors.textMuted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSignIn}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{t('signIn.submit')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.forgotLink}
        onPress={handleForgotPassword}
        disabled={loading || forgotLoading}
      >
        {forgotLoading ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Text style={[styles.forgotLinkText, { color: colors.primary }]}>
            {t('signIn.forgotPassword')}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.forgotLink}
        onPress={handleResendConfirmationPress}
        disabled={loading}
      >
        <Text style={[styles.forgotLinkText, { color: colors.primary }]}>
          {t('signIn.resendConfirmationLink')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.link}
        onPress={() => navigation.navigate('Welcome')}
      >
        <Text style={[styles.linkText, { color: colors.primary }]}>{t('common.back')}</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginTop: 80, marginBottom: 4 },
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
  button: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  forgotLink: { marginTop: 16, alignItems: 'center', paddingVertical: 8 },
  forgotLinkText: { fontSize: 14, fontWeight: '500' },
  link: { marginTop: 24, alignItems: 'center' },
  linkText: { fontSize: 14 },
});
