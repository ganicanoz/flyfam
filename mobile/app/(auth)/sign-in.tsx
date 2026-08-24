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
import { useRouter, Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { authEmailRedirectTo } from '@/lib/authRedirect';
import { promptResendConfirmationEmail } from '@/lib/authResendConfirmationUi';
import { runPendingResendOnSignInFocus } from '@/lib/authResendSignInFocus';
import { changeAppLocale, type Locale } from '@/lib/i18n';

export default function SignIn() {
  const { t, i18n } = useTranslation();
  const isTr = String(i18n.language ?? '').toLowerCase().startsWith('tr');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const router = useRouter();

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

    router.replace('/');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Text style={styles.title}>{t('signIn.title')}</Text>
      <Text style={styles.subtitle}>{t('signIn.subtitle')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('signIn.email')}
        placeholderTextColor="#71717a"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder={t('signIn.password')}
        placeholderTextColor="#71717a"
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
          <ActivityIndicator color="#22c55e" size="small" />
        ) : (
          <Text style={styles.forgotLinkText}>{t('signIn.forgotPassword')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.forgotLink}
        onPress={handleResendConfirmationPress}
        disabled={loading}
      >
        <Text style={styles.forgotLinkText}>{t('signIn.resendConfirmationLink')}</Text>
      </TouchableOpacity>

      <Link href="/(auth)/welcome" asChild>
        <TouchableOpacity style={styles.link}>
          <Text style={styles.linkText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </Link>

      <TouchableOpacity
        style={styles.languageSwitch}
        onPress={() => changeAppLocale((isTr ? 'en' : 'tr') as Locale)}
      >
        <Text style={styles.languageSwitchText}>
          {isTr ? t('profile.languageEnglish') : t('profile.languageTurkish')}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#0a0a0a',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginTop: 8,
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
  button: {
    backgroundColor: '#22c55e',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  forgotLink: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  forgotLinkText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '500',
  },
  link: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    color: '#22c55e',
    fontSize: 14,
  },
  languageSwitch: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  languageSwitchText: {
    color: '#a1a1aa',
    fontSize: 15,
    fontWeight: '600',
  },
});
