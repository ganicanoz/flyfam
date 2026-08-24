# Supabase e-posta doğrulama — production (FlyFam)

App Store / Play build: `com.flyfam.app`, deep link scheme `flyfam`.

**Production:** Varsayılan Supabase maili çok düşük kotada ve rate limit verir → **Resend SMTP** kurun: [`RESEND_SMTP_KURULUM_TR.md`](./RESEND_SMTP_KURULUM_TR.md)  
**Şablon ve URL** ayarları Dashboard’da yapılmalı (aşağıda).

---

## 1. URL Configuration (link uygulamayı açsın)

**Authentication** → **URL Configuration**

### Site URL

```
flyfam://auth/callback
```

> Site URL hâlâ `https://xxxxx.supabase.co` ise maildeki link tarayıcıda Supabase sayfasında kalır; FlyFam açılmaz.

### Redirect URLs (her satır ayrı)

```
flyfam://auth/callback
flyfam://**
com.flyfam.app://**
```

**Save**

---

## 2. Confirm email ve link süresi

**Authentication** → **Providers** → **Email** → **Confirm email** → **Açık** → Save

**E-posta link süresi (OTP expiry):** Çoğu hosted projede Dashboard’da **“OTP expiry” alanı yoktur** (eski dokümantasyon kalmış olabilir). Production’da süreyi **Management API** ile ayarlayın; API alan adı **`mailer_otp_exp`** (saniye). Önerilen: **86400** (24 saat). Varsayılan çoğu projede **3600** (1 saat).

```bash
# .env: SUPABASE_ACCESS_TOKEN, EXPO_PUBLIC_SUPABASE_URL
node scripts/configure-supabase-auth-otp-expiry.mjs --show    # mevcut değer
node scripts/configure-supabase-auth-otp-expiry.mjs --dry-run
node scripts/configure-supabase-auth-otp-expiry.mjs           # 86400 uygular
```

Token: [Account → Access Tokens](https://supabase.com/dashboard/account/tokens). Supabase süresiz link vermez; süre dolunca uygulamadan **yeni doğrulama maili** istenebilir.

**Local:** `supabase/config.toml` → `[auth.email]` → `otp_expiry = 86400` yalnızca `supabase start` için geçerlidir; hosted projeye otomatik gitmez.

---

## 3. FlyFam e-posta şablonu (metin + logo görünümü)

**Authentication** → **Email Templates**

| Şablon | Subject (konu) | Gövde |
|--------|----------------|--------|
| **Confirm signup** | `FlyFam — E-posta doğrulama / Verify your email` | `supabase/templates/confirmation.html` (TR+EN) |
| **Reset password** | `FlyFam — Şifre sıfırlama / Reset your password` | `supabase/templates/recovery.html` (TR+EN) |

Kurallar:

- Buton/link **`{{ .ConfirmationURL }}`** olmalı (`{{ .SiteURL }}` kullanmayın).
- Kaydettikten sonra **yeni bir test kaydı** ile maili kontrol edin (eski mailler eski şablonla gelir).

### Logo (Gmail / Outlook)

Çoğu mail istemcisi `data:image/...` (base64) göstermez. Logo **public HTTPS** ile sunulmalıdır.

```bash
# .env içinde SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY olmalı
python3 scripts/build-auth-email-templates.py
node scripts/upload-email-brand-assets.mjs
python3 scripts/build-auth-email-templates.py
```

Şablonlarda kullanılan adres: `admin-static/brand/flyfam-email-logo.png` (public bucket).
HTML’i yeniden ürettikten sonra Dashboard → Email Templates’e yapıştırın.

---

## 4. Uygulama tarafı (repo)

Kayıtta gönderilen adres (`mobile/lib/authRedirect.ts`):

```
flyfam://auth/callback
```

Doğrulama linki uygulamayı açınca oturum kurulur (`AuthEmailLinkListener` + PKCE).

Android için `app.config.js` içinde `flyfam://auth/callback` intent filter vardır; **yeni native build** gerekir (`npx expo prebuild` / EAS build).

---

## 5. Test

### Hızlı test (dev client)

1. Dashboard URL + şablonları yukarıdaki gibi kaydet.
2. `cd mobile && npm run ios:sim` (veya kurulu dev build).
3. **Kayıt Ol** → gerçek e-posta.
4. Mail: **FlyFam** başlıklı, mavi buton **“FlyFam'de doğrula”**.
5. Linke tıkla → kısa süre Supabase doğrular → **FlyFam uygulaması** açılmalı.
6. Otomatik giriş olmazsa **Giriş** ile email + şifre.

### Production (TestFlight / mağaza)

Aynı Dashboard ayarları production projede de geçerli. Yeni build ile dene.

---

## Sorun giderme

| Belirti | Çözüm |
|--------|--------|
| Mail Supabase / generic metin | Dashboard → Email Templates → `confirmation.html` yapıştır, Save |
| Link `supabase.co` sayfasında kalıyor | Site URL = `flyfam://auth/callback`, Redirect URLs listesi |
| Android’de uygulama açılmıyor | Yeni build (intent filter); linki telefon tarayıcısında aç |
| iOS’ta açılmıyor | TestFlight/dev build (Expo Go değil); URL Configuration kontrol |
| “Email rate limit exceeded” | Aşağıdaki **Rate limit** bölümüne bakın |
| Doğrulama linki çalışmıyor / not verified | Uygulama: **Doğrulama maili gelmedi / süresi doldu** veya girişte **Doğrulama mailini tekrar gönder**; linke tıklayınca **FlyFam** açılmalı |

---

## Rate limit (“email rate limit exceeded”)

Supabase’in **varsayılan (built-in) SMTP** servisi saatte **çok az** mail gönderir (proje geneli kota; test sırasında kayıt + şifre sıfırlama + tekrar deneme hızla doldurur). Bu limiti Dashboard’dan **yükseltemezsiniz** — kalıcı çözüm **custom SMTP**’dir.

### Hemen (test için)

1. **30–60 dakika bekleyin** — kota genelde saatlik sıfırlanır.
2. Aynı e-postaya art arda “Kayıt ol” / “Şifremi unuttum” **spam yapmayın**.
3. **Authentication → Users** → kullanıcıyı seç → **Confirm email** (manuel onay; yeni mail göndermeden teste devam).
4. Varsayılan SMTP’de mail çoğu zaman yalnızca **organizasyon ekibindeki** adreslere gider; farklı bir e-posta denemek bazen yetmez.

### Kalıcı çözüm: Custom SMTP (production)

**Authentication** → **SMTP Settings** → Enable custom SMTP

| Sağlayıcı | Not |
|-----------|-----|
| [Resend](https://resend.com/docs/send-with-supabase-smtp) | Supabase ile iyi entegre, kurulumu kolay |
| SendGrid, Brevo, Postmark, AWS SES | SMTP bilgileri Dashboard’a girilir |

Örnek alanlar: Host, Port (587), User, Password, **Sender email** (`noreply@flyfam.app` gibi doğrulanmış domain), **Sender name** (`FlyFam`).

SMTP açıldıktan sonra:

- **Authentication** → **Rate Limits** → **Email sent** değerini artırın (custom SMTP ile özelleştirilebilir; varsayılan ~30/saat).
- E-posta şablonları (`confirmation.html`, `recovery.html`) **aynı kalır** — HTML’i tekrar yapıştırmanız yeterli.

### Rate Limits sayfası (Dashboard)

**Authentication** → **Rate Limits**

- **Email sent** — proje geneli (custom SMTP gerekir, built-in’de sabit)
- **Password reset** / **Signup confirmation** — aynı kullanıcıya tekrar mail aralığı (testte sık tıklamayı engeller)

---

## SMTP (production)

Adım adım Resend kurulumu: **[`RESEND_SMTP_KURULUM_TR.md`](./RESEND_SMTP_KURULUM_TR.md)**

```bash
# .env: RESEND_API_KEY, SUPABASE_ACCESS_TOKEN, SMTP_FROM_EMAIL
node scripts/configure-supabase-resend-smtp.mjs
```
