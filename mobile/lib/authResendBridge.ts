import { navigationRef } from '../navigationRef';

/** Deep link / Android: Giriş ekranına yönlendirip doğrulama maili yeniden gönder. */
let pendingResendEmail: string | null = null;

export function queueResendConfirmationOnSignIn(email?: string): void {
  pendingResendEmail = email?.trim() || null;
  if (navigationRef.isReady()) {
    navigationRef.navigate('SignIn');
  }
}

export function takePendingResendEmail(): string | null {
  const value = pendingResendEmail;
  pendingResendEmail = null;
  return value;
}
