# “İndi” / “Kalktı” bildirimleri gelmiyor — kontrol listesi

“Uçuşları aileme gönder” ile bildirim gidiyor; otomatik **kalktı (took_off)** ve **indi (landed)** bildirimleri gelmiyorsa aşağıdakileri kontrol et.

---

## 0. Hızlı kontrol: "Uçuşları aileme gönder" geliyor, "Kalktı/İndi" otomatik gelmiyor

Push çalışıyor (token, FCM/APNs tamam). Sorun **cron → statü güncellemesi → notify-family** zincirinde. Sırayla şunları yap:

### Adım 1: Cron’u elle tetikle, cevaba bak

```bash
curl -s -X POST "https://slmgmcpluanezvkgkozw.supabase.co/functions/v1/check-flight-status-and-notify" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: BURAYA_CRON_SECRET"
```

- **200** ve body’de `processed: N` (N > 0) → Cron çalışıyor, uçuş listesi alınıyor.
- **200** ama `processed: 0` → O anda DB’de dün/bugün/yarın (UTC) flight_date’li uçuş yok; crew uçuş ekleyip tekrar dene.
- **401** → CRON_SECRET yanlış (check-flight-status-and-notify secret’ı).

### Adım 2: check-flight-status-and-notify logları

Supabase → **Edge Functions** → **check-flight-status-and-notify** → **Logs**. Son 10–15 dakikaya bak (cron-job 5 dk’da bir çalışıyorsa birkaç kayıt olmalı).

| Logda gördüğün | Anlamı |
|----------------|--------|
| `AVIATION_EDGE_API_KEY not set` | **AVIATION_EDGE_API_KEY** secret’ı ekle (FR24 402/boş olduğunda AE ile statü alınır). |
| `no FR24 and no AE timetable` + flight_number | O uçuş için ne FR24 ne AE veri döndü; statü güncellenmez, bildirim tetiklenmez. |
| `FR24 yok/402 → AE timetable` + `status: "en_route"` veya `"landed"` | Statü alındı. Hemen sonra `notify-family took_off ok` / `landed ok` veya `failed 401` ara. |
| `notify-family took_off failed 401` veya `landed failed 401` | **notify-family** CRON_SECRET’ı check-flight-status’teki ile **aynı** değil; notify-family → Secrets’ta CRON_SECRET’ı düzelt. |
| `notify-family took_off ok` / `landed ok` | Bildirim isteği gönderildi; cihaza gitmemesi FCM/APNs veya token tarafında (nadir; “uçuşları aileme gönder” geliyorsa token doğru). |

### Adım 3: notify-family logları

Aynı zaman diliminde **notify-family** → **Logs**. `took_off from cron` veya `landed from cron` ve `sent N` var mı bak. **401** varsa notify-family’de CRON_SECRET eksik/yanlış.

### Adım 4: Veritabanı (isteğe bağlı)

- **notification_preferences:** Aile kullanıcısı için ilgili connection’da `took_off` ve `landed` **true** olmalı (varsayılan true).
- **flights:** Test ettiğin uçuşun **flight_date**’i cron’un baktığı aralıkta olmalı (dün/bugün/yarın UTC). Crew farklı timezone’daysa “bugün” uçuşu UTC’de dün/yarın sayılabilir; cron zaten dün/bugün/yarın alıyor.

**Özet:** Çoğu durumda ya **AVIATION_EDGE_API_KEY** eksik (FR24 402’de statü hiç güncellenmez) ya da **notify-family** içinde **CRON_SECRET** yok/yanlış (401, bildirim çağrısı reddedilir). İkisini de kontrol et.

---

## 1. Supabase Edge Function secrets

### check-flight-status-and-notify

- **CRON_SECRET** — cron-job.org’da kullandığın `x-cron-secret` ile **aynı** değer olmalı.
- **FR24_API_TOKEN** — FR24 API token (402 alıyorsan yine de cron çalışır; aşağıdaki AE key gerekir).
- **AVIATION_EDGE_API_KEY** — **Mutlaka set et.** FR24 402 veya veri dönmediğinde statü AE timetable’dan alınır. Bu key yoksa “kalktı/indi” için statü hiç güncellenmez ve notify-family çağrılmaz.  
  (İstersen `EXPO_PUBLIC_AVIATION_EDGE_API_KEY` da kullanılır.)

### notify-family

- **CRON_SECRET** — check-flight-status-and-notify ile **birebir aynı** değer. Cron bu header ile çağırıyor; uyuşmazsa 401 alır ve bildirim gitmez.

---

## 2. Loglardan ne anlarsın?

Cron çalıştıktan sonra Supabase Dashboard → Edge Functions → **check-flight-status-and-notify** ve **notify-family** loglarına bak.

- **`AVIATION_EDGE_API_KEY not set`**  
  → Key ekle; FR24 402’de AE fallback çalışmaz, statü değişmez, bildirim tetiklenmez.

- **`FR24 yok/402 → AE timetable`** + `status: en_route` veya `landed`  
  → Statü doğru alınıyor. Hemen sonra **notify-family** logunda şunu ara:
  - **`took_off from cron`** / **`landed from cron`** + **`sent N`**  
    → Bildirim gönderildi; cihaz/token/FCM tarafına bak.
  - **`took_off from cron`** yok, **notify-family**’de 401  
    → CRON_SECRET uyuşmuyor (notify-family secret’ını kontrol et).
  - **`skipped duplicate`**  
    → Bu uçuş için bu tip bildirim daha önce gönderilmiş (normal).

- **`no FR24 and no AE timetable`**  
  → FR24 veri vermedi, AE de bulamadı (key eksik veya uçuş AE’de yok). Statü güncellenmez, bildirim tetiklenmez.

- **`notify-family took_off failed 401`** (check-flight-status logunda)  
  → notify-family CRON_SECRET’ı yanlış/eksik.

---

## 3. Veritabanı

- **notification_preferences** — İlgili aile kullanıcısı için `took_off` ve `landed` sütunları `false` ise bildirim gönderilmez. Varsayılan `true`; bir yerde kapatılmış olabilir.
- **device_tokens** — “Uçuşları aileme gönder” geliyorsa aynı kullanıcının token’ı var demektir; took_off/landed de aynı tabloyu kullanır.
- **notification_log** — Aynı (flight_id, type) için kayıt varsa tekrar bildirim gönderilmez (duplicate).

---

## 4. Özet

| Sorun | Yapılacak |
|--------|------------|
| FR24 402, AE key yok | check-flight-status-and-notify’a **AVIATION_EDGE_API_KEY** ekle |
| Cron 401 alıyor | **CRON_SECRET**’ı her iki Edge Function’da aynı yap |
| Logda “sent N” var, cihazda yok | FCM/APNs, token, bildirim izinleri ve cihaz uygulama sürümü |

Bu adımlardan sonra bir cron çalışması tetikleyip (manuel veya cron-job.org) yukarıdaki log satırlarını tekrar kontrol et.

---

## 5. Belirli bir uçuş için canlı kontrol (örn. PC1251)

Uçak kalkmak üzereyken “kalktı” bildiriminin gidip gitmediğini aynı kontrollerle doğrulamak için:

### 5.1 Ön koşul

- **flights** tablosunda o uçuş (örn. PC1251) bugünün **flight_date** değeriyle kayıtlı olmalı (crew local date). Cron sadece `flight_date` dün/bugün/yarın (UTC) olan uçuşlara bakar.

### 5.2 Cron’u elle tetikle

Terminalde (CRON_SECRET değerini kendi secret’ınla değiştir):

```bash
curl -X POST "https://slmgmcpluanezvkgkozw.supabase.co/functions/v1/check-flight-status-and-notify" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: BURAYA_CRON_SECRET_YAZ"
```

- **200** ve body’de `ok: true`, `processed`, `tookOffSent`, `landedSent` gelmeli.
- **401** → `x-cron-secret` yanlış/eksik.

### 5.3 check-flight-status-and-notify loglarında ara

Supabase → Edge Functions → **check-flight-status-and-notify** → Logs. Log aramada **PC1251** (veya uçuş numarası) geçen satırlara bak:

| Gördüğün | Anlamı |
|----------|--------|
| `FR24 failed, trying AE fallback` + `flight_number: "PC1251"` + `ae_key_set: true` | AE fallback devreye girdi. |
| `FR24 yok/402 → AE timetable` + `flight_number: "PC1251"` + `status: "en_route"` | Statü en_route; aynı run’da “kalktı” tetiklenir (önceki statü en_route değilse). |
| `notify-family took_off ok` + ilgili flightId | notify-family çağrıldı ve 200 döndü. |
| `no FR24 and no AE timetable` + PC1251 | AE bu uçuş/tarih için sonuç dönmedi. |

### 5.4 notify-family loglarında ara

Aynı zaman diliminde **notify-family** → Logs. **flightId** veya **PC1251** ile ilgili:

| Gördüğün | Anlamı |
|----------|--------|
| `took_off from cron` + ilgili flightId | Cron ile “kalktı” isteği alındı. |
| `took_off sent N` | N adet cihaza push gönderildi. |
| `skipped duplicate` | Bu uçuş için “kalktı” zaten daha önce gönderilmiş. |

PC1251 (veya test ettiğin uçuş) için bu sırayla kontrol et: cron tetikle → check-flight-status loglarında PC1251 ve AE/took_off → notify-family loglarında took_off from cron + sent.

---

## 6. Android: otomatik güncelleme ve bildirim

### Otomatik güncelleme (liste)

- **Sunucu:** Cron (check-flight-status-and-notify) her 5 dk’da uçuş statüsünü (FR24 / AE) alıp **flights** tablosunu günceller.
- **Aile uygulaması (Android):** Aile kullanıcısı **Roster** ekranındayken liste **30 saniyede bir** DB’den yenilenir (`FAMILY_REFRESH_INTERVAL_MS = 30_000`). Yani cron DB’yi güncelledikten sonra en geç 30 sn içinde ekranda güncel statü (kalktı / indi vb.) görünür.
- **Crew:** Roster’da kendi uçuşları için 2 dk’da bir API ile canlı güncelleme yapılır (GS/ALT vb.).

### Bildirim (Android)

- **Token kaydı:** Aile kullanıcısı giriş yaptığında **SessionContext** `registerPushTokenForFamilyUser` ile token alınıp **device_tokens** tablosuna yazılır. **Family** sekmesine her gelişte token tekrar kaydedilir (Android’de bildirim izni sonradan verilirse diye).
- **Android kanalı:** `expo-notifications` ile **default** kanalı **HIGH** importance ile ayarlanıyor; **AndroidManifest.xml**’de `default_notification_channel_id = "default"` — bildirimler bu kanalda gelir.
- **FCM:** EAS build’de **google-services.json** kullanılıyor; Expo Push Android’de FCM üzerinden gönderir.

### Kontrol listesi (Android)

| Kontrol | Nasıl |
|--------|--------|
| Liste otomatik güncelleniyor mu? | Aile hesabıyla Android’de giriş yap → Roster’a gir → Uçuş statüsü değişince (cron çalıştıktan sonra) en geç ~30 sn içinde ekranda güncel statü görünmeli. |
| “Kalktı” / “indi” bildirimi geliyor mu? | Cron tetiklenince (ve statü en_route/landed olunca) notify-family push atar. Android’de bildirim izni verilmiş ve token kayıtlı olmalı. |
| Token kayıtlı mı? | Aile kullanıcısı Family sekmesine girince token yeniden kaydedilir. Supabase **device_tokens** tablosunda bu user_id için satır olmalı. |
| Bildirim gelmiyor ama log “sent N”? | FCM / cihaz tarafı: batarya optimizasyonu, “Do not disturb”, uygulama bildirim ayarlarında FlyFam açık mı kontrol et. |

Özet: Android’de hem otomatik liste güncellemesi (30 sn) hem de “kalktı/indi” push’u aynı mimariyle çalışır; cron ve CRON_SECRET doğruysa sunucu tarafı tamam, sorun çoğunlukla token kaydı veya cihaz bildirim ayarlarından kaynaklanır.

---

## 7. Expo Go'da bildirim geliyor, build'de (APK/AAB) gelmiyor (Android)

**Neden:** Expo Go, Expo'nun kendi FCM projesini kullanır; push Expo sunucuları üzerinden gelir. Kendi build'iniz ise **sizin** Firebase projenizle (`google-services.json`) FCM'e kayıt olur. Expo'nun bu build'e push **gönderebilmesi** için EAS tarafında **FCM V1 credential** (Google Service Account anahtarı) tanımlı olmalı. Tanımlı değilse Expo "sent" deseniz bile cihaza iletemez.

**Yapılacaklar:**

1. **Firebase Console** → Projeniz → **Project settings** (dişli) → **Service accounts**.
2. **Generate new private key** → JSON dosyası iner (güvenli saklayın; repoya eklemeyin).
3. **EAS'a FCM credential yükleyin:**
   - **Yöntem A (CLI):** `mobile/` içinde `eas credentials` çalıştırın → **Android** → **production** (veya preview) → **Google Service Account** → **Set up a Google Service Account Key for Push Notifications (FCM V1)** → **Upload a new service account key** → indirdiğiniz JSON dosyasını seçin.
   - **Yöntem B (Dashboard):** [expo.dev](https://expo.dev) → projeniz → **Credentials** → **Android** → ilgili profil → **FCM** / **Google Service Account** → JSON yükleyin.
4. **google-services.json:** `app.config.js` içinde `googleServicesFile: './google-services.json'` ve EAS build'de `GOOGLE_SERVICES_JSON` secret'ı **aynı Firebase projesinden** olmalı (Service account ile aynı proje).
5. **Yeni bir Android build** alıp test edin. Build'de aile hesabıyla giriş yapıp Family sekmesine girince token kaydedilir; ardından "Kalktı/İndi" bildirimi gelmeli.

**Kontrol:** notify-family logunda "sent N" görüyorsanız ama cihazda bildirim yoksa büyük ihtimalle EAS'ta FCM V1 credential eksik veya yanlış projeden.

---

## 8. iOS'ta (iPhone) otomatik bildirim gelmiyor

**Neden:** Android'de FCM credential'ı EAS'ta tanımlı olmalı; iOS'ta ise **Apple Push Notifications (APNs) key** tanımlı olmalı. Expo Push Service, iOS cihazlara APNs üzerinden gönderir; EAS'ta APNs key yoksa veya yanlış bundle ID ile eşleşmiyorsa bildirim cihaza ulaşmaz.

**Yapılacaklar:**

1. **Apple Developer hesabı** gerekli ([developer.apple.com](https://developer.apple.com)).
2. **APNs key'i EAS'a ekleyin:**
   - **Yöntem A (CLI):** `mobile/` içinde `eas credentials` çalıştırın → **iOS** → **production** (veya preview) → **Push Notifications: Manage your Apple Push Notifications Key** → **Set up a new key** (veya mevcut .p8 yükle). EAS, Apple Developer hesabınıza bağlanıp key oluşturabilir veya siz [Apple Developer → Keys](https://developer.apple.com/account/resources/authkeys/list) bölümünden "Apple Push Notifications service (APNs)" yetkili bir key oluşturup .p8 dosyasını indirip EAS'a yükleyebilirsiniz.
   - **Yöntem B (Dashboard):** [expo.dev](https://expo.dev) → projeniz → **Credentials** → **iOS** → ilgili profil → **Push Notifications** / **APNs Key** → .p8 key yükleyin (Key ID, Team ID, Bundle ID: `com.flyfam.app` ile eşleşmeli).
3. **Bundle ID:** `app.config.js` / `app.json` içinde `ios.bundleIdentifier: 'com.flyfam.app'` olmalı; APNs key bu bundle ID ile kullanılmalı.
4. **Yeni bir iOS build** alıp gerçek cihazda test edin. Aile hesabıyla giriş yapıp Family sekmesine girince token kaydedilir; "Kalktı/İndi" bildirimi gelmeli.

**Kontrol:** notify-family logunda iOS cihaz için "sent" görünüyor ama iPhone'da bildirim yoksa EAS'ta iOS APNs key eksik veya yanlış (Key ID / Team ID / Bundle ID) olabilir.
