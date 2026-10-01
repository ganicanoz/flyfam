import { useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  type TextInput,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useSession } from '../contexts/SessionContext';
import { colors, useThemeMode } from '../theme/colors';
import { spacing } from '../theme/tokens';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  FormKeyboardAccessory,
  FORM_KEYBOARD_ACCESSORY_ID,
} from '../components/FormKeyboardAccessory';
import { scrollInputIntoView } from '../components/KeyboardSafeScroll';

export default function ResetPassword() {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const { clearPasswordRecovery } = useSession();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const confirmRef = useRef<TextInput>(null);

  const focusScroll = (e: { nativeEvent?: { target?: unknown } }) => {
    setTimeout(() => scrollInputIntoView(scrollRef, e, 140), 80);
  };

  const canSubmit = password.length > 0 && confirmPassword.length > 0 && !loading;

  const handleSave = async () => {
    if (!password || !confirmPassword) {
      Alert.alert(t('common.error'), t('resetPassword.errorFillAll'));
      return;
    }
    if (password.length < 6) {
      Alert.alert(t('common.error'), t('resetPassword.errorPasswordLength'));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t('common.error'), t('resetPassword.errorPasswordMismatch'));
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }

    clearPasswordRecovery();
    Alert.alert(t('resetPassword.successTitle'), t('resetPassword.successMessage'));
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenPageHeader
        title={t('resetPassword.title')}
        subtitle={t('resetPassword.subtitle')}
        showBack={false}
      />
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
            <View style={[styles.heroIcon, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="lock-closed" size={26} color={colors.primary} />
            </View>
          </View>

          <FormField
            label={t('resetPassword.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('resetPassword.password')}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!loading}
            returnKeyType="next"
            blurOnSubmit={false}
            enablesReturnKeyAutomatically
            inputAccessoryViewID={FORM_KEYBOARD_ACCESSORY_ID}
            onFocus={focusScroll}
            onSubmitEditing={() => confirmRef.current?.focus()}
          />

          <FormField
            ref={confirmRef}
            label={t('resetPassword.confirmPassword')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder={t('resetPassword.confirmPassword')}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!loading}
            returnKeyType="go"
            enablesReturnKeyAutomatically
            inputAccessoryViewID={FORM_KEYBOARD_ACCESSORY_ID}
            onFocus={focusScroll}
            onSubmitEditing={() => {
              if (canSubmit) void handleSave();
            }}
          />

          <PrimaryButton
            title={t('resetPassword.submit')}
            onPress={() => void handleSave()}
            loading={loading}
            disabled={!canSubmit}
            style={styles.submit}
          />
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
      marginBottom: 24,
      marginTop: 8,
    },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submit: {
      marginTop: 8,
    },
  });
}
