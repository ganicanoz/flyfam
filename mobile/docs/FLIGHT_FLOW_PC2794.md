# PC2794 (ve herhangi bir uçuş) için veri akışı

Bu dokümanda bir uçuşun (örnek: PC2794) eklenmesinden listelenmesine, güncellenmesine ve ekranda **sadece scheduled saatlerin** gösterilmesine kadar tüm akış özetleniyor.

---

## 1. Liste nereden geliyor?

- **Crew:** Roster açılınca `supabase.from('flights').select(...).eq('crew_id', ...)` ile bugün/dün uçuşlar çekilir.
- **Family:** Aynı şekilde `flights` tablosu, `family_connections` üzerinden yetkili crew’lara ait uçuşlar olarak çekilir.
- Her satırda **kalkış/varış saatleri** artık **yalnızca** `scheduled_departure` ve `scheduled_arrival` ile formatlanıp gösteriliyor (`formatTimeLocal(scheduled_*)`). `actual_*` alanları **hiçbir ekranda kullanılmıyor**.

---

## 2. Ekranda ne görüyorsun?

- **Kalkış satırı:** `scheduled_departure` → cihazın yerel saatine çevrilir (ve isteğe bağlı Z).
- **Varış satırı:** `scheduled_arrival` → aynı şekilde.
- **Status (Planlı / Kalktı / İndi vb.):** `flight_status` alanından; bu alan API/cron tarafından `actual_*` ve FR24 4 zamanına göre güncellenir ama **gösterilen saatler değişmez**, hep scheduled kalır.

Yani PC2794 “İndi” olsa bile ekrandaki varış saati **her zaman planlanan iniş saati** (scheduled_arrival, örn. TR 19:25). Gerçek iniş saati (actual_arrival) sadece status tespiti için kullanılır, kullanıcıya gösterilmez.

---

## 3. Güncelleme (sağa kaydır / pull-to-refresh / cron) ne yapıyor?

### 3.1 Uygulama tetiklemesi (Roster’da güncelle veya pull-to-refresh)

1. **fetchFlightByNumber('PC2794', flight_date)** çağrılır (`mobile/lib/flightApi.ts`).

2. **FR24 sorgulanır:**
   - `fetchFromFlightradar24`: FR24 API’ye `flight_datetime_from` / `flight_datetime_to` ve `flights=PC2794,PGT2794,...` ile istek atılır.
   - Dönen listeden **seçilen güne ait bacak** seçilir (origin local date = crew’in seçtiği gün).
   - FR24’ten gelen alanlar:
     - `scheduled_departure_utc`, `scheduled_arrival_utc` → plan saatleri (varsa).
     - `first_seen`, `datetime_takeoff`, `datetime_landed`, `last_seen` → status türetmek için (actual değil, 4 zaman).
     - `flight_ended` (true/false).

3. **FR24 sonrası dallanma:**
   - **flight_ended === false (canlı bacak):**
     - `deriveFr24LiveStatus(now, first_seen, takeoff, landed, last_seen)` ile status hesaplanır (scheduled / taxi_out / en_route / landed).
     - FR24 bazen `scheduled_*` döndürmez; o durumda isteğe bağlı **AE timetable** ile plan saatleri doldurulur.
     - Dönen `FlightInfo`: `scheduled_departure_utc`, `scheduled_arrival_utc`, `flightStatus`. FR24 tarafında **actual_departure_utc / actual_arrival_utc set edilmez** (sadece 4 zaman var, biz onları actual olarak DB’ye yazmıyoruz bu path’te).
   - **flight_ended === true (uçuş bitmiş):**
     - Önce **Aviation Edge timetable** denenir; AE’den cancelled/diverted veya CHECK_TIME_1 (actual vs now) ile status gelir.
     - AE yoksa FR24’teki `last_seen` ile “şimdi ≥ last_seen mi?” bakılır → evet ise **landed** dönülür; yoksa scheduled.
     - Dönen bilgide yine **scheduled** saatler kullanılır (AE’den gelen scheduled/actual ayrımı DB’ye yazılır ama ekranda sadece scheduled kullanılıyor).

4. **Roster’da DB güncellemesi (processFlight):**
   - **payloadScheduled:** `scheduled_departure_utc` / `scheduled_arrival_utc` **sadece API’den geldiyse** yazılır (`effectiveInfo.scheduled_departure_utc != null` vb.). Yani API scheduled döndürdüğü sürece DB’deki scheduled güncellenir; dönmezse **mevcut scheduled’a dokunulmaz**.
   - **payloadActual:** `actual_departure_utc` / `actual_arrival_utc` API’den gelirse yazılır (status ve cron tarafı için).
   - **flight_status:** API’den gelen status yazılır (Planlı / Kalktı / İndi).

Özet: Uçuş eklendiğinden itibaren **scheduled** alanları, yalnızca API’den **yeni scheduled değer** geldiğinde güncellenir. Actual sadece status ve arka plan için; ekranda hep scheduled kullanılıyor.

### 3.2 Cron (check-flight-status-and-notify)

- Her 2 dakikada (veya ayarladığın aralıkta) çalışır.
- Bugün/dün/yarın uçuşlarını DB’den alır; her biri için FR24’ten **özet** çeker (datetime_takeoff, datetime_landed vb.).
- DB’de `actual_departure` / `actual_arrival` ve `flight_status` güncellenir; **scheduled_*** cron tarafında sadece FR24’ten gelirse güncellenir (mevcut mantıkta cron da FR24’ten gelen scheduled’ı yazar, yoksa dokunmaz).
- Aileye “kalktı”/“indi” push’ı bu cron veya uygulama güncellemesi sonrası tetiklenir. **Bildirim metninde de sadece scheduled kullanılması** ayrı bir tercih; şu an bildirim metni bu dokümandaki “saat gösterimi” kuralından bağımsız.

---

## 4. Kısa özet (PC2794 özelinde)

| Adım | Ne oluyor? | Saatler (ekranda) |
|------|------------|--------------------|
| Uçuş eklenir | AddFlight / API ile `scheduled_departure`, `scheduled_arrival` (ve isteğe bağlı actual) DB’ye yazılır. | — |
| Liste açılır | `flights` tablosundan okunur. | **Sadece** `scheduled_departure` / `scheduled_arrival` formatlanır (TR 19:25 gibi). |
| Güncelle (kaydır / pull) | `fetchFlightByNumber` → FR24 (→ gerekirse AE). Status ve isteğe bağlı scheduled/actual DB’ye yazılır. | Yine **sadece** scheduled. Actual hiç gösterilmez. |
| Cron | FR24 ile status ve actual_* güncellenir. | Ekran yine scheduled kullanır. |
| Uçuş silinene kadar | Scheduled sadece API’den **farklı** bir scheduled geldiğinde değişir. | Hep planlanan kalkış/iniş saatleri. |

Böylece PC2794 için de “İndi” görünse bile ekrandaki varış saati **planlanan iniş saati** (scheduled_arrival) olur; TR 19:25 ise DB’deki `scheduled_arrival` doğru (UTC’ye çevrilince 19:25 TR) ise ekranda hep 19:25 görünür.
