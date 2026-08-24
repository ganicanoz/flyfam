# Feature backlog (deferred)

Parked product ideas — not scheduled. Revisit when core subscription + roster stability are settled.

## Pegasus salary / pay estimate (crew)

**Intent:** Show estimated flight pay for Pegasus (PC) crew from roster block times + user-entered rates.

**Why deferred (Aug 2026):** Needs locked product rules (official vs user-entered rates), strong “not payroll” disclaimer, and subscription/roster UX is higher priority.

**Do not implement until scoped.**

## Crew ↔ Crew roster sharing (“crew arkadaş”)

**Intent:** Two crew accounts can share rosters with each other (not crew→family only).

**Why deferred:** Needs a clear peer relationship model (separate from `family_connections`), RLS for mutual/one-way read of flights, invite UX, and billing/slot policy (peer free vs family-slot).

**Open product decisions (as of Aug 2026):**

1. Share direction: mutual by default vs one-way vs per-link choice.
2. Billing: free peer list with a cap vs consume family add-on slots.

**Likely technical shape (when resumed):**

- New table e.g. `crew_peer_links` (`crew_a_id`, `crew_b_id`, `status`, share flags) — do **not** overload `family_connections.family_id` with crew user ids.
- Invite by email/code among `role=crew` profiles.
- Extend flights/roster RLS so an approved peer can `SELECT` the other crew’s flights (same read path family uses, different join).
- UI: Friends / Crew mates list on Family or a dedicated tab; roster picker “whose schedule”.

**Do not implement until decisions above are locked.**
