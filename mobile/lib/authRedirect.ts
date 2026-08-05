/**
 * E-posta doğrulama / şifre sıfırlama redirect.
 *
 * Mail istemcileri `flyfam://` şemasını güvenilir açmaz; önce HTTPS köprü sayfası
 * açılır, sayfa uygulamaya (`flyfam://auth/callback`) yönlendirir.
 * Supabase Dashboard → Redirect URLs listesine bu HTTPS adres de eklenmeli.
 */
export const AUTH_EMAIL_BRIDGE_URL =
  'https://ganicanoz.github.io/flyfam/auth-callback.html';

/** @deprecated Prefer AUTH_EMAIL_BRIDGE_URL — kept for deep-link matching docs. */
export const AUTH_EMAIL_REDIRECT_URL = AUTH_EMAIL_BRIDGE_URL;

export function authEmailRedirectTo(): string {
  return AUTH_EMAIL_BRIDGE_URL;
}

/** Mail şablonlarında token_hash linki (PKCE code verifier gerektirmez). */
export function authEmailTokenHashHref(type: 'signup' | 'recovery' | 'email'): string {
  // Go template placeholders for Supabase Email Templates (paste as-is).
  return `${AUTH_EMAIL_BRIDGE_URL}?token_hash={{ .TokenHash }}&type=${type}`;
}
