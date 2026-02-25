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
- **Depart / land** are triggered from the **crew** app when the crew taps **Update** and the flight API returns status `en_route` or `landed`. The function is called with the crew’s JWT.
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

## API (Edge Function)

- **POST** with JWT (crew):
  - `{ "type": "today_flights", "crewId": "<uuid>", "date": "YYYY-MM-DD" }` – crew sends today's flights to family (button "Send flights to my family")
  - `{ "type": "took_off", "flightId": "<uuid>" }`
  - `{ "type": "landed", "flightId": "<uuid>" }`
- **POST** with header `x-cron-secret: <CRON_SECRET>` (optional):
  - `{ "type": "today_flights", "cron": true }` – all crews with flights today (for scheduled cron)

## Preferences

Family users can control notifications per connection in **notification_preferences** (today_flights, took_off, landed, etc.). Default is enabled. The UI for these preferences can be added in the family dashboard or profile.
