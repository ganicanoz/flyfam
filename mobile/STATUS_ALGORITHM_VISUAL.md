# Uçuş durumu (status) algoritması — son hal (Mermaid)

Statü belirleme algoritmasının güncel hali. VS Code (Mermaid eklentisi), GitHub veya [mermaid.live](https://mermaid.live) ile görüntüleyebilirsin.

---

## 1. Ana akış: Uygulama (fetchFlightByNumber)

Crew uygulaması uçuş eklerken veya güncellerken kullanılır. Önce FR24; FR24 yoksa veya hata (402 vb.) ise AE timetable.

```mermaid
flowchart TB
  START["fetchFlightByNumber(flightNumber, date)"]
  FR24["FR24 sorgula\n(fetchFromFlightradar24)"]
  HAS_FR{"FR24 sonuç var\nve (origin veya destination)?"}
  ENDED{"flight_ended?"}

  START --> FR24 --> HAS_FR

  HAS_FR -->|Evet| ENDED

  ENDED -->|false| FR_LIVE["4 zaman ile deriveFr24LiveStatus\n(scheduled / taxi_out / en_route / landed)"]
  FR_LIVE --> OVERRIDE{"status = en_route VE\nnow ≥ scheduled_arrival + 2 saat?"}
  OVERRIDE -->|Evet| FORCE_LAND["→ status = landed\n(FR24 datetime_landed gecikmesi)"]
  OVERRIDE -->|Hayır| FILL_AE["Scheduled yoksa AE'den doldur"]
  FORCE_LAND --> FILL_AE
  FILL_AE --> RETURN_FR["→ Dön (FR24 path)"]

  ENDED -->|true| AE_WHEN_ENDED["resolveAeTimetableWhenFrEnded\n(AE timetable full status)"]
  AE_WHEN_ENDED --> AE_ENDED_OK{"AE buldu?"}
  AE_ENDED_OK -->|Evet| RETURN_AE_ENDED["→ AE sonucu dön"]
  AE_ENDED_OK -->|Hayır| CHECKLS["FR24 last_seen var mı?"]
  CHECKLS --> LAST_MS{last_seen geçmiş mi?}
  LAST_MS -->|now ≥ last_seen| LANDED_FR["status = landed"]
  LAST_MS -->|Hayır| SCHED_FR["status = scheduled"]
  LANDED_FR --> FILL_SCHED["fillScheduledFromAe"]
  SCHED_FR --> FILL_SCHED
  FILL_SCHED --> RETURN_FR_ENDED["→ Dön"]

  HAS_FR -->|Hayır veya 402 Forbidden| AE_TABLE["AE Timetable sorgula\n(useFullStatus: true)"]
  AE_TABLE --> AE_FOUND{"AE buldu?"}
  AE_FOUND -->|Evet| APPLY_AE["applyAeStatusByFlowchart\n(cancelled/diverted → aynen;\ndiğer → actual vs now)"]
  APPLY_AE --> RETURN_AE["→ AE sonucu dön"]
  AE_FOUND -->|Hayır| RETURN_NULL["→ null (dash)"]
```

**Not:** FR24 402 veya veri dönmezse FR24 yokmuş gibi devam edilir → AE Timetable. Cron (check-flight-status-and-notify) da aynı mantıkla FR24 sonrası 402/veri yoksa AE timetable’dan statü alır; aile 402’de de bildirim alabilir.

---

## 2. FR24 durum türetme: deriveFr24LiveStatus

FR24’ten gelen 4 zaman (UTC) ile **now** karşılaştırılır. Sıra önemli.

| # | Alan | Anlamı |
|---|------|--------|
| 1 | first_seen | İlk görülme |
| 2 | datetime_takeoff | Kalkış |
| 3 | datetime_landed | İniş |
| 4 | last_seen | Son görülme |

```mermaid
flowchart TB
  NOW("now (UTC ms)")
  T1["first_seen"]
  T2["datetime_takeoff"]
  T3["datetime_landed"]
  T4["last_seen"]

  NOW --> C1{now < first_seen?}
  C1 -->|Evet| S1["scheduled"]
  C1 -->|Hayır| C2{first var ve\n(takeoff yok veya now < takeoff)?}
  C2 -->|Evet| S2["taxi_out"]
  C2 -->|Hayır| C3{takeoff var ve\n(landed yok veya now < landed)?}
  C3 -->|Evet| S3["en_route"]
  C3 -->|Hayır| C4{now ≥ last_seen?}
  C4 -->|Evet| S4["landed"]
  C4 -->|Hayır| C5{now ≥ datetime_landed?}
  C5 -->|Evet| S5["landed"]
  C5 -->|Hayır| S6["taxi_out"]
```

**Kural özeti:**

| Koşul | Status |
|-------|--------|
| now < first_seen | **scheduled** |
| first_seen ≤ now < datetime_takeoff (veya takeoff yok) | **taxi_out** |
| datetime_takeoff ≤ now < datetime_landed (veya landed yok) | **en_route** |
| now ≥ last_seen veya now ≥ datetime_landed | **landed** |
| Aksi (first var, takeoff geçmiş, landed/last yok) | **taxi_out** |

---

## 3. AE (Aviation Edge) statü: applyAeStatusByFlowchart

FR24 yokken veya flight_ended=true iken AE timetable kullanılır.

```mermaid
flowchart LR
  AE["AE Timetable sonucu\n(flightStatus, actual_departure_utc, actual_arrival_utc)"]
  CANCEL{"cancelled veya diverted?"}
  DERIVE["deriveAeStatusFromActualTimes(now, actual_dep, actual_arr)"]
  OUT["Son status"]

  AE --> CANCEL
  CANCEL -->|Evet| OUT
  CANCEL -->|Hayır| DERIVE
  DERIVE -->|var| OUT
  DERIVE -->|yok| OUT
```

**deriveAeStatusFromActualTimes (actual vs now):**

| Koşul | Status |
|-------|--------|
| now < actual_departure | **scheduled** |
| actual_departure ≤ now < actual_arrival | **en_route** |
| now ≥ actual_arrival | **landed** |

---

## 4. Cron: check-flight-status-and-notify

Cron her 2–3 dakikada çalışır; sadece **flight_status** güncellenir, actual_* yazılmaz. Aile bildirimi sadece status **değiştiğinde** (en_route, landed, cancelled, diverted).

```mermaid
flowchart TB
  CRON["Cron tetiklenir\n(flights: flight_date ∈ dün/bugün/yarın)"]
  ROW["Her uçuş için"]
  AE_CANCEL["AE cancel/divert?\n(fetchAeCancelDivert — flights API)"]
  FR24["FR24 status\n(fetchFr24Status)"]
  AE_CANCEL_OK{"cancelled / diverted?"}
  FR24_OK{"FR24 veri var?"}

  CRON --> ROW
  ROW --> AE_CANCEL --> AE_CANCEL_OK
  AE_CANCEL_OK -->|cancelled| NEW_CANCEL["newStatus = cancelled"]
  AE_CANCEL_OK -->|diverted| NEW_DIV["newStatus = diverted"]
  AE_CANCEL_OK -->|Hayır| FR24 --> FR24_OK
  FR24_OK -->|Evet| NEW_FR24["newStatus = deriveFr24LiveStatus sonucu"]
  FR24_OK -->|Hayır / 402 / no data| AE_TABLE["AE Timetable\n(fetchAeTimetableStatus)"]
  AE_TABLE --> AE_OK{"AE buldu?"}
  AE_OK -->|Evet| NEW_AE["newStatus = actual vs now\nveya AE status"]
  AE_OK -->|Hayır| SKIP["newStatus = null (atlanır)"]

  NEW_CANCEL --> DIFF
  NEW_DIV --> DIFF
  NEW_FR24 --> DIFF
  NEW_AE --> DIFF
  DIFF{"newStatus ≠ oldStatus?"}
  DIFF -->|Evet| UPDATE["DB: flight_status güncelle"]
  UPDATE --> NOTIF{"en_route / landed /\ncancelled / diverted?"}
  NOTIF -->|Evet| SEND["notification_log yoksa\nnotify-family çağır"]
  DIFF -->|Hayır| NEXT["Sonraki uçuş"]
  SKIP --> NEXT
  SEND --> NEXT
  NOTIF -->|Hayır| NEXT
```

**Cron’da kullanılan statü kaynakları (manuel ile aynı sıra):**

1. **AE cancel/divert** (flights API) → cancelled / diverted
2. **FR24** (flight-summary/light) → deriveFr24LiveStatus → scheduled / taxi_out / en_route / landed
3. **FR24 402 veya veri yok** → **AE timetable** (fetchAeTimetableStatus) → actual vs now veya AE status; aile 402’de de bildirim alır.

---

## 5. FR24 bacak seçimi (pickBest) ve “önceki gün landed” kuralı

```mermaid
flowchart LR
  LIST["FR24 API listesi"]
  EXACT["exactMatches:\ndeparture date = targetDay\n(origin local)"]
  PICK["pickFrom: flight_ended=false varsa o,\nyoksa en son landed/takeoff"]
  BASE["base: 4 zaman + deriveFr24LiveStatus"]
  LEG_OLD["legOriginDate < targetDay\nve status = landed/parked?"]

  LIST --> EXACT --> PICK --> BASE --> LEG_OLD
  LEG_OLD -->|Evet| DROP["→ null (önceki gün bacak sayma)"]
  LEG_OLD -->|Hayır| USE["→ base dön"]
```

---

## 6. UI etiketleri (Türkçe)

| flight_status (DB) | Roster etiketi |
|--------------------|----------------|
| scheduled | Planlı |
| taxi_out | Taksi |
| departed | Ayrıldı |
| en_route | Kalktı |
| landed | İndi |
| parked | İndi |
| cancelled | İptal |
| diverted | Aktarma |

---

## 7. Özet tablo (kaynak → status)

| Bağlam | Kaynak | Status nasıl? |
|--------|--------|----------------|
| Uygulama, FR24 var, flight_ended=false | FR24 4 zaman | deriveFr24LiveStatus; en_route iken now ≥ sched_arr+2h → landed |
| Uygulama, FR24 var, flight_ended=true | AE timetable veya FR24 last_seen | AE varsa AE; yoksa last_seen ≥ now → landed, değilse scheduled |
| Uygulama, FR24 yok | AE timetable | applyAeStatusByFlowchart (cancelled/diverted veya actual vs now) |
| Cron | AE cancel/divert → FR24 | Önce AE flights (cancel/divert); değilse FR24; FR24 yoksa şu an atlanır (AE timetable fallback eklenebilir) |
