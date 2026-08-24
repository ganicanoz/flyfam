import { takePendingResendEmail } from './authResendBridge';
import { promptResendConfirmationEmail } from './authResendConfirmationUi';

/** Giriş ekranı açıldığında (deep link köprüsü) bekleyen e-posta ile yeniden gönder diyaloğu. */
export function runPendingResendOnSignInFocus(setEmail: (email: string) => void): void {
  const pending = takePendingResendEmail();
  if (!pending) return;
  setEmail(pending);
  promptResendConfirmationEmail(pending);
}
