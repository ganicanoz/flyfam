import { Alert, Platform } from 'react-native';
import i18n from './i18n';
import { resendSignupConfirmationEmail } from './authResendConfirmation';
import { queueResendConfirmationOnSignIn } from './authResendBridge';

async function sendResendConfirmation(email: string): Promise<void> {
  const { ok, error } = await resendSignupConfirmationEmail(email);
  if (!ok) {
    Alert.alert(i18n.t('common.error'), error ?? i18n.t('authLink.failed'));
    return;
  }
  Alert.alert(i18n.t('signIn.resendConfirmation'), i18n.t('signIn.resendConfirmationSent'));
}

/** E-posta doğrulama mailini yeniden gönder (giriş, kayıt, süresi dolmuş deep link). */
export function promptResendConfirmationEmail(knownEmail?: string): void {
  const trimmed = knownEmail?.trim();

  if (trimmed) {
    Alert.alert(i18n.t('signIn.resendConfirmationTitle'), i18n.t('signIn.resendConfirmationBody'), [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      {
        text: i18n.t('signIn.resendConfirmation'),
        onPress: () => {
          void sendResendConfirmation(trimmed);
        },
      },
    ]);
    return;
  }

  if (Platform.OS === 'ios') {
    Alert.prompt(
      i18n.t('signIn.resendConfirmation'),
      i18n.t('signIn.resendConfirmationNeedEmail'),
      [
        { text: i18n.t('common.cancel'), style: 'cancel' },
        {
          text: i18n.t('signIn.resendConfirmation'),
          onPress: (text) => {
            const address = text?.trim();
            if (!address) {
              Alert.alert(i18n.t('common.error'), i18n.t('signIn.resendConfirmationNeedEmail'));
              return;
            }
            void sendResendConfirmation(address);
          },
        },
      ],
      'plain-text',
      '',
      'email-address'
    );
    return;
  }

  Alert.alert(i18n.t('signIn.resendConfirmation'), i18n.t('signIn.resendConfirmationNeedEmail'), [
    { text: i18n.t('common.cancel'), style: 'cancel' },
    {
      text: i18n.t('signIn.title'),
      onPress: () => queueResendConfirmationOnSignIn(),
    },
  ]);
}
