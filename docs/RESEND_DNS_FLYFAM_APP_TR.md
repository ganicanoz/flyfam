# flyfam.app — Resend DNS doğrulama (adım adım)

Resend, sizin adınıza mail atabilmek için domain’in DNS’ine birkaç kayıt eklemenizi ister. **Kayıtlar domain başına farklıdır** — aşağıdaki örnek değerleri kopyalamayın; Resend panelinde **sizin için üretilen** değerleri kullanın.

---

## Ön koşul

- [resend.com](https://resend.com) hesabınız açık
- `flyfam.app` domain’inin DNS’ini yönettiğiniz panel (Cloudflare, GoDaddy, Namecheap, Google Domains, Turhost, Natro vb.)

`flyfam.app` nerede satın alındıysa DNS genelde oradadır.

**Cloudflare kullanacaksanız (önerilen):** [`RESEND_CLOUDFLARE_FLYFAM_TR.md`](./RESEND_CLOUDFLARE_FLYFAM_TR.md) — önce nameserver’ları Cloudflare’e taşıyın, sonra Resend **Sign in to Cloudflare**.

> Not: `flyfam.app` şu an `ui-dns.*` (IONOS tipi) kullanıyor; henüz Cloudflare’de değilse otomatik bağlantı çalışmaz.

---

## Adım 1 — Domain’i Resend’e ekle

1. [resend.com/domains](https://resend.com/domains) → **Add Domain**
2. Domain adı: **`flyfam.app`** (kök domain; auth için yeterli)
3. **Region** varsayılanı bırakın
4. **Receiving (gelen mail)** kapalı kalsın — sadece auth maili göndereceğiz
5. **Add**

Resend bir tablo gösterir: genelde **3 kayıt** (bazen DMARC isteğe bağlı):

| Tür | Name (host) | Ne işe yarar |
|-----|-------------|----------------|
| **MX** | `send` | Gönderim yolu |
| **TXT** | `send` | SPF (kim gönderebilir) |
| **TXT** | `resend._domainkey` | DKIM (imza) |

Bu ekranı açık bırakın; DNS paneline geçerken buradan kopyalayacaksınız.

---

## Adım 2 — DNS paneline girin

`flyfam.app` için DNS yönetim sayfasını açın. Örnek menü adları:

- Cloudflare → **DNS** → **Records**
- GoDaddy → Domain → **DNS**
- Namecheap → **Advanced DNS**
- Turhost / Natro → **DNS Zone** / **Nameserver**

Yeni kayıt eklemek için **Add record** / **Kayıt ekle** kullanın.

---

## Adım 3 — Kayıtları tek tek ekleyin

Resend’deki her satır için **bir DNS kaydı** oluşturun.

### Önemli kural: Name (host) alanı

Resend’de `send.flyfam.app` yazıyorsa DNS paneline çoğu zaman sadece şunu yazarsınız:

```
send
```

Benzer şekilde `resend._domainkey.flyfam.app` → sadece:

```
resend._domainkey
```

Panel otomatik `flyfam.app` ekler. Cloudflare’de **Proxy kapalı (DNS only / gri bulut)** olmalı — turuncu proxy açıkken doğrulama bazen başarısız olur.

### MX kaydı

| Alan | Değer |
|------|--------|
| Type | MX |
| Name / Host | `send` |
| Mail server / Value | Resend’deki **MX** değeri (ör. `feedback-smtp....amazonaws.com`) |
| Priority | `10` |
| TTL | Auto / 3600 |

### TXT — SPF (aynı `send` host)

| Alan | Değer |
|------|--------|
| Type | TXT |
| Name / Host | `send` |
| Value / Content | Resend’deki SPF metni (ör. `v=spf1 include:amazonses.com ~all`) |

Tırnak işaretlerini panel istiyorsa ekleyin; istemiyorsa sadece metin.

### TXT — DKIM

| Alan | Değer |
|------|--------|
| Type | TXT |
| Name / Host | `resend._domainkey` |
| Value / Content | Resend’deki uzun `p=...` anahtarı (tamamını kopyalayın) |

---

## Adım 4 — Doğrula

1. Tüm kayıtları kaydedin
2. [resend.com/domains](https://resend.com/domains) → `flyfam.app` → **Verify DNS Records**
3. Birkaç dakika – 48 saat sürebilir; çoğu zaman 15–30 dakika

Durum **Verified** olunca `auth@flyfam.app` ile mail atabilirsiniz.

---

## Cloudflare kullanıyorsanız (en kolay)

1. Resend → Domains → `flyfam.app` → **Sign in to Cloudflare**
2. Cloudflare hesabınıza izin verin
3. Kayıtlar otomatik eklenir → **Verify DNS Records**

---

## Kontrol listesi

- [ ] Resend’de domain eklendi
- [ ] MX `send` eklendi
- [ ] TXT `send` (SPF) eklendi
- [ ] TXT `resend._domainkey` (DKIM) eklendi
- [ ] Cloudflare ise proxy **DNS only**
- [ ] Resend durumu **Verified**
- [ ] `.env` içinde `SMTP_FROM_EMAIL=auth@flyfam.app`
- [ ] `node scripts/configure-supabase-resend-smtp.mjs` (Supabase token ile)

---

## Sık hatalar

| Sorun | Çözüm |
|--------|--------|
| Pending uzun sürüyor | DNS yayılımı; `dig TXT send.flyfam.app` ile kontrol |
| Failed | Yanlış host (`send.flyfam.app` yerine `send` veya tam tersi) |
| Cloudflare turuncu bulut | Gri bulut (DNS only) yapın |
| Mail gitmiyor, domain verified | `SMTP_FROM_EMAIL` `@flyfam.app` ile bitmeli |

Terminal kontrolü (Mac):

```bash
dig MX send.flyfam.app +short
dig TXT send.flyfam.app +short
dig TXT resend._domainkey.flyfam.app +short
```

Çıktı boşsa kayıt henüz yayılmamış veya yanlış panel.

---

## Sonraki adım

Domain **Verified** olduktan sonra:

```bash
node scripts/configure-supabase-resend-smtp.mjs
```

Bkz. [`RESEND_SMTP_KURULUM_TR.md`](./RESEND_SMTP_KURULUM_TR.md)
