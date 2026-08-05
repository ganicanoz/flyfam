# FlyFam — Supabase e-posta şablonları

Bu klasördeki HTML dosyalarını **production** Supabase projenize yapıştırın:

**Authentication** → **Email Templates**

| Dosya | Dashboard şablonu | Konu (Subject) önerisi |
|-------|-------------------|-------------------------|
| `confirmation.html` | Confirm signup | `FlyFam — E-posta doğrulama / Verify your email` |
| `recovery.html` | Reset password | `FlyFam — Şifre sıfırlama / Reset your password` |

Her şablon **TR + EN** metin içerir (tek mail, tek `{{ .ConfirmationURL }}` butonu).

- **FlyFam logosu** — Supabase Storage public URL (`admin-static/brand/flyfam-email-logo.png`); Gmail/Outlook base64 göstermez
- Renkler: gökyüzü gradient `#D8E8FD → #B4CCFB → #7BA8EE`, buton `#1D4FA3`, link `#5AA6FF`

Logo / renk güncelleme:

```bash
python3 scripts/build-auth-email-templates.py
node scripts/upload-email-brand-assets.mjs   # Storage’a yükle
python3 scripts/build-auth-email-templates.py
```

Önemli:

- Gövdede bağlantı: HTTPS köprü + `token_hash` (PKCE code verifier gerektirmez).
  Örnek: `https://ganicanoz.github.io/flyfam/auth-callback.html?token_hash={{ .TokenHash }}&type=signup`
- **URL Configuration** → Site URL / Redirect URLs:
  - `https://ganicanoz.github.io/flyfam/auth-callback.html`
  - `flyfam://auth/callback`
  - `flyfam://**`
  - `com.flyfam.app://**`
- Köprü sayfa: `support/auth-callback.html` (GitHub Pages)

Detaylı kurulum: [`docs/SUPABASE_EMAIL_AUTH_KURULUM_TR.md`](../../docs/SUPABASE_EMAIL_AUTH_KURULUM_TR.md)  
SMTP (Resend): [`docs/RESEND_SMTP_KURULUM_TR.md`](../../docs/RESEND_SMTP_KURULUM_TR.md)
