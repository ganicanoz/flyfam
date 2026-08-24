# Mevcut Cron ve Push Bildirim Ayarları (Eski Görüşmelerden)

Bu dosya, masaüstündeki eski FlyFam projesindeki görüşmelerden çıkarılan **mevcut kurulum özetidir**. Proje `gani-apps/FLYFAM` klasörüne taşındığı için referans olsun diye tutuluyor.

---

## Supabase projesi

- **Project ref:** `slmgmcpluanezvkgkozw`
- **Base URL:** `https://slmgmcpluanezvkgkozw.supabase.co`

---

## Cron (check-flight-status-and-notify)

- **Servis:** [cron-job.org](https://cron-job.org)
- **URL:** `https://slmgmcpluanezvkgkozw.supabase.co/functions/v1/check-flight-status-and-notify`
- **Method:** `POST`
- **Headers:**
  - `Content-Type: application/json`
  - `x-cron-secret: <CRON_SECRET>` — değer **Supabase Edge Function** → **check-flight-status-and-notify** → **Secrets** içindeki `CRON_SECRET` ile **birebir aynı** olmalı.
- **Schedule:** Her **5 dakikada** bir (API maliyetini düşürmek için 2–3 dk’dan 5 dk’ya çekildi).
- **Not:** Bu fonksiyon `Authorization: Bearer` ile değil, **sadece `x-cron-secret`** ile yetkilendiriliyor. Gerekirse bazı projelerde Supabase kapısı için ek olarak `Authorization: Bearer <anon_key>` da eklenebilir; eski görüşmede curl ile sadece `x-cron-secret` ile 200 alındı.

---

## Bildirim akışı

1. **cron-job.org** her **5 dakikada** **check-flight-status-and-notify**’ı çağırıyor.
2. Fonksiyon yalnızca `scheduled_departure` dolu uçuşları alıyor: kalkışı en fazla ~30 dk sonrasına kadar ve en fazla ~48 saat geriye kadar olan pencerede; ayrıca **yalnızca planlı kalkıştan 30 dk önce ve sonrası** için FR24/AE ile durum güncellenir (planı olmayan “dash” uçuşlar crew uygulamasının bugün-UTC saatlik AE doldurmasıyla gelir). `landed` / `parked` / `cancelled` / `diverted` için API çağrısı yapılmaz.
3. Statü değiştiyse:
   - **Kalktı (took_off)** → **notify-family** `type: 'took_off'` ile çağrılıyor.
   - **İndi (landed)** → **notify-family** `type: 'landed'` ile çağrılıyor.
4. **notify-family** ilgili crew’e bağlı aile hesaplarını bulup push gönderiyor.

---

## Aile bildirimi için gerekli koşullar

- Cron’un **periyodik** çalışması (her 5 dk).
- **notify-family** Edge Function’ının deploy ve çalışır olması; push için gerekli secret’ların tanımlı olması.
- Aile kullanıcısının:
  - Crew ile **bağlantısının onaylanmış** olması,
  - Uygulamada **bildirim izninin** açık olması,
  - Cihazda **push token**’ın Supabase **device_tokens** tablosuna kayıtlı olması (aile giriş yapıp Family sekmesine girince token kaydediliyor).

---

## Gizlilik

**CRON_SECRET** ve diğer secret’lar bu dosyada **saklanmıyor**. Değerler yalnızca:
- **Supabase Dashboard** → Edge Functions → ilgili fonksiyon → Secrets
- **cron-job.org** → ilgili job → Request headers → `x-cron-secret`

içinde tutulmalı ve eşleşmeli.

---

## Son ayarlar kontrol listesi (5 dk)

Aşağıdakileri sırayla kontrol edin; hepsi uyumlu olmalı.

| # | Nerede | Kontrol | Beklenen |
|---|--------|---------|----------|
| 1 | **cron-job.org** | Job aktif mi? | Evet (disabled değil). |
| 2 | **cron-job.org** | URL | `https://slmgmcpluanezvkgkozw.supabase.co/functions/v1/check-flight-status-and-notify` |
| 3 | **cron-job.org** | Method | POST |
| 4 | **cron-job.org** | Schedule | **Her 5 dakikada bir** (every 5 minutes). |
| 5 | **cron-job.org** | Header: `x-cron-secret` | Supabase’teki CRON_SECRET ile **birebir aynı** (boşluksuz). |
| 6 | **cron-job.org** | Header: `Content-Type` | `application/json` (isteğe bağlı; body boş olsa da olur). |
| 7 | **Supabase** → check-flight-status-and-notify → Secrets | `CRON_SECRET` | Tanımlı; cron-job.org’daki `x-cron-secret` ile aynı değer. |
| 8 | **Supabase** → check-flight-status-and-notify → Logs | Son çalışmalar | Periyodik (yaklaşık 5 dk aralıklarla) ve **200** dönüyor. |
| 9 | **Supabase** → notify-family → Secrets | Push / FCM vb. | Gerekli secret’lar dolu (bildirim gönderimi için). |

**Hızlı test (terminal):**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://slmgmcpluanezvkgkozw.supabase.co/functions/v1/check-flight-status-and-notify" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: BURAYA_CRON_SECRET_YAPIŞTIR"
```

Beklenen çıktı: **200**. (Body görmek istersen `-w "%{http_code}\n"` kaldırıp `-v` ekleyebilirsin.)

---

*Kaynak: Eski Cursor görüşmeleri (Desktop FlyFam → gani-apps/FLYFAM taşındıktan sonra agent-transcripts’ten çıkarıldı). Son güncelleme: 5 dk periyodu (API maliyeti).*
