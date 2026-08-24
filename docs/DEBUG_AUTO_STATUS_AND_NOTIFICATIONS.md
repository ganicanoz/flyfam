# Otomatik statü güncelleme ve bildirim akışı – Adım adım kontrol

Bu dokümanda akış özetleniyor; her adımda **loglardan veya veritabanından** nereye bakacağın yazıyor.

---

## Edge Function’ları nasıl deploy edersin?

Yeni logların çalışması için **notify-family** (ve istersen **check-flight-status-and-notify**) fonksiyonlarını tekrar deploy etmen gerekir.

1. **Supabase CLI kurulu olsun.**  
   Kurulu değilse: `npm install -g supabase` (veya [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)).

2. **Proje kökünde terminal aç** (yani `mobile/` veya `supabase/` değil, `FlyFam/` klasöründe).

3. **Giriş ve proje bağlantısı** (daha önce yaptıysan atlayabilirsin):
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   ```
   `<project-ref>`: Supabase Dashboard → Project Settings → General → **Reference ID** (örn. `slmgmcpluanezvkgkozw`).

4. **Fonksiyonları deploy et:**
   ```bash
   supabase functions deploy notify-family
   supabase functions deploy check-flight-status-and-notify
   ```
   İstersen sadece birini de deploy edebilirsin: `supabase functions deploy notify-family`

5. Bölge seçmen istenirse kullanıcılarına en yakın olanı seç (örn. Avrupa için `eu-west-1`).

6. **Kontrol:** Supabase Dashboard → **Edge Functions** listesinde ilgili fonksiyonların **UPDATED** tarihi az önce güncellenmiş olmalı.

**Not:** Secret’lar (CRON_SECRET, FR24_API_TOKEN vb.) deploy sırasında değişmez; Dashboard → Edge Functions → fonksiyon adı → **Secrets** üzerinden ayrı yönetilir.

---

## Akış özeti

```
[Cron-job.org her 2–3 dk]
        │
        ▼
  check-flight-status-and-notify
        │
        ├─ 1) flights tablosundan uçuşları al (flight_date dün/bugün/yarın)
        ├─ 2) Her uçuş için FR24 API’den veri çek
        ├─ 3) actual_departure, actual_arrival, flight_status hesapla → DB güncelle
        ├─ 4) flight_status = en_route → notification_log’da took_off yoksa → notify-family (took_off)
        └─ 5) flight_status = landed  → notification_log’da landed yoksa  → notify-family (landed)
                                                    │
                                                    ▼
                                            notify-family
                                                    │
                    ├─ x-cron-secret doğru mu? (CRON_SECRET)
                    ├─ flight → crew_id → family_connections (approved)
                    ├─ notification_preferences (took_off/landed kapalı mı?)
                    ├─ device_tokens (aile kullanıcısı token’ı var mı?)
                    └─ Expo Push gönder → notification_log’a yaz
```

---

## Adım 1: Cron gerçekten tetikliyor mu?

**Ne kontrol et:** cron-job.org’da `check-flight-status-and-notify` job’u **aktif** ve **Last execution: Successful**.

**Log:** Supabase → Edge Functions → **check-flight-status-and-notify** → Logs.  
Son birkaç dakikada **POST** istekleri ve **200** cevabı görünmeli. Cevap gövdesi örneği:

```json
{ "ok": true, "processed": 5, "updated": 1, "tookOffSent": 0, "landedSent": 1, "cancelledSent": 0, "divertedSent": 0 }
```

- **401:** `x-cron-secret` yanlış/eksik → cron-job.org’daki header ile Supabase’teki **check-flight-status-and-notify** secret’ı (CRON_SECRET) aynı olmalı.
- **500:** Log’daki hata mesajına bak (ör. list error, FR24 token).

---

## Adım 2: Uçuş listesi alınıyor mu?

**Ne kontrol et:** Yukarıdaki cevapta **processed** > 0.

- **processed = 0:** O tarih aralığında (dün/bugün/yarın) **flights** tablosunda kayıt yok. Crew uçuş eklemiş mi, **flight_date** doğru mu (YYYY-MM-DD) kontrol et.
- **processed > 0:** Cron uçuşları buldu; sıradaki adım FR24.

---

## Adım 3: FR24’ten veri geliyor mu? (Otomatik statü neden güncellenmiyor?)

**Ne kontrol et:** Cevapta **updated** ve check-flight-status **Logs** içeriği.

- **updated = 0** ve **processed > 0:** En az bir uçuş var ama FR24 hiçbirini güncellemedi.
- **Log’da şunu ara:** `[check-flight-status] no FR24 data`  
  Yanında `flight_number`, `flight_date`, `flightId` görünür. Bu uçuşlar FR24’te bulunamadı (tarih aralığı, uçuş numarası formatı veya FR24’te o uçuş yok).

**Veritabanı:**  
Supabase → Table Editor → **flights**. İlgili uçuşun **flight_number** (örn. PC2794, TK1234) ve **flight_date** değerlerini not al. Cron `flight_date`’e göre dün/bugün/yarın aralığında sorguluyor; tarih yanlışsa eşleşmez.

**Özet:** Otomatik statü değişmiyorsa büyük ihtimalle FR24 bu uçuşlar için veri dönmüyor. Log’daki “no FR24 data” satırları hangi uçuşlar için olduğunu gösterir.

---

## Adım 4: notify-family çağrılıyor mu ve kabul ediliyor mu?

**Ne kontrol et:** Cevapta **tookOffSent** / **landedSent** ve check-flight-status **Logs**.

- **tookOffSent = 0, landedSent = 0:** Cron FR24’ten `en_route` veya `landed` almıyor (yine FR24 verisi) **veya** notify-family’yi çağırıyor ama cevap 200 değil.
- **Log’da ara:**  
  `[check-flight-status] notify-family took_off failed`  
  `[check-flight-status] notify-family landed failed`  
  Yanında **status** (401, 404, 500) ve **body** olur. 401 ise notify-family **CRON_SECRET** reddediyor demektir.

**notify-family tarafı:**  
Supabase → Edge Functions → **notify-family** → Logs.

- **“Cron request rejected: CRON_SECRET missing or mismatch”:**  
  notify-family’nin **Secrets**’ında **CRON_SECRET** yok veya check-flight-status / cron-job’daki `x-cron-secret` ile aynı değil. Aynı değeri koy.
- **404 Flight not found / Crew not found:** flightId veya crew ilişkisi hatalı (nadir).

---

## Adım 5: Aile kullanıcısına bildirim gidiyor mu? (sent: 0 neden?)

notify-family başarıyla çalışıp **200** dönse bile **sent: 0** olabilir. Bunun nedenleri:

**5a) Onaylı bağlantı yok**  
notify-family, uçuşun **crew_id**’sine göre **family_connections** tablosunda `status = 'approved'` kayıt arar. Yoksa bildirim gönderilmez, cevap `{ ok: true, sent: 0 }`.

**Kontrol:**  
Supabase → Table Editor → **family_connections**.  
İlgili crew ile family eşleşmesi var mı, **status** = `approved` mı?

**5b) Aile kullanıcısında cihaz token’ı yok**  
Bildirim alacak kullanıcılar **allowed2** içinde olsa bile, **device_tokens** tablosunda o **user_id** için kayıt yoksa Expo’ya gönderilecek token olmaz, **sent: 0**.

**Kontrol:**  
Supabase → Table Editor → **device_tokens**.  
Aile kullanıcısının **user_id**’si ile en az bir **token** satırı var mı? (Aile uygulamada giriş yapıp bildirim izni vermiş olmalı; token uygulama tarafından yazılır.)

**5c) Tercih kapalı**  
**notification_preferences** tablosunda ilgili connection için **took_off** veya **landed** false ise o kullanıcıya gönderilmez.

**5d) Zaten gönderildi (duplicate)**  
**notification_log**’da bu flight_id + type (took_off/landed) için kayıt varsa tekrar gönderilmez; cevap `{ ok: true, sent: 0, duplicate: true }`.

**Log:** notify-family Logs’ta artık **sent: 0** olduğunda nedenini gösteren bir satır aranabilir (örn. “no approved connections” veya “no device tokens for family users”).

---

## Hızlı kontrol listesi (özet)

| Sorun | Nereye bak | Ne yap |
|--------|------------|--------|
| Cron hiç çalışmıyor | cron-job.org + check-flight-status Logs | Job aktif mi, 200 dönüyor mu, 401 ise x-cron-secret |
| Statü otomatik güncellenmiyor | Cevap: processed/updated. Log: "no FR24 data" | FR24’te uçuş var mı, flight_number/flight_date doğru mu |
| Bildirim hiç gitmiyor | check-flight-status Logs: "notify-family ... failed" | 401 → notify-family CRON_SECRET aynı olsun |
| notify-family 200 ama sent: 0 | family_connections (approved), device_tokens | Aile onaylı bağlantı + aile cihazda token kayıtlı mı |

---

## Elle test (isteğe bağlı)

1. **check-flight-status-and-notify’ı elle tetikle**  
   curl veya Postman:  
   `POST https://<project-ref>.supabase.co/functions/v1/check-flight-status-and-notify`  
   Header: `x-cron-secret: <CRON_SECRET>`  
   Cevap gövdesindeki `processed`, `updated`, `tookOffSent`, `landedSent` değerlerini not al.

2. **notify-family’yi tek uçuş için elle dene**  
   `POST https://<project-ref>.supabase.co/functions/v1/notify-family`  
   Header: `x-cron-secret: <CRON_SECRET>`, `Content-Type: application/json`  
   Body: `{ "type": "landed", "flightId": "<gerçek bir flight uuid>" }`  
   Cevap: `sent: 0` mı, `sent: 1` (veya daha fazla) mı? Logs’ta “Cron request rejected” veya hata var mı?

Bu adımlarla hem otomatik güncellemenin hem bildirimin nerede koptuğunu loglardan ve tablolardan takip edebilirsin.
