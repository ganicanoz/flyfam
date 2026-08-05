import { Alert } from 'react-native';
import i18n from './i18n';
import type { ApplyAuthSessionResult } from './authSessionFromUrl';
import { promptResendConfirmationEmail } from './authResendConfirmationUi';

function isNetworkErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network connection was lost') ||
    lower.includes('could not connect') ||
    lower.includes('internet connection appears to be offline')
  );
}

export function showAuthLinkResultAlert(result: ApplyAuthSessionResult): void {
  if (result.applied) {
    if (!result.recovery) {
      Alert.alert(
        i18n.t('authLink.successTitle'),
        i18n.t('authLink.successMessage')
      );
    }
    return;
  }

  if (result.errorCode === 'expired') {
    Alert.alert(i18n.t('signIn.resendConfirmationTitle'), i18n.t('authLink.expired'), [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      {
        text: i18n.t('signIn.resendConfirmation'),
        onPress: () => promptResendConfirmationEmail(),
      },
    ]);
    return;
  }

  if (result.errorCode === 'pkce') {
    Alert.alert(i18n.t('signIn.resendConfirmationTitle'), i18n.t('authLink.pkceMismatch'), [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      {
        text: i18n.t('signIn.resendConfirmation'),
        onPress: () => promptResendConfirmationEmail(),
      },
    ]);
    return;
  }

  if (result.errorCode === 'network') {
    Alert.alert(i18n.t('authLink.networkTitle'), i18n.t('authLink.networkMessage'));
    return;
  }

  if (result.errorCode === 'provider_error') {
    const msg = result.errorMessage ?? i18n.t('authLink.failed');
    const lower = msg.toLowerCase();
    if (isNetworkErrorMessage(msg)) {
      Alert.alert(i18n.t('authLink.networkTitle'), i18n.t('authLink.networkMessage'));
      return;
    }
    const looksExpired =
      lower.includes('expired') ||
      lower.includes('invalid') ||
      lower.includes('otp') ||
      lower.includes('not verified');
    if (looksExpired) {
      Alert.alert(i18n.t('signIn.resendConfirmationTitle'), msg, [
        { text: i18n.t('common.cancel'), style: 'cancel' },
        {
          text: i18n.t('signIn.resendConfirmation'),
          onPress: () => promptResendConfirmationEmail(),
        },
      ]);
      return;
    }
    Alert.alert(i18n.t('common.error'), msg);
    return;
  }

  if (result.recovery || result.hadAuthParams) {
    Alert.alert(i18n.t('common.error'), i18n.t('authLink.failed'), [
      { text: i18n.t('common.ok') },
      {
        text: i18n.t('signIn.resendConfirmation'),
        onPress: () => promptResendConfirmationEmail(),
      },
    ]);
  }
}
