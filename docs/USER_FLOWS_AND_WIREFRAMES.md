# FlyFam — User Flows & Wireframes

## Overview

FlyFam connects crew members with their family to share flight schedules. Family users receive push notifications for crew flight status: today's flights, took off, landed, delayed, and diverted. Similar to [RosterBuster](https://apps.apple.com/ca/app/rosterbuster-airline-crew-app/id1035558169), which supports 500+ airlines and automatic roster syncing from crew systems.

---

## User Types

| User Type | Description |
|-----------|-------------|
| **Crew** | Pilots, cabin crew — manage roster, authorize family connections |
| **Family** | Spouse, parent, etc. — receive flight notifications for linked crew |

---

## 1. Crew User Flows

### 1.1 Onboarding & Profile Setup

```
[Sign Up] → [Select Role: Crew] → [Create Profile]
                                         │
                                         ├── Name, Email, Phone
                                         ├── Company/Airline (dropdown or search)
                                         │   └── e.g. "Pegasus Airlines"
                                         └── [Save] → Home/Dashboard
```

**Key**: Company selection determines the roster source URL (e.g., Pegasus → [webcrew.flypgs.com](https://webcrew.flypgs.com/login)).

**Time preference** (Settings): Crew can set roster and flight times to display in **Local** or **UTC**.

---

### 1.2 Roster Ingestion — Two Ways

#### **Path A: Automated from Airline Roster Website**

```
[Dashboard] → [Sync Roster] → [Roster Sources]
                                    │
                                    └── "Pegasus WebCrew" (auto-detected from profile)
                                        │
                                        ├── First time: [Connect] → In-app browser or WebView
                                        │   └── User logs in at webcrew.flypgs.com
                                        │   └── App fetches/parses roster (OAuth, calendar URL, or secure sync)
                                        │
                                        └── Subsequent: [Sync] → Background refresh (e.g. every 3h like RosterBuster)
```

**Flow details:**
- Roster URL comes from **profile company** (airline → roster system mapping)
- First-time: crew authenticates on airline’s roster site
- App syncs roster periodically (e.g. every 3 hours)
- Reference: [RosterBuster](https://rosterbuster.zendesk.com/hc/en-us) uses similar logic with NetLine, calendar links, and airline-specific integrations

**Wireframe — Roster Sync Screen**

```
┌─────────────────────────────────────────┐
│  ← Roster                         ⋮     │
├─────────────────────────────────────────┤
│                                         │
│  Pegasus WebCrew                        │
│  webcrew.flypgs.com                     │
│  ┌─────────────────────────────────┐   │
│  │  ✓ Connected    Last: 2h ago    │   │
│  │  [Sync Now]                     │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ─── OR ───                             │
│                                         │
│  Add flights manually                   │
│  [Add Flight]                           │
│                                         │
├─────────────────────────────────────────┤
│  This month's flights (12)              │
│  ┌─────────────────────────────────┐   │
│  │ Feb 14  PC1234  IST→SAW 08:30   │   │
│  │ Feb 15  PC5678  SAW→IST 14:20   │   │
│  │ ...                             │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

### 1.2.1 Crew Roster View — Basic Format

Crew users see their roster in a **simple, basic format**. Each flight row includes:

**Time display**: Crew can choose to view all times in **local time** (departure/arrival airports) or **UTC**.

| Field | Description |
|-------|-------------|
| **Flight number** | e.g. PC1234, TK1823 |
| **Departure city** | Origin airport/city |
| **Landing city** | Destination airport/city |
| **Additional details** (optional) | Date, scheduled times, aircraft type, duty type, etc. |

The roster is intentionally minimal — no live status, maps, or heavy UI.

---

#### **Path B: Manual Flight Entry**

```
[Dashboard] → [Add Flight] → [Manual Entry Form]
                                    │
                                    ├── Date
                                    ├── Flight Number (e.g. PC1234, TK1823)
                                    ├── Origin (optional — can derive from APIs)
                                    ├── Destination (optional)
                                    ├── Scheduled Departure / Arrival (optional)
                                    │
                                    └── [Save] → Added to roster
```

**Wireframe — Manual Flight Entry**

```
┌─────────────────────────────────────────┐
│  ← Add Flight                     ✓     │
├─────────────────────────────────────────┤
│                                         │
│  Date            [Feb 14, 2025    ▼]   │
│                                         │
│  Flight Number   [PC1234          ]    │
│  (e.g. TK1823, PC5678)                  │
│                                         │
│  Origin          [IST             ]    │
│  Destination     [SAW             ]    │
│                                         │
│  Departure       [08:30           ]    │
│  Arrival         [09:15           ]    │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │         [Save Flight]           │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Tip: Entering flight number can       │
│  auto-fill route and times             │
└─────────────────────────────────────────┘
```

---

### 1.3 Authorize Family Members

```
[Dashboard] → [Family] / [Connections] → [Pending Requests]
                                                │
                                                ├── List: "Ahmet requests to follow your flights"
                                                │   [Approve] [Decline]
                                                │
                                                └── Or: [Invite Family] → Share invite link/code
                                                    └── Family signs up with code → appears in Pending
```

**Flow:**
- Family connects first (invite link, email, or in-app search)
- Connection appears as **pending** until crew approves
- Crew approves/declines from the Family/Connections screen

**Wireframe — Family Authorization**

```
┌─────────────────────────────────────────┐
│  ← Family Connections            ⋮     │
├─────────────────────────────────────────┤
│                                         │
│  Pending (1)                            │
│  ┌─────────────────────────────────┐   │
│  │ 👤 Ayşe (ayse@email.com)        │   │
│  │    Wants to follow your flights │   │
│  │    [Approve]  [Decline]         │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Authorized (2)                         │
│  ┌─────────────────────────────────┐   │
│  │ 👤 Mehmet (spouse)    ✓         │   │
│  │ 👤 Elif (mother)      ✓         │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Invite Family Member]                 │
│  Share your code: FLYF-XXXX-XXXX        │
│  [Copy] [Send via WhatsApp]             │
│                                         │
└─────────────────────────────────────────┘
```

---

## 2. Family User Flows

### 2.1 Onboarding & Connect to Crew

```
[Sign Up] → [Select Role: Family] → [Connect to Crew]
                                        │
                                        ├── Enter invite code (from crew)
                                        │   OR
                                        ├── Enter crew's email/phone (sends request)
                                        │
                                        └── [Submit] → "Request sent. Crew must approve."
                                            └── Wait for approval → Dashboard
```

**Wireframe — Family: Connect to Crew**

```
┌─────────────────────────────────────────┐
│  ← Connect to Crew                      │
├─────────────────────────────────────────┤
│                                         │
│  Get flight updates from your crew      │
│  member                                 │
│                                         │
│  Invite code (from crew)                │
│  [FLYF-____-____                    ]   │
│                                         │
│  ─── or ───                             │
│                                         │
│  Crew's email                           │
│  [crew@email.com                    ]   │
│  We'll send them a connection request   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │         [Send Request]          │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Status: Pending approval from [Name]   │
└─────────────────────────────────────────┘
```

---

### 2.2 View Roster & Flight Status

**Time display**: Family members see all times in their **local time** only (based on their device/location). No UTC option.

Family members see:
1. **Roster** of their linked crew — the same flights the crew has in their schedule
2. **Flight status** — only when crew is **on duty** for that flight (i.e. flight is today / in progress)

**Flight status** (when crew is on duty) includes:

| Data | Description |
|------|-------------|
| **Status at time of check** | Scheduled, Boarding, Departed, En route, Landed, etc. |
| **Estimated takeoff time** | Updated in near real-time |
| **Estimated landing time** | Updated in near real-time |
| **On-time / Delay** | Green (on time) or red (delayed) with delay duration |
| **Embedded map** (optional) | Live aircraft position on route |

```
[Dashboard] → View roster of linked crew
                    │
                    └── When crew is on duty: tap flight → Flight Status screen
                        • Live status, ETA, delay info
                        • Optional: map with aircraft location
                    │
                    └── Push notifications: Today's flights, Took off, Landed, Delayed, Diverted
```

**Wireframe — Family Dashboard (Roster List)**

```
┌─────────────────────────────────────────┐
│  FlyFam                    🔔     👤    │
├─────────────────────────────────────────┤
│                                         │
│  Following: Ali (Pegasus)               │
│                                         │
│  Ali's roster — Feb 2025                │
│  ┌─────────────────────────────────┐   │
│  │ Feb 14  PC1234  IST → SAW       │   │
│  │ 08:30–09:15    On duty now →    │   │
│  ├─────────────────────────────────┤   │
│  │ Feb 15  PC5678  SAW → IST       │   │
│  │ 14:20–15:05    Scheduled        │   │
│  ├─────────────────────────────────┤   │
│  │ Feb 16  PC9012  IST → AYT       │   │
│  │ 10:00–11:20    Scheduled        │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ─── Notifications ───                  │
│  ✓ Ali's flight PC1234 landed at SAW   │
│    09:18 • 2 min ago                    │
└─────────────────────────────────────────┘
```

**Wireframe — Family: Flight Status (when crew is on duty)**

```
┌─────────────────────────────────────────┐
│  ← PC1234  IST → SAW              ⋮    │
├─────────────────────────────────────────┤
│                                         │
│  Status: En route                       │
│  On time ✓                              │
│                                         │
│  Scheduled    Estimated                 │
│  Dep 08:30    Dep 08:32 (+2 min)       │
│  Arr 09:15    Arr 09:18 (+3 min)       │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │                                 │   │
│  │     [ Embedded Map ]            │   │
│  │     • Route: IST ───●─── SAW   │   │
│  │     • Aircraft position        │   │
│  │                                 │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Ali is on this flight                  │
└─────────────────────────────────────────┘
```

---

## 3. Company / Roster URL Mapping

Profile company drives the roster source:

| Company        | Roster System      | URL                          |
|----------------|--------------------|------------------------------|
| Pegasus Airlines | Pegasus WebCrew  | https://webcrew.flypgs.com   |
| Turkish Airlines | (TBD)           | (configure per airline)      |
| ...            | ...                | ...                          |

New airlines can be added via an admin config or a curated list.

---

## 4. End-to-End Flow Summary

```
CREW                                    FAMILY
────                                    ──────
1. Sign up (Crew)                       
2. Set company (e.g. Pegasus)           
3. Roster:                              
   • Sync from webcrew.flypgs.com       OR
   • Add flights manually               
4. Invite family / approve requests  ←── 1. Sign up (Family)
                                        2. Enter code or crew email
                                        3. Wait for crew approval
                                        4. See linked crew’s flights
                                        5. Get push notifications (today's flights, took off, landed, delayed, diverted)
```

---

## 5. Next Steps

1. **Data model** — Users, CrewProfile, FamilyConnection, Flight, RosterSource
2. **Airline roster integration** — Parsing, auth (OAuth/WebView/calendar) per airline
3. **Flight status API** — Real-time takeoff/landing (e.g. Aviation Stack, FlightAware)
4. **Push notifications** — Firebase / APNs for family devices
5. **UI mockups** — Figma/Sketch based on these wireframes

---

## 6. Push Notifications (Family Users) — Core Feature

Push notifications are **one of the most important features** of FlyFam. Family users receive real-time flight status updates for their linked crew via push notifications.

### Notification types

| Type | When sent | Example |
|------|-----------|---------|
| **Today's flight** | Morning or when crew has a duty day | "Ali has 2 flights today: PC1234 IST→SAW, PC5678 SAW→IST" |
| **Took off** | Flight departs | "Ali's flight PC1234 has departed from IST" |
| **Landed** | Flight arrives at destination | "Ali's flight PC1234 has landed at SAW" |
| **Delayed** | Significant delay detected | "Ali's flight PC1234 is delayed. New dep: 10:15" |
| **Diverted** | Flight diverts to different airport | "Ali's flight PC1234 has been diverted to [airport]" |

### Requirements

- Only **family users** receive these notifications (crew do not get roster push alerts from the app)
- Triggered for **authorized connections** — family must be approved by crew
- Based on **live flight data** — needs flight status API integration (departure/arrival/divert/delay)
- Family can manage notification preferences (per crew, per type, or global mute)
