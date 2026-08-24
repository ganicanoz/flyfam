# PC2038 neden "Kalktı" olarak görünüyor? (Adım adım)

## 1. Ekranda ne görünüyor?

- **Türkçe çeviride:** `en_route` durumu **"Kalktı"** olarak gösteriliyor (`statusEnRoute`).
- Yani "Kalktı" = uygulama içinde `flight_status === 'en_route'` (uçak havada).

(`statusDeparted` = "Ayrıldı" → sadece `flight_status === 'departed'` ise kullanılır; şu an hiçbir kaynak `departed` döndürmüyor.)

---

## 2. Durum nereden geliyor?

### Adım 1: Liste yükleniyor

- Roster açılınca uçuşlar Supabase’den çekilir.
- PC2038 satırında `flight_status` alanı okunur (örn. `'en_route'`).

### Adım 2: Gösterilecek metin seçiliyor

- `getFlightStatus(flight)` (Roster.tsx) şunu yapar:
  - `f.flight_status` değerini alır (örn. `'en_route'`).
  - Geçerli bir durumsa (scheduled, taxi_out, departed, en_route, landed, …) aynen döndürür.
  - Tek istisna: `en_route` iken `actual_arrival` geçmişteyse → **Landed** gösterilir.

```ts
// Roster.tsx ~704
const getFlightStatus = (f: Flight): FlightStatus => {
  const fromApi = f.flight_status;
  if (fromApi === 'en_route' && f.actual_arrival && Date.now() >= parseUtcMsStatic(f.actual_arrival))
    return 'landed';
  return fromApi ?? 'scheduled';
};
```

- PC2038 için DB’de `flight_status = 'en_route'` ve (güncel veri yoksa) `actual_arrival` yok/gelecekte → sonuç **en_route** kalır.

### Adım 3: Etiket (label) atanıyor

- `statusConfig[getFlightStatus(flight)]` kullanılır.
- `en_route` → `t('roster.statusEnRoute')` → **"Kalktı"**.

Bu yüzden PC2038 **"Kalktı"** görünüyor: çünkü durum **en_route** ve Türkçe’de en_route etiketi "Kalktı".

---

## 3. `flight_status = 'en_route'` nereden yazılıyor?

### API güncellemesi (refresh)

- Kullanıcı listeyi yenilediğinde veya otomatik yenileme çalıştığında `refreshTimesFromApi` → `fetchFlightByNumber('PC2038', date)` çağrılır.

### fetchFlightByNumber (flightApi.ts) akışı

1. **FR24 çağrılır** (`fetchFromFlightradar24`).
2. FR24 uçuşu bulursa:
   - **flight_ended === true** ise: AE timetable veya FR24 `datetime_landed_utc` ile sonuç; durum landed / AE’den gelen status olur.
   - **flight_ended === false** ise:
     - FR24’te `first_seen`, `datetime_takeoff`, `datetime_landed`, `last_seen` varsa → **deriveFr24LiveStatus** ile durum hesaplanır:
       - `now >= datetime_takeoff` ve `now < datetime_landed` → **en_route**
       - (Ayrıca: now < first_seen → scheduled, first_seen ≤ now < takeoff → taxi_out, now ≥ landed → landed, vb.)
     - FR24’te bu zamanlar yoksa AE timetable’dan `actual_departure` / `actual_arrival` ile **deriveStatusFromAeTimetableFallback** kullanılır (scheduled / en_route / landed).
3. Dönen `FlightInfo.flightStatus` (örn. `'en_route'`) Roster’da `payloadScheduled.flight_status` ile DB’ye yazılır.

Yani **en_route** şu durumlarda yazılır:

- FR24: uçuş canlı, `now >= kalkış zamanı` ve `now < iniş zamanı` (veya iniş zamanı yok).
- AE fallback: `actual_departure` geçmişte, `actual_arrival` yok.

---

## 4. Özet: PC2038 “Kalktı” neden?

| Adım | Ne oluyor |
|------|-----------|
| 1 | DB’de PC2038 için `flight_status = 'en_route'` (API’den bir yenilemede yazılmış). |
| 2 | Roster bu satırı okur; `getFlightStatus` → `'en_route'` döner (actual_arrival geçmişte değilse). |
| 3 | `statusConfig.en_route.label` = `t('roster.statusEnRoute')` = **"Kalktı"**. |
| 4 | Ekranda "Kalktı" görünür. |

Yani PC2038, uygulama mantığına göre **havada (en_route)** kabul edildiği için "Kalktı" gösteriliyor. Bu ya:

- Gerçekten havadaysa doğru davranış,
- Ya da iniş yapmış ama henüz `datetime_landed_utc` / `actual_arrival` güncellenmemişse bir sonraki API yenilemesinde **landed** yazılınca "İndi" olarak güncellenir.

---

## 5. İstersen “Kalktı” / “Havada” ayrımı

Şu an Türkçe’de:

- **en_route** → "Kalktı"
- **departed** → "Ayrıldı"

Kod tarafında hiçbir kaynak (FR24, AE, AeroDataBox) artık `departed` döndürmüyor; hepsi “havada” için `en_route` kullanıyor. Yani "Kalktı" aslında “havada” anlamında. Ayrımı netleştirmek istersen:

- **en_route** → "Havada"
- **departed** → "Kalktı" veya "Ayrıldı"

gibi bir çeviri değişikliği `locales/tr.json` içinde yapılabilir; bu sadece etiket metnini değiştirir, PC2038’in neden "Kalktı" göründüğü yukarıdaki akışla aynı kalır.
