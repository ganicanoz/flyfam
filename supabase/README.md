# FlyFam — Supabase Setup

## Option 1: Hosted Supabase (recommended for MVP)

### 1. Create project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project URL** and **anon key** (Settings → API)

### 2. Run migrations

**Option A: Supabase Dashboard**

1. Open **SQL Editor** in your Supabase project
2. Run each migration file in order (by filename):

   - `20250214100000_create_profiles.sql`
   - `20250214100001_create_crew_profiles.sql`
   - `20250214100002_create_flights.sql`
   - `20250214100003_create_family_connections.sql`
   - `20250214100004_create_invite_codes.sql`
   - `20250214100005_create_notification_preferences.sql`
   - `20250214100006_create_device_tokens.sql`
   - `20250214100007_create_notification_log.sql`
   - `20250214100008_create_rls_policies.sql`
   - `20250214100009_create_functions.sql`

**Option B: Supabase CLI**

```bash
# Install Supabase CLI
npm install -g supabase

# Login and link project
supabase login
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### 3. Configure auth

- **Auth → URL Configuration**: Add your app redirect URLs (e.g. `exp://localhost:8081` for Expo)
- **Auth → Providers**: Enable Email (and any OAuth providers you need)

### 4. Environment variables

Copy `.env.example` to `.env` and add:

- `EXPO_PUBLIC_SUPABASE_URL` — Project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — anon/public key

---

## Option 2: Local development

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase
supabase start

# Run migrations
supabase db reset
```

Use the local URLs from `supabase status` in your `.env`.

---

## Post-signup flow

After a user signs up with Supabase Auth, the app must:

1. Call `create_profile(role, full_name, phone)` with `role` = `'crew'` or `'family'`
2. If crew: call `create_crew_profile(company_name, time_preference)` to complete onboarding

---

## RPCs

| Function | Purpose |
|----------|---------|
| `create_profile(role, full_name, phone)` | Create profile after signup |
| `create_crew_profile(company_name, time_preference)` | Crew onboarding |
| `generate_invite_code(expires_hours?)` | Crew generates code for family |
| `redeem_invite_code(code)` | Family redeems code → pending connection |
| `approve_connection(connection_id)` | Crew approves family |
