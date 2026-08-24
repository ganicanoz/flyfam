# FlyFam Store Subscription Matrix (tiered packages)

## Business Model

- **Auto-renewable subscription packages** (monthly + yearly per tier).
- Capacity is **only** from the plan: you + N family (N = 1…7).
- **No consumable family add-on** (`03` / EFU discontinued for sale).

## Packages & list prices

| Level | Plan code | TR display | EN display | Seats | Monthly USD | Monthly TRY | Yearly USD | Yearly TRY | iOS monthly ID | iOS yearly ID |
|------:|-----------|------------|------------|------:|------------:|------------:|-----------:|-----------:|----------------|---------------|
| 1 | `duo` | Çift Paketi | Couple | 1 | $1.49 | ₺99,99 | $14.99 | ₺999,99 | `flyfam.duo.monthly` | `flyfam.duo.yearly` |
| 2 | `trio` | Küçük Aile Paketi | Trio | 2 | $1.99 | ₺129,99 | $19.99 | ₺1.299,99 | `flyfam.trio.monthly` | `flyfam.trio.yearly` |
| 3 | `family` | Aile Paketi | Family | 3 | $2.49 | ₺149,99 | $24.99 | ₺1.499,99 | `flyfam.family.monthly` | `flyfam.family.yearly` |
| 4 | `family_plus` | Büyük Aile Paketi | Family Plus | 4 | $2.99 | ₺179,99 | $29.99 | ₺1.799,99 | `flyfam.family_plus.monthly` | `flyfam.family_plus.yearly` |
| 5 | `extended` | Geniş Aile Paketi | Extended Family | 5 | $3.49 | ₺199,99 | $34.99 | ₺1.999,99 | `flyfam.extended.monthly` | `flyfam.extended.yearly` |
| 6 | `clan` | Sülale Paketi | Clan | 6 | $3.99 | ₺229,99 | $39.99 | ₺2.299,99 | `flyfam.clan.monthly` | `flyfam.clan.yearly` |
| 7 | `circle` | Geniş Sülale Paketi | Circle | 7 | $4.49 | ₺249,99 | $44.99 | ₺2.499,99 | `flyfam.circle.monthly` | `flyfam.circle.yearly` |

Legacy aliases (backend still accepts):

- `01` → Duo / Couple monthly
- `02` → Duo / Couple yearly
- Plan code `couple` migrated → `duo`

## App Store

- **One subscription group:** `flyfam_base`
- Rank levels 1→7 (Couple lowest, Circle highest) so users can upgrade/downgrade inside the group.
- Set US + Turkey prices from the table (Apple may snap to nearest price tier).
- Remove or stop selling Consumable IAP `03` (`flyfam_extra_user_slot`).

## Supabase

| Field | Meaning |
|---|---|
| `app_subscription_plans.max_family_members` | Family seat count for that tier |
| `app_subscription_plans.max_extra_family_members` | `0` (add-on off) |
| `crew_subscriptions.plan_code` | Active tier |
| `crew_subscriptions.extra_family_slots` | Always `0` after migrate |
| Effective capacity | `max_family_members` only |

Migration: `20260815120000_subscription_tier_packages.sql`

## UX

- Plans screen lists all seven tiers with TR/EN localized titles.
- Purchase = that tier’s monthly product (price from App Store sheet).
- Upgrade = buy higher-level subscription in the same group (Apple handles proration).
- Family invite limit = current plan seats.

## Setup checklist

See [APP_STORE_CONNECT_ABONELIK_ADDON_KURULUM_TR.html](./APP_STORE_CONNECT_ABONELIK_ADDON_KURULUM_TR.html).
