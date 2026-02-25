# FlyFam — Tech Stack Proposal

## Platform

**iOS & Android** — Cross-platform mobile app

---

## Recommended Stack

### Mobile App: React Native + Expo

| Choice | Rationale |
|--------|-----------|
| **React Native** | Single codebase for iOS & Android, large ecosystem, strong TypeScript support |
| **Expo** | Speeds up dev (EAS Build, OTA updates), built-in push notifications, no native Xcode/Android Studio needed for basic flows |
| **TypeScript** | Type safety, better maintainability |
| **React Query** | Server state, caching, refetch for roster & flight status |
| **Zustand** | Lightweight client state (auth, preferences, time zone setting) |
| **React Navigation** | Common navigation library for RN |
| **Expo Notifications** | Push with FCM (Android) + APNs (iOS) via EAS |

**Alternative**: Flutter + Dart — great performance and UI, different ecosystem. RN chosen for faster onboarding if team knows React/JS.

---

### Backend: Node.js + Express (or Fastify)

| Choice | Rationale |
|--------|-----------|
| **Node.js** | Same language as many frontend devs, good async I/O for APIs and webhooks |
| **Express / Fastify** | REST API, middleware, easy integration with DB and external APIs |
| **TypeScript** | Shared types possible with mobile |
| **tRPC** (optional) | End-to-end types if you want a tighter API contract |

**Alternative**: Firebase / Supabase — faster MVP with Auth, DB, Realtime, and Edge Functions. Trade-off: less control for custom roster sync and background jobs.

---

### Database: PostgreSQL

| Choice | Rationale |
|--------|-----------|
| **PostgreSQL** | Relational data (users, crews, families, flights, connections), JSONB for flexible fields, robust and scalable |
| **Hosting** | Supabase, Neon, Railway, or AWS RDS |
| **ORM** | Prisma — type-safe, migrations, good DX |

**Alternative**: Firebase Firestore — document model, real-time listeners, but less suited for complex relations and reporting.

---

### Authentication

| Choice | Rationale |
|--------|-----------|
| **Firebase Auth** or **Supabase Auth** | Email/password, optional phone, social login; handles tokens and refresh |
| **JWT** (if custom backend) | Stateless auth; validate on each request |

---

### Push Notifications

| Choice | Rationale |
|--------|-----------|
| **Firebase Cloud Messaging (FCM)** | Works for both iOS (via APNs) and Android |
| **Expo Push Notifications** | Wraps FCM/APNs, stores device tokens, simple API |
| **Backend job** | Cron or queue to poll flight status, detect status changes, send pushes to family FCM tokens |

---

### Flight Status API

| Option | Notes |
|--------|------|
| **Aviation Stack** | REST, good free tier, flight status, delays |
| **FlightAware AeroAPI** | High quality, paid |
| **FlightStats** | Enterprise-oriented |
| **OpenSky Network** | Free, real-time position; good for map |

**Recommendation**: Aviation Stack for status/delays; OpenSky for live aircraft position on map (if needed).

---

### Maps (Embedded aircraft location)

| Choice | Rationale |
|--------|-----------|
| **Mapbox** or **React Native Maps** | Custom map styling, flight path overlay, aircraft marker |
| **Google Maps** | Familiar UX, good RN support |

---

### Roster Sync (Airline websites)

| Component | Rationale |
|-----------|-----------|
| **Node.js service** | Scheduled jobs (e.g. every 3h) per airline |
| **Puppeteer / Playwright** | Browser automation for sites like Pegasus WebCrew; login and scrape roster |
| **Per-airline adapters** | Pegasus, Turkish, etc. — each has its own parser |

**Note**: Credential handling and ToS compliance must be reviewed per airline. Calendar export or official API (if available) is preferred over scraping.

---

### DevOps & Hosting

| Component | Suggestion |
|----------|------------|
| **Backend** | Railway, Render, Fly.io, or AWS |
| **Database** | Supabase, Neon, Railway, or RDS |
| **Mobile builds** | EAS Build (Expo Application Services) |
| **CI/CD** | GitHub Actions for tests and deployments |
| **Secrets** | Environment variables; consider Doppler or Vault |

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐
│   iOS App       │     │  Android App    │
│  (React Native  │     │ (React Native   │
│   + Expo)       │     │  + Expo)        │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │ REST API / tRPC
                     ▼
         ┌───────────────────────┐
         │   Node.js Backend     │
         │   (Express/Fastify)   │
         └───────────┬───────────┘
                     │
    ┌────────────────┼────────────────┐
    ▼                ▼                ▼
┌────────┐    ┌────────────┐   ┌─────────────┐
│  PG    │    │  Flight    │   │  Roster     │
│  DB    │    │  Status    │   │  Sync       │
│(Prisma)│    │  API       │   │  (Puppeteer)│
└────────┘    └────────────┘   └─────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  FCM / Expo Push      │
         │  → Family devices     │
         └───────────────────────┘
```

---

## MVP Stack — Chosen Approach ✓

For the first step, we're building the **MVP** for the fastest path to a working app:

| Layer | MVP Choice |
|-------|------------|
| **Mobile** | React Native + Expo |
| **Backend** | **Supabase** (Auth + PostgreSQL + Edge Functions) |
| **Push** | Expo Push + Supabase Edge Function to call FCM |
| **Flight API** | Aviation Stack |
| **Roster** | Manual entry only first; add Pegasus sync in v2 |
| **Maps** | Defer to v2 |

This keeps infra minimal while validating flows and notifications. Roster auto-sync and maps can be added in v2.

---

## Summary

| Layer | Recommended | MVP Alternative |
|-------|-------------|-----------------|
| Mobile | React Native + Expo + TypeScript | Same |
| Backend | Node.js + Express + Prisma | Supabase |
| Database | PostgreSQL | Supabase (Postgres) |
| Auth | Firebase Auth or Supabase Auth | Supabase Auth |
| Push | Expo Push + FCM | Same |
| Flight Status | Aviation Stack | Same |
| Maps | Mapbox / RN Maps | v2 |
| Roster Sync | Custom (Puppeteer per airline) | Manual only in v1 |
