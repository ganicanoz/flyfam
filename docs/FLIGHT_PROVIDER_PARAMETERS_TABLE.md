# FlyFam — Sağlayıcı parametre eşlemesi (güncel)

Bu tablo **crew PDF roster import** (bizim için birinci plan kaynağı / iç “API”) ile harici sağlayıcıları birlikte gösterir. Entegrasyon: `mobile/lib/flightApi.ts`, `check-flight-status-and-notify`, `rosterPollEdge`, `flightByNumberEdge` (**FlightAPI** yedek plan: `fetchFromFlightApiAirlineEdge`); AirLabs düz `/flight` modeli. [FlightAPI dokümantasyonu](https://docs.flightapi.io/).

**Not — PDF:** Yalnızca satır **1–5** (uçuş no, kalkış/varış meydanı, STD, STA) gelir → Supabase `flights` (`flight_number`, `origin_airport`, `destination_airport`, `scheduled_departure`, `scheduled_arrival`). Tahmin/gerçek zaman veya transponder alanları PDF’te yok.

**Not — FR24:** Bu tabloda yalnızca **`GET .../api/flight-summary/light`** (bacak özeti) yer alır. Ayrı bir “full flight summary” endpoint’i bu repoda yok. `flight-tracks` bu dokümanda kapsam dışı.

**Not — FlightAPI:** Edge’de şu an **Flight Tracking** uçuş-numarası çağrısı kullanılır: `GET https://api.flightapi.io/airline/{api_key}?num=&name=&date=YYYYMMDD` (ör. `name=PC`, `num=271`). **Airport Schedule** (`GET …/schedule/{api_key}?mode=departures|arrivals&iata=&day=`) bu repoda henüz zincire bağlı değil; SAW panosu gibi senaryolar için ayrı entegrasyon gerekir.

**Not — Faz:** `api_refresh_phase` değerleri aşağıdaki **faz tablosunda** özetlenir. Hesap: `compute_flight_api_phase_state` + tetikleyici (`20260330120000_pdf_spec_api_refresh_phase.sql`). **`ETD = coalesce(estimated_departure, scheduled_departure + delay_dep_min)`**.

| No | Parametre | PDF import (crew) → `flights` | AirLabs `GET /api/v9/flight` | AeroDataBox `GET .../flights/number/{flight}/{date}` | FR24 Summary Light `GET .../flight-summary/light` | AeroAPI (FlightAware) `GET /flights/{ident}` | FlightAPI Flight Tracking `GET …/airline/{api_key}?num&name&date` |
|----|-----------|--------------------------------|------------------------------|------------------------------------------------------|-----------------------------------------------------|-----------------------------------------------|---------------------------------------------------------------------|
| 1 | Uçuş kodu | ✅ Parse → `flight_number` | ✅ İstek: `flight_iata` veya `flight_icao`; yanıtta `flight_iata` / `flight_number` vb. | ✅ URL’de uçuş numarası | ✅ `flights` sorgu parametresi (virgülle varyantlar) | ✅ `ident` path | ✅ `name` (IATA/ICAO airline) + `num` (sayı) sorgu parametreleri |
| 2 | Kalkış meydanı (IATA/ICAO) | ✅ Parse → `origin_airport` | ✅ `dep_iata`, `dep_icao` | ✅ `departure` (veya sarmalayıcı) → `airport.iata` / `airport.icao` | ✅ `orig_icao`, `origin_icao` (çoğunlukla ICAO; IATA türetim uygulamada) | ✅ `origin` nesnesi / kod | ✅ Dizi öğesi `departure.airportCode` (IATA) |
| 3 | Varış meydanı (IATA/ICAO) | ✅ Parse → `destination_airport` | ✅ `arr_iata`, `arr_icao` | ✅ `arrival` → `airport.iata` / `airport.icao` | ✅ `dest_icao`, `destination_icao`, `destination_icao_actual` | ✅ `destination` nesnesi / kod | ✅ `arrival.airportCode` |
| 4 | STD (UTC) | ✅ Parse → `scheduled_departure` (`timestamptz`, UTC) | ✅ `dep_time`, `dep_time_utc` (+ `dep_scheduled` / `dep_scheduled_ts` vb.) | ✅ `departure` → `scheduledTimeUtc`, `scheduledTime`, `scheduledTimeLocal` | ✅ `scheduled_departure_utc`, `scheduled_departure` (her zaman dolu olmayabilir) | ✅ `scheduled_out` | ✅ `departure.departureDateTime` veya `scheduledTime` (ISO ise UTC’ye çevrilir; metin formatı zayıf) |
| 5 | STA (UTC) | ✅ Parse → `scheduled_arrival` (`timestamptz`, UTC) | ✅ `arr_time`, `arr_time_utc` (+ `arr_scheduled` / `arr_scheduled_ts` vb.) | ✅ `arrival` → `scheduledTimeUtc`, … | ✅ `scheduled_arrival_utc`, `scheduled_arrival` (her zaman dolu olmayabilir) | ✅ `scheduled_in` | ✅ `arrival.arrivalDateTime` / `scheduledTime` |
| 6 | ETD (UTC) | — | ✅ `dep_estimated`, `dep_estimated_utc` (+ `_ts`) | ✅ `departure` → `predictedTime*`, `estimatedTime*` | ✅ Çeşitli isimler: `estimated_departure_utc`, `etd`, `estimated_time_departure` vb. (kod: `fr24ProgressBarPatch`) | ✅ `estimated_out` | ✅ `departure.estimatedTime` (ISO ise); plan saatine birleşik yazım (`merge`) |
| 7 | ETA (UTC) | — | ✅ `arr_estimated`, `arr_estimated_utc` (+ `_ts`) | ✅ `arrival` → `predictedTime*`, `estimatedTime*` | ✅ `estimated_landing`, `eta`, `estimated_arrival_utc` vb. | ✅ `estimated_in` | ✅ `arrival.estimatedTime` |
| 8 | ATD (UTC) | — | ✅ `dep_actual`, `dep_actual_utc` | ✅ Gerçek kalkış için tipik yanıtta ayrı alan; poll path’te çoğunlukla boş | ✅ `datetime_takeoff`, `datetimeTakeoff` (operasyonel kalkış) | ✅ `actual_out` | ⚠️ Örnek yanıtta `outGateTime` / `offGroundTime` (çoğunlukla metin; Edge’de işlenmiyor) |
| 9 | ATA (UTC) | — | ✅ `arr_actual`, `arr_actual_utc` | ✅ Tipik yanıtta ayrı alan; poll’da çoğunlukla boş | ✅ `datetime_landed`, `datetimeLanded` | ✅ `actual_in` | ⚠️ `onGroundTime` / `inGateTime` vb. (Edge’de işlenmiyor) |
| 10 | Anormal durum (iptal / aktarma sinyali) | — | ✅ `status` (`cancelled`, `diverted` vb.) | ✅ Kök / bacak `status` metni (divert vb.) | ⚠️ Ham yanıtta olabilir; **bu repoda light ile işlenmiyor** (`Fr24Flight` tipinde yok) | ✅ `status` (+ divert için alanlar) | ⚠️ Bu repoda airline yanıtından statü eşlemesi yok |
| 11 | Transponder açılış (UTC) | — | — | — | ✅ `first_seen`, `firstSeen` | — | — |
| 12 | Kalkış zamanı (UTC) | — | — | — | ✅ `datetime_takeoff`, `datetimeTakeoff` | — | — |
| 13 | İniş zamanı (UTC) | — | — | — | ✅ `datetime_landed`, `datetimeLanded` | — | — |
| 14 | Transponder kapanış / son görülme (UTC) | — | — | — | ✅ `last_seen`, `lastSeen` | — | — |
| 15 | `api_refresh_phase` · `phase_active_locked` | Girdi: `scheduled_*`, `delay_dep_min` (PDF’te yok; API ile dolunca ETD kayar) | — (tetikleyici hesaplar) | — | — | — | — |

Satır 15: Hiçbir harici API faz alanını doğrudan yazmaz; `flights` güncellenince trigger yeniden hesaplar. Mobilde `computeApiRefreshPhase` aynı kuralla gösterim hizası (ör. `taxi_out` / `en_route` iken aktif).

### Uçuş hangi fazda? — `api_refresh_phase` × kaynak × cron

Cron (`check-flight-status-and-notify`) yalnızca **`semi_active`** ve **`active`** satırlarını ana listeye alır.

| Faz | Ne zaman (özet) | PDF | AirLabs | AeroDataBox | FR24 Light | AeroAPI | FlightAPI | Cron ana liste |
|-----|-----------------|-----|---------|-------------|------------|---------|-----------|----------------|
| `passive_future` | `now < STD − 3h` | ✅ Plan kaynağı (STD/STA) | — | — | — | — | — | Hayır |
| `semi_active` | `STD − 3h ≤ now < ETD − 30m` | ✅ Plan; cron `estimated_*` yazar | ✅ timetable birincil | ✅ AirLabs zayıfsa | ✅ plan yedeği | ⚠️ `uncertain` | ⚠️ `flightByNumberEdge` plan boşsa yedek | Evet · tahmin + gecikme |
| `active` | `now ≥ ETD − 30m` veya `phase_active_locked` | ✅ STD/STA; statü API | ✅ timetable + iptal/divert | ✅ yedek | ✅ canlı + statü | ⚠️ `uncertain` | ⚠️ yalnızca plan doldurma | Evet · statü + bildirim |
| `passive_past` | İniş sinyali veya stale pencere | — | — | — | — | — | — | Hayır (ayrı pasif bakım) |

## Kısa referans — PDF import (crew)

Roster PDF → parse → `flights` satırı. Plan saatleri roster kartında **STD/STA** olarak kalır; API’ler `estimated_*` / canlı alanları günceller.

## Kısa referans — AirLabs alanları (iç içe `departure` değil)

Kodda kullanılan örnekler: `dep_time_utc`, `arr_time_utc`, `dep_actual_utc`, `arr_actual_utc`, `dep_estimated_utc`, `arr_estimated_utc`, `dep_iata`, `arr_iata`, `status`, `percent`, `dep_delayed`, `arr_delayed`.

## Kısa referans — AeroDataBox

Zamanlar: `departure` / `arrival` (veya `departures[0].departure`) altında `scheduledTimeUtc`, `predictedTimeUtc`, `estimatedTimeUtc` vb. (`aeroCoerceTimeString` ile).

## Kısa referans — FR24 Summary Light

Bacak seçimi, plan/tahmin/iniş zamanları, `flight_ended`, `first_seen` / `last_seen` / `datetime_takeoff` / `datetime_landed`.

## Kısa referans — FlightAPI (Flight Tracking)

Yanıt: JSON dizi; öğeler `departure` / `arrival` nesneleri. Edge: `departureDateTime`, `arrivalDateTime`, `estimatedTime`, `airportCode`, `airportCity`. Ücret: dokümantasyona göre istek başına kredi ([FlightAPI](https://docs.flightapi.io/)).
