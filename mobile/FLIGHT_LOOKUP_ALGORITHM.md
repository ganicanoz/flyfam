# Flight lookup & time handling (UTC-in, device-local display)

Bu doküman, FlyFam’de uçuş saatlerini **API’lerden UTC olarak alma**, DB’de **UTC olarak saklama** ve UI’da **kullanıcının cihaz/timezone’una göre** gösterme algoritmasını özetler.

## Temel kurallar

- **DB canonical**: `scheduled_*` ve `actual_*` alanları **UTC ISO** (sonu `Z` veya offset’li → normalize edilip `Z`’li ISO).
- **UI local**: Kullanıcıya gösterilen “Local” saat, **kullanıcının cihazının bulunduğu timezone**’dur (havaalanı timezone’u değil).
- **UTC varsayımı**:
  - **FR24**: FR24 dokümantasyonu UTC dediği için offset yoksa **UTC varsayılır**.
  - **Diğer API’ler**: Offset/Z yoksa **tahmin yapılmaz** (ambiguity → veri atlanır) veya kaynak özelinde local→UTC çevrimi yapılır (Aviation Edge Future gibi).

## UI’da saat gösterimi

- Roster’da gösterim:  
  - `Local`: `formatFlightTimeLocal(utcIso)` → cihaz timezone’unda HH:MM  
  - `UTC`: `formatFlightTimeUTC(utcIso)` → UTC HH:MM

> Not: “Local” artık kalkış/varış havaalanı yerel saati değil, **kullanıcının cihaz yerel saati**dir.

## Kullandığımız uçuş veri kaynakları (API’ler)

### 1) Aviation Edge — `timetable` (real-time schedules)
- **Amaç**: Bugün/canlı uçuşlar için scheduled + status + delay + (varsa) actual/estimated.
- **Endpoint**: `GET https://aviation-edge.com/v2/public/timetable`
- **Özellik**: API çağrısında tarih yok; response içinde `departure.scheduledTime` üzerinden **seçilen güne filtrelenir**.
- **Zamanlar**:
  - `scheduledTime` / `estimatedTime` bazen offset’li, bazen local olabilir.
  - Offset yoksa local→UTC için airport offset haritası kullanılır (mevcut MVP yaklaşımı).

### 2) Aviation Edge — `flightsFuture` (future schedules)
- **Amaç**: Seçilen tarih **todayLocal + 1 gün (yarın) ve sonrası** ise planlı (scheduled) saatleri bulmak.
- **Endpoint**: `GET https://aviation-edge.com/v2/public/flightsFuture`
- **Zamanlar**:
  - `scheduledTime` / `estimatedTime` çoğu zaman **local**. Local→UTC dönüşümü yapılır.

### 3) Aviation Edge — `flights` (live tracking)
- **Amaç**: Uçuş **canlı** iken tracking + status + (varsa) estimated/actual.
- **Endpoint**: `GET https://aviation-edge.com/v2/public/flights`
- **Filtre**: `flightIata=PC657` gibi (IATA flight no).
- **Zamanlar**:
  - Offset/Z varsa UTC’ye normalize edilir.
  - Offset yoksa, local→UTC dönüşümü için airport offset MVP yaklaşımı kullanılır.

### 4) Flightradar24 — `flight-summary/light`
- **Amaç**: Geniş zaman penceresinde doğru uçuşu bulmak; scheduled ve (varsa) actual.
- **Endpoint**: `GET https://fr24api.flightradar24.com/api/flight-summary/light`
- **Zamanlar**:
  - FR24 “UTC” dediği için offset yoksa **UTC varsayılır** (normalize edilip `Z`’li ISO’a çevrilir).
- **Filtre**:
  - Seçilen gün için `scheduled_departure_utc`/fallback alanlarının `YYYY-MM-DD` kısmı eşleşen kayıt seçilir.

### 5) AeroDataBox (RapidAPI)
- **Amaç**: Status + scheduled/actual/estimated; özellikle `...TimeUtc` alanları ile net UTC.
- **Endpoint**: `GET https://{host}/flights/number/{flightNumber}/{date}`
- **Zamanlar**:
  - Öncelik `scheduledTimeUtc` / `actualTimeUtc`.
  - Offset/Z içermeyen datetime’ler **kabul edilmez** (tahmin yok).

### (Opsiyonel/implement edildi) 5) AviationStack
- **Amaç**: Alternatif schedule kaynağı.
- **Endpoint**: `GET https://api.aviationstack.com/v1/flights`
- **Not**: Kodda parser mevcut; lookup zincirine dahil edilmesi gerekiyorsa ayrı karar.

## Lookup akışı (bugünkü implementasyon)

`fetchFlightByNumber(flightNumber, date)` çağrısı:

1. Aviation Edge Timetable  
2. Aviation Edge Flights (live tracking)  
3. (date >= todayLocal+1) Aviation Edge Future  
4. FR24  
5. AeroDataBox (RapidAPI)

Her kaynak:
- Uçuş bulunamazsa `null` döner → sıradaki kaynağa geçilir.
- Bulunursa `FlightInfo` döner:
  - `scheduled_departure_utc`, `scheduled_arrival_utc` (UTC ISO)
  - opsiyonel `actual_*_utc` (UTC ISO)
  - `flightStatus` (scheduled/en_route/landed/...)

## Mermaid şema

```mermaid
flowchart TD
  A[fetchFlightByNumber(flightNumber, dateLocalYYYYMMDD)] --> B[Try Aviation Edge timetable]
  B -->|found & date matches| R[Return UTC ISO times + status]
  B -->|not found| X[Try Aviation Edge flights (live)]
  X -->|found| R
  X -->|not found| C{date >= todayLocal?}
  C -->|yes| D[Try Aviation Edge flightsFuture (today+1+)]
  C -->|no| E[Try Flightradar24]
  D -->|found| R
  D -->|not found| E
  E -->|found| R
  E -->|not found| F[Try AeroDataBox (RapidAPI)]
  F -->|found| R
  F -->|not found| N[Return null]
```

## Bilinen riskler / iyileştirme notları

- **DST (yaz saati)**: Aviation Edge local→UTC dönüşümü airport “sabit offset” tablosuyla yapılıyor; DST olan ülkelerde hataya açık. En sağlam çözüm:
  - API’den UTC/offset’li alanı tercih etmek veya
  - Airport → IANA timezone ile dönüşüm (örn. `Europe/London`) ve timezone-aware bir kütüphane kullanmak.

