# Push notifications – step-by-step setup

Follow these five steps to finish push notification setup.

---

## Step 1: Add the `flight_status` column (Supabase)

Departure and landing notifications use the flight’s live status. The app stores this in `flights.flight_status`. You need this column in your database.

**Option A – Supabase Dashboard (simplest)**

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and select your project.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Paste this exactly:

```sql
alter table public.flights
  add column if not exists flight_status text;

comment on column public.flights.flight_status is 'Live status from API when available; otherwise app derives from scheduled times.';
```

5. Click **Run** (or press Cmd/Ctrl + Enter).
6. You should see “Success. No rows returned.” The column is added (or already existed).

**Option B – Supabase CLI**

1. Open a terminal in your project root (where `supabase/` lives).
2. Run: `supabase db push`  
   (or, if you manage migrations manually: `supabase migration up`).
3. That applies all pending migrations, including `20250216100000_flights_flight_status.sql`.

**Check:** In Dashboard → **Table Editor** → **flights**, the table should have a column **flight_status** (type: text).

---

## Step 2: Deploy the Edge Function `notify-family`

The Edge Function is the backend that sends push notifications (daily digest, departed, landed). It must be deployed to your Supabase project.

**Prerequisites**

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in:  
  `supabase login`
- Your project linked (from the repo root):  
  `supabase link --project-ref YOUR_PROJECT_REF`  
  You find **YOUR_PROJECT_REF** in Dashboard → **Project Settings** → **General** → “Reference ID”.

**Deploy**

1. Open a terminal in the **project root** (parent of `supabase/`, not inside `mobile/`).
2. Run:

```bash
supabase functions deploy notify-family
```

3. When prompted for regions, pick the one closest to your users (e.g. `eu-west-1`).
4. Wait until you see a success message with the function URL, e.g.:  
   `https://xxxxxxxxxxxx.supabase.co/functions/v1/notify-family`

**Check:** In Supabase Dashboard → **Edge Functions**, you should see **notify-family** in the list.

---

## Step 3: "Today's flights" – crew sends from the app

The daily “today’s flights” notification is triggered by an external cron job. As crew, tap **"Send flights to my family"** on Roster (below Add Flight) to send today's flights to family. Takeoff and landing notifications still go out automatically when crew taps Update. No extra setup; ensure notify-family is deployed and SUPABASE_SERVICE_ROLE_KEY is set. Optional: for automatic daily digest, set CRON_SECRET and use cron (x-cron-secret + body `{"type":"today_flights","cron":true}`); the migration no longer creates that job.

---

## Step 4: (Optional) Schedule the daily digest via cron

The “Gani has 3 legs today. His duty will start at 10:00.” message is sent once per day by calling your Edge Function with the cron secret.

**Option A: Supabase pg_cron (recommended)**  
Migration `20260214120000_cron_daily_today_flights.sql` schedules the daily call at 06:00 UTC. Enable **pg_cron** and **pg_net** in Dashboard → Database → Extensions. Add a Vault secret named `cron_secret` with the same value as `CRON_SECRET` (SQL: `select vault.create_secret('YOUR_CRON_SECRET_VALUE', 'cron_secret', 'For daily today_flights');`). Then run `supabase db push`. Check in Integrations → Cron for job **notify-family-daily-flights**.

**Option B: External cron**

**Get your function URL**

- Format: `https://<project-ref>.supabase.co/functions/v1/notify-family`
- **Project ref:** Dashboard → **Project Settings** → **General** → **Reference ID** (e.g. `abcdefghijklmnop`).
- Example URL: `https://abcdefghijklmnop.supabase.co/functions/v1/notify-family`

**Example: cron-job.org (free)**

1. Go to [cron-job.org](https://cron-job.org) and create an account (or log in).
2. Click **Create cronjob**.
3. **Title:** e.g. `FlyFam daily push`.
4. **URL:** your function URL (e.g. `https://xxxx.supabase.co/functions/v1/notify-family`).
5. **Request method:** `POST`.
6. **Request headers:** add two headers:
   - `Content-Type` = `application/json`
   - `x-cron-secret` = the **exact** value you set as `CRON_SECRET` in Step 3 (e.g. the 48-character hex string).
7. **Request body:** choose “Raw body” or “JSON” and enter:

```json
{ "type": "today_flights", "cron": true }
```

8. **Schedule:** e.g. “Every day at 06:00” (adjust to your timezone in the cron-job.org settings).
9. Save the cron job.

**Check:** After the scheduled time, family users with “today’s flights” enabled should get one notification per connected crew who has flights that day. You can also trigger it once manually from cron-job.org (“Execute now”) to test.

**Other options**

- **GitHub Actions:** workflow that runs on schedule and does a `curl -X POST ...` with the same URL, headers, and body.
- **Any other cron / scheduler** that can send an HTTP POST with the header `x-cron-secret` and the JSON body above.

---

## Step 5: Set EAS Project ID for production push (mobile)

Expo Push Notifications need a **project ID** when the app is built with EAS (Expo Application Services). Without it, push tokens may not work on real devices (iOS/Android builds).

**Get your EAS project ID**

1. In the project root, open a terminal.
2. Go to the mobile app: `cd mobile`.
3. If you haven’t already: `npx eas init` (or `eas build:configure`). This links the app to an Expo project.
4. Run: `npx eas project:info`  
   (or open [expo.dev](https://expo.dev) → your project → **Settings**).  
   Copy the **Project ID** (UUID like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

**Add it to the app**

1. Open `mobile/.env` (create from `mobile/.env.example` if needed).
2. Add or edit:

```env
EXPO_PUBLIC_EAS_PROJECT_ID=your-project-id-here
```

Replace `your-project-id-here` with the actual Project ID (e.g. `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

3. Save the file.
4. **Important:** Restart the Expo dev server (or rebuild the app) so the new env value is picked up. The app config reads this via `app.config.js` → `extra.eas.projectId`.

**When it’s needed**

- **Expo Go:** push often works without this (Expo can infer project).
- **EAS Build (development/client builds):** set `EXPO_PUBLIC_EAS_PROJECT_ID` so that the push token is tied to your Expo project and delivery works on real devices.

**Check:** After setting the variable and reinstalling/rebuilding, sign in as a **family** user, allow notifications when prompted, and confirm in Supabase **Table Editor** → **device_tokens** that a new row appears with that user’s `user_id` and a token starting with `ExponentPushToken[...]`.

---

## Quick checklist

| Step | What you did |
|------|-------------------------------|
| 1    | Ran migration / SQL so `flights.flight_status` exists |
| 2    | Deployed Edge Function: `supabase functions deploy notify-family` |
| 3    | Set secret `CRON_SECRET` for `notify-family` in Dashboard |
| 4    | Crew sends "today's flights" via **Send flights to my family** on Roster; optional: cron for automatic daily digest |
| 5    | Set `EXPO_PUBLIC_EAS_PROJECT_ID` in `mobile/.env` and restarted/rebuilt the app |

After these five steps, family users can receive daily “today’s legs” notifications and departure/landing notifications when crew tap **Update** and the API returns en_route or landed.
