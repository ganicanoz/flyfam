# Resend kurulum — kaldığımız yer (FlyFam)

Son kontrol: **2026-06-01** (`node scripts/check-resend-dns.mjs`)

## Özet

| Adım | Durum |
|------|--------|
| Resend hesabı + API key (`.env`) | ✅ Var |
| Supabase → custom SMTP (`configure-supabase-resend-smtp.mjs`) | ✅ `smtp.resend.com`, `auth@flyfam.app`, 100 mail/saat |
| OTP link süresi 24 saat | ✅ `mailer_otp_exp = 86400` |
| **`flyfam.app` domain doğrulama (DNS)** | ❌ **Yapılmadı — blokör** |
| Cloudflare’e taşıma | ⏸ Yapılmadı (şart değil) |
| Supabase e-posta şablonları (HTML) | ⚠️ Dashboard’da elle kontrol |

**Resend şu an çalışmıyor çünkü:** `auth@flyfam.app` adresinden gönderim için domain **Verified** değil. API yanıtı:

> The flyfam.app domain is not verified. Please add and verify your domain on resend.com/domains

DNS sorgusu: `send.flyfam.app` için **MX / SPF / DKIM kayıtları yok** (henüz IONOS’a eklenmemiş).

---

## Sıradaki iş (sizin yapmanız gereken — ~15 dk)

Domain DNS **IONOS**’ta (`ui-dns.*` nameserver). Cloudflare şart değil.

### 1. Resend’de domain

1. [resend.com/domains](https://resend.com/domains)
2. `flyfam.app` listede yoksa **Add Domain** → `flyfam.app`
3. **Receiving** kapalı kalsın (sadece gönderim)

### 2. IONOS DNS (3 kayıt)

[IONOS](https://www.ionos.com) → Domainler → `flyfam.app` → **DNS**

Resend’in **sizin hesabınıza özel** tablosundan kopyalayın (örnek değerleri kullanmayın):

| Tür | Host / Name | Not |
|-----|-------------|-----|
| MX | `send` | Priority 10, Resend’deki mail sunucusu |
| TXT | `send` | SPF metni |
| TXT | `resend._domainkey` | DKIM `p=...` (tamamı) |

Detaylı ekran adımları: [`RESEND_DNS_FLYFAM_APP_TR.md`](./RESEND_DNS_FLYFAM_APP_TR.md)

### 3. Doğrula

1. Resend → **Verify DNS Records** → durum **Verified**
2. Terminal:

```bash
node scripts/check-resend-dns.mjs
```

Üç satır ✓ olmalı.

### 4. Test maili

```bash
node scripts/check-resend-dns.mjs --send-test=ganicanoz@gmail.com
```

Gelen kutusu + spam; gönderen `FlyFam <auth@flyfam.app>`.

### 5. Uygulama kaydı

Mobil uygulamada **yeni e-posta** ile kayıt ol veya “doğrulama mailini tekrar gönder”.

---

## Zaten tamamlananlar (tekrar yapmayın)

```bash
# Supabase SMTP — bir kez yeterli (tekrar çalıştırılabilir)
node scripts/configure-supabase-resend-smtp.mjs

# OTP süresi
node scripts/configure-supabase-auth-otp-expiry.mjs --show
```

Dashboard: [Auth SMTP](https://supabase.com/dashboard/project/slmgmcpluanezvkgkozw/auth/smtp)

---

## İleride (isteğe bağlı)

- **Cloudflare:** [`RESEND_CLOUDFLARE_FLYFAM_TR.md`](./RESEND_CLOUDFLARE_FLYFAM_TR.md) — nameserver taşıyınca Resend “Sign in to Cloudflare” ile otomatik DNS
- **Logo in mail:** `python3 scripts/build-auth-email-templates.py` + `node scripts/upload-email-brand-assets.mjs` → Dashboard şablonları

---

## Sorun giderme

| Belirti | Neden |
|--------|--------|
| `email rate limit exceeded` | Eski built-in kota; SMTP + 100/saat ayarlandı — yine de saatlik bekleme gerekebilir |
| Mail hiç gitmiyor | Domain not verified (bu dosyadaki DNS adımı) |
| Sadece kendi adresinize gidiyor | `onboarding@resend.dev` test modu; `flyfam.app` verified olmalı |
| API key domains listesi 401 | Normal — “Sending only” key domain listelemez; DNS script ile kontrol edin |
