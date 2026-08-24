# FlyFam — Resend SMTP (Supabase Auth)

Production e-postaları (kayıt doğrulama, şifre sıfırlama) için **Resend** + Supabase custom SMTP.

> Resend API anahtarı **yalnızca Supabase Dashboard**’a girilir; mobil uygulamaya veya `EXPO_PUBLIC_*` değişkenlerine koymayın.

---

## 1. Resend hesabı

1. [resend.com](https://resend.com) → kayıt
2. **API Keys** → **Create API Key** → tam yetki veya “Sending access”
3. Anahtarı kopyalayın (`re_...`) — bir daha gösterilmez

---

## 2. Gönderen domain (production)

### A) `flyfam.app` (önerilen)

**Detaylı DNS rehberi (ekran adımları):** [`RESEND_DNS_FLYFAM_APP_TR.md`](./RESEND_DNS_FLYFAM_APP_TR.md)

Kısa özet:

1. [resend.com/domains](https://resend.com/domains) → **Add Domain** → `flyfam.app`
2. Resend’in verdiği **3 kaydı** (MX `send`, TXT SPF `send`, TXT DKIM `resend._domainkey`) domain DNS panelinize ekleyin
3. **Verify DNS Records** → durum **Verified**
4. Gönderen: `auth@flyfam.app` (`.env` içinde `SMTP_FROM_EMAIL`)

**Cloudflare kurulumu (flyfam.app):** [`RESEND_CLOUDFLARE_FLYFAM_TR.md`](./RESEND_CLOUDFLARE_FLYFAM_TR.md) — nameserver taşıma + Resend **Sign in to Cloudflare**.

### B) Geçici test (domain yokken)

Resend’in test adresi `onboarding@resend.dev` yalnızca Resend hesabınızdaki **doğrulanmış kişisel e-postaya** mail atar; gerçek kullanıcılara göndermez. Domain doğrulaması production için şarttır.

### API anahtarı

`RESEND_API_KEY` repo kökündeki **`.env`** dosyasında (git’e girmez). Supabase SMTP şifresi olarak aynı key kullanılır.

> Bu sohbette paylaşılan key’i daha sonra Resend’de **rotate** etmeniz iyi olur. Domain eklemek için “Full access” key gerekir; **Sending only** key SMTP gönderimi için yeterlidir.

---

## 3. Supabase’e SMTP (otomatik script)

### Gerekli değişkenler (repo kökü `.env`)

```bash
# Zaten var:
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co

# Ekleyin:
RESEND_API_KEY=re_xxxxxxxx
SMTP_FROM_EMAIL=auth@flyfam.app
SMTP_SENDER_NAME=FlyFam

# Supabase Management API (tek seferlik kurulum)
# https://supabase.com/dashboard/account/tokens → Generate new token
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx
```

### Çalıştırma

```bash
cd /path/to/FLYFAM
node scripts/configure-supabase-resend-smtp.mjs
```

Script şunları yapar:

- `smtp.resend.com:465`, kullanıcı `resend`, şifre = API key
- `external_email_enabled: true`
- **Email sent** rate limit → 100/saat (Dashboard’dan sonra artırılabilir)

Başarılı olunca çıktıda Dashboard linkleri görünür.

---

## 4. Supabase’e SMTP (manuel Dashboard)

**Authentication** → **SMTP Settings**

| Alan | Değer |
|------|--------|
| Enable custom SMTP | Açık |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Resend API key (`re_...`) |
| Sender email | `auth@flyfam.app` (doğrulanmış domain) |
| Sender name | `FlyFam` |

**Save**

Sonra **Authentication** → **Rate Limits** → **Email sent** → örn. `100` veya ihtiyacınıza göre.

---

## 5. E-posta şablonları (değişmez)

SMTP değişince HTML şablonları aynı kalır. Yine de kontrol edin:

**Authentication** → **Email Templates** → `confirmation.html` / `recovery.html` içeriklerini repo’dan yapıştırın.

Bkz. [`SUPABASE_EMAIL_AUTH_KURULUM_TR.md`](./SUPABASE_EMAIL_AUTH_KURULUM_TR.md)

---

## 6. Test

1. Yeni bir e-posta ile **Kayıt Ol** (eski kullanıcıda “resend confirmation” gerekebilir)
2. Gelen kutusu + spam; gönderen **FlyFam &lt;auth@flyfam.app&gt;** olmalı
3. **Şifremi unuttum** → recovery maili
4. Resend → **Logs** → Delivered / Bounced

---

## Sorun giderme

| Belirti | Çözüm |
|--------|--------|
| `email rate limit exceeded` | Custom SMTP kayıtlı mı? Rate Limits → Email sent artırın |
| Mail gitmiyor, Resend’de hata | Domain doğrulanmış mı? `SMTP_FROM_EMAIL` o domain’de mi? |
| `Invalid login` / SMTP auth | Password alanına API key (`re_...`), kullanıcı `resend` |
| Sadece kendi adresinize gidiyor | `onboarding@resend.dev` test modu; `flyfam.app` doğrulayın |
| Supabase generic şablon | Email Templates → FlyFam HTML yapıştır |

---

## Maliyet (özet)

Resend ücretsiz planda günlük kota vardır; auth mail hacmi için çoğu MVP yeterli. Güncel fiyat: [resend.com/pricing](https://resend.com/pricing)
