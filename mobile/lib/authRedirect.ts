/**
 * E-posta doğrulama / şifre sıfırlama redirect.
 *
 * Tercih: Universal Link (`https://app.flyfamapp.com/auth-callback.html`) uygulamayı
 * doğrudan açar; PKCE `code` / OTP `token_hash` uygulama içinde çözülür.
 * Safari yedek yolu: web sayfası `token_hash`/`code` (veya hata) bilgisini sunucu
 * handoff’una yazar ve yalnız `flyfam://auth/callback?handoff=<uuid>` açar.
 * access/refresh token handoff’a alınmaz; custom scheme’de reddedilir.
 * Supabase Dashboard → Redirect URLs listesine bu HTTPS adres ekli olmalı.
 */
export const AUTH_EMAIL_BRIDGE_URL =
  'https://app.flyfamapp.com/auth-callback.html';

/** @deprecated Prefer AUTH_EMAIL_BRIDGE_URL — kept for deep-link matching docs. */
export const AUTH_EMAIL_REDIRECT_URL = AUTH_EMAIL_BRIDGE_URL;

export function authEmailRedirectTo(): string {
  return AUTH_EMAIL_BRIDGE_URL;
}

/** Mail şablonlarında token_hash linki (PKCE code verifier gerektirmez). */
export type AuthEmailTokenType =
  | 'signup'
  | 'recovery'
  | 'email'
  | 'invite'
  | 'magiclink'
  | 'email_change';

export function authEmailTokenHashHref(type: AuthEmailTokenType): string {
  // Go template placeholders for Supabase Email Templates (paste as-is).
  return `${AUTH_EMAIL_BRIDGE_URL}?token_hash={{ .TokenHash }}&type=${type}`;
}
