# Push Notifications (Family)

Family users receive push notifications for their connected crew’s flights.

**→ For a detailed, step-by-step setup of the last 5 to-dos (migration, deploy, CRON_SECRET, cron job, EAS project ID), see [PUSH_SETUP_STEP_BY_STEP.md](./PUSH_SETUP_STEP_BY_STEP.md).**

## Types

1. **Today's flights** – “Gani has 3 legs today. His duty will start at 10:00.”
2. **Departure** – “Gani has departed from İstanbul.”
3. **Landing** – “Gani has landed to Frankfurt.”

## Setup

### Mobile (family)

- **expo-notifications** and **expo-device** are used.
- When a **family** user is signed in, the app requests notification permission, gets an Expo push token, and upserts it into `device_tokens`.
- For EAS Build, set `EXPO_PUBLIC_EAS_PROJECT_ID` in your env (or `extra.eas.projectId` in app.config) so push tokens are valid.

### Backend

- **Supabase Edge Function** `notify-family` sends notifications via the Expo Push API.
- **Crew’s only job:** add flights and tap **Send flights to my family**. Crew does not open the app for updates; detection and notifications run in the background.
- **Depart / land** are detected **automatically** in the background:
  - **check-flight-status-and-notify** Edge Function is called either by an **external cron** (e.g. every **5 min**, for API cost; or 2–3 min if preferred) with header `x-cron-secret`, or by the **app in background** (when the OS runs the app’s background fetch task) with the user’s JWT. It fetches FR24, updates the DB, and sends took_off/landed to family via notify-family.
- **Today's flights** is sent when crew taps **Send flights to my family** on Roster. Optional: cron can send it daily with x-cron-secret.

## Optional: Daily digest cron

Run once per day (e.g. 06:00 in the crew’s timezone or UTC). The function finds all crews that have at least one flight on that date and sends one “today’s legs” notification per crew to their approved family connections.

1. In Supabase Dashboard → Edge Functions → notify-family → Secrets, set **CRON_SECRET** to a random string.
2. Schedule an HTTP request:

   **URL:** `https://<project-ref>.supabase.co/functions/v1/notify-family`  
   **Method:** POST  
   **Headers:**
   - `Content-Type: application/json`
   - `x-cron-secret: <your CRON_SECRET>`
   **Body:**
   ```json
   { "type": "today_flights", "cron": true }
   ```

3. Use a cron service (e.g. cron-job.org, GitHub Actions, or Supabase pg_cron + `net.http_post` if available) to call this once per day.

## Automatic depart/land detection (no crew action)

So that family gets “took off” and “landed” without the crew opening the app:

1. **External cron (required):** Call **check-flight-status-and-notify** every **5 minutes** (or 2–3 min; 5 min reduces API cost):
   - **URL:** `https://<project-ref>.supabase.co/functions/v1/check-flight-status-and-notify`
   - **Method:** POST  
   - **Headers:** `Content-Type: application/json`, `x-cron-secret: <CRON_SECRET>`
   - Use cron-job.org, GitHub Actions, or pg_cron (Supabase Pro) with this URL and secret.
2. **App background (fallback):** The app registers a background fetch task. When the OS runs it (e.g. when the app is in background), the app calls the same Edge Function with the user’s JWT. Rate limit: once per 2 minutes when triggered by JWT.

Crew only adds flights and sends to family; the cron does detection and notifications in the background.

## API (Edge Function)

- **POST** with JWT (crew):
  - `{ "type": "today_flights", "crewId": "<uuid>", "date": "YYYY-MM-DD" }` – crew sends today's flights to family (button "Send flights to my family")
  - `{ "type": "took_off", "flightId": "<uuid>" }`
  - `{ "type": "landed", "flightId": "<uuid>" }`
- **POST** with header `x-cron-secret: <CRON_SECRET>` (optional):
  - `{ "type": "today_flights", "cron": true }` – all crews with flights today (for scheduled cron)

## Preferences

Family users can control notifications per connection in **notification_preferences** (today_flights, took_off, landed, etc.). Default is enabled. The UI for these preferences can be added in the family dashboard or profile.

## Otomatik bildirim (Kalktı/İndi) gitmiyorsa

1. **notify-family için CRON_SECRET**  
   Cron, `check-flight-status-and-notify` çalıştıktan sonra **notify-family**'yi `x-cron-secret` header'ı ile çağırır. **notify-family** bu isteği kabul etmek için kendi secret'ında **CRON_SECRET** tanımlı olmalı ve **check-flight-status-and-notify** ile aynı değerde olmalı.  
   - Supabase Dashboard → Edge Functions → **notify-family** → **Secrets**  
   - `CRON_SECRET` ekle veya güncelle; değeri **check-flight-status-and-notify** ile aynı olsun (cron-job.org’daki `x-cron-secret` ile aynı).
   - notify-family Logs’ta "Cron request rejected: CRON_SECRET missing or mismatch" görüyorsan bu secret eksik/yanlış demektir.

2. **Aile kullanıcısının push token’ı**  
   Aile hesabı giriş yaptıktan sonra uygulama Expo push token’ı alıp `device_tokens` tablosuna yazmalı. Token yoksa bildirim gönderilmez.  
   - Supabase → Table Editor → **device_tokens** → aile kullanıcısının `user_id`’si ile kayıt var mı kontrol et.

3. **Bağlantı onaylı mı?**  
   **family_connections** tablosunda ilgili crew–family satırında `status = 'approved'` olmalı.

4. **Cron gerçekten tetikliyor mu?**  
   check-flight-status-and-notify için Supabase Logs’ta 200 dönüyor mu bak. Yanıtta `processed`, `updated`, `tookOffSent`, `landedSent` değerlerine bak.  
   - **Otomatik statü değişmiyorsa:** `processed > 0` ama `updated = 0` ise FR24 bu uçuşlar için veri dönmüyor olabilir. Logs’ta "no FR24 data" + flight_number/flight_date satırları varsa o uçuşlar FR24’te bulunamıyor (tarih aralığı veya uçuş numarası formatı).  
   - **Bildirim gitmiyorsa:** check-flight-status Logs’ta "notify-family took_off failed" veya "notify-family landed failed" + status/body varsa notify-family 401/500 dönüyor demektir; önce CRON_SECRET’ı notify-family’de kontrol et, sonra notify-family Logs’a bak.

5. **Detaylı cron kurulumu**  
   Bkz. [CRON_CHECK.md](./CRON_CHECK.md).
