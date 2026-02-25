# FlyFam — Data Model

Data model for the MVP, designed for **Supabase** (PostgreSQL).

---

## Entity Relationship Overview

```
auth.users (Supabase)
      │
      ▼
  profiles ────────────────┬──────────────────────┐
      │                    │                      │
      ├── crew_profiles    │                      │
      │       │            │                      │
      │       └── flights  │                      │
      │                    │                      │
      └── family_connections (crew ←→ family)     │
                    │                             │
                    ├── notification_preferences  │
                    │                             │
                    └── device_tokens ────────────┘
                    
  invite_codes (crew → family)
  notification_log (sent pushes, for idempotency)
```

---

## Tables

### 1. profiles

Extends Supabase `auth.users` with app-specific data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, FK → auth.users.id | Same as auth user id |
| role | text | NOT NULL, CHECK IN ('crew', 'family') | User type |
| full_name | text | | Display name |
| phone | text | | Optional phone |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

**Triggers**: `updated_at` on update.

**RLS**: Users can read/update their own row. Create on signup (trigger or app logic).

---

### 2. crew_profiles

Crew-specific settings. One row per crew user.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| user_id | uuid | NOT NULL, UNIQUE, FK → profiles.id | |
| company_name | text | | Airline name (e.g. "Pegasus Airlines") |
| time_preference | text | DEFAULT 'local', CHECK IN ('local', 'utc') | Local or UTC display |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

**Notes**: `profiles.role` must be `'crew'` for `user_id`. v2: add `company_id` FK to a `companies` table for roster URL mapping.

---

### 3. flights

Roster entries. MVP: manual entry only.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| crew_id | uuid | NOT NULL, FK → crew_profiles.id | |
| flight_number | text | NOT NULL | e.g. PC1234, TK1823 |
| origin_airport | text | | IATA code (e.g. IST) |
| destination_airport | text | | IATA code (e.g. SAW) |
| flight_date | date | NOT NULL | Date of operation |
| scheduled_departure | timestamptz | | Scheduled dep time |
| scheduled_arrival | timestamptz | | Scheduled arr time |
| source | text | DEFAULT 'manual', CHECK IN ('manual', 'synced') | manual for MVP |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

**Indexes**: `(crew_id, flight_date)`, `(flight_date, flight_number)` for queries and flight status lookup.

**RLS**: Crew can CRUD own flights. Family sees via connection + crew_id.

---

### 4. family_connections

Links crew and family. Family must be approved by crew.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| crew_id | uuid | NOT NULL, FK → crew_profiles.id | |
| family_id | uuid | NOT NULL, FK → profiles.id | |
| status | text | NOT NULL, CHECK IN ('pending', 'approved', 'declined') | |
| invited_by | uuid | FK → profiles.id | Crew who invited (if via code) |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

**Unique**: `(crew_id, family_id)` — one connection per crew–family pair.

**RLS**: Crew sees/updates connections where they are crew. Family sees connections where they are family (read-only on status until approved).

---

### 5. invite_codes

Codes crew shares for family to connect. Optional but useful.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| crew_id | uuid | NOT NULL, FK → crew_profiles.id | |
| code | text | NOT NULL, UNIQUE | e.g. FLYF-XXXX-XXXX |
| expires_at | timestamptz | | Optional expiry |
| used_at | timestamptz | | When family used it |
| used_by | uuid | FK → profiles.id | Family who used it |
| created_at | timestamptz | DEFAULT now() | |

**Index**: `(code)` for fast lookup.

---

### 6. notification_preferences

Per family user, per crew connection. Controls which push types are enabled.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| user_id | uuid | NOT NULL, FK → profiles.id | Family user |
| connection_id | uuid | NOT NULL, FK → family_connections.id | |
| today_flights | boolean | DEFAULT true | |
| took_off | boolean | DEFAULT true | |
| landed | boolean | DEFAULT true | |
| delayed | boolean | DEFAULT true | |
| diverted | boolean | DEFAULT true | |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

**Unique**: `(user_id, connection_id)` — one row per family–connection.

---

### 7. device_tokens

Expo/FCM push tokens for family devices.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| user_id | uuid | NOT NULL, FK → profiles.id | |
| token | text | NOT NULL | Expo push token |
| platform | text | CHECK IN ('ios', 'android') | |
| created_at | timestamptz | DEFAULT now() | |
| last_used_at | timestamptz | | Refresh on app open |

**Unique**: `(user_id, token)` — avoid duplicates when re-registering same device.

---

### 8. notification_log

Tracks sent notifications to avoid duplicates and for analytics.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| user_id | uuid | NOT NULL, FK → profiles.id | Family who received |
| flight_id | uuid | NOT NULL, FK → flights.id | |
| type | text | NOT NULL, CHECK IN ('today_flights', 'took_off', 'landed', 'delayed', 'diverted') | |
| sent_at | timestamptz | DEFAULT now() | |

**Use**: Before sending "took_off" for flight X to user Y, check if row exists. If yes, skip.

---

## Flight status (runtime, not stored)

Live status comes from Aviation Stack API. We query by `flight_number` + `flight_date` when:

- Family views "on duty" flight
- Background job checks for status changes (departed, landed, delayed, diverted) to trigger push

Optional cache table for performance:

### flight_status_cache (optional)

| Column | Type | Description |
|--------|------|-------------|
| flight_id | uuid | FK → flights |
| status | text | scheduled, departed, en_route, landed, delayed, diverted |
| estimated_departure | timestamptz | |
| estimated_arrival | timestamptz | |
| actual_departure | timestamptz | |
| actual_arrival | timestamptz | |
| delay_minutes | int | |
| diverted_to | text | IATA if diverted |
| fetched_at | timestamptz | |

Update from Aviation Stack every 5–15 min for "today" flights.

---

## Row Level Security (RLS) Summary

| Table | Crew | Family |
|-------|------|--------|
| profiles | CRUD own | CRUD own |
| crew_profiles | CRUD own | — |
| flights | CRUD own | Read via approved connection |
| family_connections | CRUD where crew_id = self | Read where family_id = self |
| invite_codes | CRUD own | Read by code (public lookup) |
| notification_preferences | — | CRUD own |
| device_tokens | — | CRUD own |
| notification_log | — | Read own (or admin only) |

---

## Indexes

```sql
-- flights
CREATE INDEX idx_flights_crew_date ON flights(crew_id, flight_date);
CREATE INDEX idx_flights_date_number ON flights(flight_date, flight_number);

-- family_connections
CREATE INDEX idx_family_connections_crew ON family_connections(crew_id);
CREATE INDEX idx_family_connections_family ON family_connections(family_id);
CREATE INDEX idx_family_connections_status ON family_connections(status) WHERE status = 'approved';

-- invite_codes
CREATE UNIQUE INDEX idx_invite_codes_code ON invite_codes(code) WHERE used_at IS NULL;

-- notification_log
CREATE INDEX idx_notification_log_flight_type ON notification_log(flight_id, type);
CREATE INDEX idx_notification_log_user ON notification_log(user_id);
```

---

## Migrations

Supabase migrations go in `supabase/migrations/`. Suggested order:

1. `001_profiles.sql`
2. `002_crew_profiles.sql`
3. `003_flights.sql`
4. `004_family_connections.sql`
5. `005_invite_codes.sql`
6. `006_notification_preferences.sql`
7. `007_device_tokens.sql`
8. `008_notification_log.sql`
9. `009_indexes.sql`
10. `010_rls_policies.sql`

---

## Next Steps

1. Create Supabase project and run migrations
2. Add `profiles` trigger on `auth.users` insert (create profile with role from metadata)
3. Implement API/Edge Functions for invite code generation, connection approval, flight CRUD
4. Implement notification job (cron) that polls Aviation Stack and sends pushes via Expo
