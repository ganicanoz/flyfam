# FlyFam — Supabase e-posta şablonları

Bu klasördeki HTML dosyalarını **production** Supabase projenize yapıştırın:

**Authentication** → **Email Templates**

| Dosya | Dashboard şablonu | Konu (Subject) önerisi |
|-------|-------------------|-------------------------|
| `confirmation.html` | Confirm signup | `FlyFam — E-posta doğrulama / Verify your email` |
| `recovery.html` | Reset password | `FlyFam — Şifre sıfırlama / Reset your password` |
| `invite.html` | Invite user | `FlyFam — Davetinizi kabul edin / Accept your invitation` |
| `magic-link.html` | Magic link | `FlyFam — Güvenli giriş bağlantınız / Your secure sign-in link` |
| `change-email.html` | Change email address | `FlyFam — E-posta değişikliğini doğrulayın / Confirm your email change` |

Her şablon **TR + EN** metin ve tek bir güvenli ana işlem butonu içerir.

- **FlyFam logosu** — Supabase Storage public URL (`admin-static/brand/flyfam-email-logo.png`); Gmail/Outlook base64 göstermez
- **Özgün başlık görselleri** — hesap/davet/giriş için `flyfam-email-confirmation-hero.jpg`, güvenlik işlemleri için `flyfam-email-recovery-hero.jpg`
- Renkler: uygulamayla aynı lacivert–mavi sistem `#0F1B3D` ve `#1A5CF5`; sıcak ışık vurguları aileyle bağlantıyı temsil eder
- Düzen: beyaz marka başlığı, geniş hikâye görseli, tek net ana işlem, hesap kartı, Türkçe ana içerik ve kompakt İngilizce karşılığı

Logo / renk güncelleme:

```bash
python3 scripts/build-auth-email-templates.py
node scripts/upload-email-brand-assets.mjs   # Storage’a yükle
python3 scripts/build-auth-email-templates.py
```

Önemli:

- Gövdede bağlantı: HTTPS köprü + `token_hash` (PKCE code verifier gerektirmez).
  Örnek: `https://app.flyfamapp.com/auth-callback.html?token_hash={{ .TokenHash }}&type=signup`
- Kullanılan doğrulama türleri: `signup`, `recovery`, `invite`, `magiclink`, `email_change`.
- **URL Configuration** → Site URL / Redirect URLs:
  - `https://app.flyfamapp.com/auth-callback.html`
  - `flyfam://auth/callback`
  - `flyfam://**`
  - `com.flyfam.app://**`
- Köprü sayfa: `support/auth-callback.html` (GitHub Pages)

Detaylı kurulum: [`docs/SUPABASE_EMAIL_AUTH_KURULUM_TR.md`](../../docs/SUPABASE_EMAIL_AUTH_KURULUM_TR.md)  
SMTP (Resend): [`docs/RESEND_SMTP_KURULUM_TR.md`](../../docs/RESEND_SMTP_KURULUM_TR.md)
