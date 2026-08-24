# AirLabs Data API — Kapsamlı rehber (v9)

Bu dosya [AirLabs resmi dokümantasyonu](https://airlabs.co/docs/) özetlenerek hazırlanmıştır. Entegrasyon veya planlama için el altı referans; ücretlendirme, kota ve “Free plan” kısıtları için her zaman [airlabs.co](https://airlabs.co/) güncel sayfalarına bakın.

---

## 1. Ortak bilgiler

| Konu | Açıklama |
|------|----------|
| **Base URL** | `https://airlabs.co/api/v9/` |
| **Sürüm** | v9 (eski sürümler ayrı; dokümanda “old” linki) |
| **Kimlik doğrulama** | Çoğu çağrıda query parametresi `api_key=...` veya imza: `signature=api_id:timestamp:md5(timestamp:api_key)` (3 dk geçerli). `api_id` yanıtlarda `request.key` altında dönebilir. |
| **Yöntem** | Dokümantasyon örnekleri GET ve POST (form) ile; pratikte GET + query yaygın. |
| **Format** | Varsayılan JSON. `.json` / `.xml` / `.csv` soneki ile format seçilebilir. |
| **Ortak query** | `_fields` — dönüş alanlarını daralt (virgülle). Bazı uçlarda `_view` (örn. `array`). |
| **Yanıt gövdesi** | Çoğu yanıtta `response` anahtarı (dizi veya tek obje) ve isteğe bağlı `request` meta bilgisi bulunur. Hata: `{"error":{"code":"...","message":"..."}}`. |

### Sık görülen hata kodları

`unknown_api_key`, `expired_api_key`, `unknown_method`, `wrong_params`, `not_found`, `minute_limit_exceeded`, `hour_limit_exceeded`, `month_limit_exceeded`, `internal_error`

---

## 2. Endpoint indeksi

| Endpoint | Tür | Doküman |
|----------|-----|---------|
| `ping` | Sağlık / anahtar testi | [Introduction](https://airlabs.co/docs/) |
| `flights` | Canlı uçuşlar (ADS-B benzeri) | [flights](https://airlabs.co/docs/flights) |
| `schedules` | Havalimanı / havayolu tarifesi (yakın saatler) | [schedules](https://airlabs.co/docs/schedules) |
| `flight` | Tek uçuş özeti (canlı + program birleşik) | [flight](https://airlabs.co/docs/flight) |
| `delays` | Geciken uçuşlar (beta ☆) | [delays](https://airlabs.co/docs/delays) |
| `listen` / `unlisten` / `listeners` / `webhooks` | Uçuş uyarıları (beta ✔, ücretli planda) | [alert](https://airlabs.co/docs/alert) |
| `nearby` | Koordinata göre havalimanı / şehir | [nearby](https://airlabs.co/docs/nearby) |
| `suggest` | İsim otomatik tamamlama | [suggest](https://airlabs.co/docs/suggest) |
| `airlines` | Havayolu veritabanı | [airlines](https://airlabs.co/docs/airlines) |
| `airports` | Havalimanı veritabanı | [airports](https://airlabs.co/docs/airports) |
| `cities` | Şehir (metropol IATA) veritabanı | [cities](https://airlabs.co/docs/cities) |
| `fleets` | Filo / uçak kayıtları | [fleets](https://airlabs.co/docs/fleets) |
| `routes` | Hat veritabanı (statik, gerçek zamanlı durum değil) | [routes](https://airlabs.co/docs/routes) |
| `countries` | Ülke veritabanı | [countries](https://airlabs.co/docs/countries) |
| `timezones` | Saat dilimi listesi | [timezones](https://airlabs.co/docs/timezones) |
| `taxes` | Vergi kodları listesi | [taxes](https://airlabs.co/docs/taxes) |

---

## 3. Servisler (uçuş / canlı)

### 3.1 `GET .../ping`

**Amaç:** API anahtarı ve bağlantı testi.

**Parametreler:** `api_key`

**Sonuç:** Genelde basit onay / meta (`request` içinde anahtar bilgisi vb.).

---

### 3.2 `GET .../flights` — Real-time flights

**Amaç:** Anlık uçuş izleme (konum, hız, durum vb.); harita / filtre kullanımı.

**Örnek:** `https://airlabs.co/api/v9/flights?api_key=KEY`

| Parametre | Zorunlu | Açıklama |
|-----------|---------|----------|
| `api_key` | evet | |
| `bbox` | hayır | Güney-batı lat,lng; kuzey-doğu lat,lng (kutu) |
| `zoom` | hayır | 0–11, yoğunluğu azaltmak için |
| `hex` | hayır | ICAO24 |
| `reg_number` | hayır | Kuyruk tescili |
| `airline_icao` / `airline_iata` | hayır | |
| `flag` | hayır | Havayolu ülke ISO-2 |
| `flight_icao` / `flight_iata` / `flight_number` | hayır | |
| `dep_icao` / `dep_iata` / `arr_icao` / `arr_iata` | hayır | |
| `_fields` | hayır | Virgülle alan listesi |
| `_view` | hayır | `object` (varsayılan) veya `array` |

**Sonuç (tipik alanlar):** `hex`, `reg_number`, `flag`, `lat`, `lng`, `alt`, `dir`, `speed`, `v_speed`, `squawk`, `airline_icao`, `airline_iata`, `aircraft_icao`, `flight_icao`, `flight_iata`, `flight_number`, `dep_icao`, `dep_iata`, `arr_icao`, `arr_iata`, `updated`, `status` (`scheduled` / `en-route` / `landed` vb.).

---

### 3.3 `GET .../schedules` — Airport schedules

**Amaç:** Belirli havalimanı veya havayolu için **yakın vadeli** kalkış/varış listesi (dokümanda en fazla ~10 saat ileri).

**Örnek:** `.../schedules?dep_iata=MIA&api_key=KEY`

| Parametre | Not |
|-----------|-----|
| `dep_iata` / `dep_icao` / `arr_iata` / `arr_icao` | Sorgu tipine göre (kalkış veya varış havalimanı) |
| `airline_iata` / `airline_icao` | Havayolu filtresi veya havalimanı sorgusunda çoklu filtre |
| `flight_icao` / `flight_iata` | Tek hat araması |
| `limit` | Üst sınır (havalimanı: max 1000; havayolu: 200; Free: 50) |
| `offset` | Sayfalama |
| `_fields` | Alan kısıtı |

**Sonuç:** Uçuş dizisi — `airline_*`, `flight_*`, `cs_*` (codeshare), `dep_*` / `arr_*` (terminal, gate, zamanlar: yerel + UTC + Unix `*_ts`), `duration`, `delayed` (deprecated), `dep_delayed`, `arr_delayed`, `status` (`scheduled`, `cancelled`, `active`, `landed`).

---

### 3.4 `GET .../flight` — Flight information (tek kayıt)

**Amaç:** Bir `flight_iata` veya `flight_icao` için **birleşik** özet: program + canlı/son bilgi; uçak detayı (model, motor vb.) gelebilir.

**Parametreler:** `api_key` + (`flight_iata` **veya** `flight_icao`)

**Sonuç:** Tek obje — schedules + flights + fleet bilgisinin karışımı; ek alanlar ör. `dep_name`, `dep_city`, `percent`, `eta`, `utc` (AirLabs’in ek progress alanları; tam liste canlı yanıta bağlı).

---

### 3.5 `GET .../delays` — Flight delays (beta ☆)

**Amaç:** Minimum gecikme eşiğini aşan kalkış veya varış uçuşları.

**Örnek:** `.../delays?delay=60&type=departures&api_key=KEY`

| Parametre | Açıklama |
|-----------|----------|
| `delay` | evet — minimum gecikme (dakika, min. 30) |
| `type` | evet — `departures` veya `arrivals` |
| `dep_iata`, `dep_icao`, `arr_iata`, `arr_icao`, `airline_*`, `flight_*`, `flight_number` | isteğe bağlı filtreler |
| `limit` | varsayılan max 500; Free: 50 |
| `offset` | sayfalama |

**Sonuç:** Schedules’a benzer satırlar; öne çıkan: `delayed` (dakika).

---

## 4. Uyarı API’leri (beta ✔ — ücretli erişim)

Kaynak: [Flight Alert](https://airlabs.co/docs/alert)

| Endpoint | Amaç | Önemli parametreler | Tipik sonuç |
|----------|------|---------------------|-------------|
| `listen` | Webhook ile değişiklik dinleme | `webhook_url` (zorunlu), `airline_iata` / `flight_number` / `dep_iata` / `arr_*` / tarih-saat, `_fields` (hangi alan değişimlerinde bildir) | `{ "listener_id": 99 }` |
| `unlisten` | Dinleyiciyi kaldır | `listener_id` | `{ "unlistened": true }` |
| `listeners` | Açık dinleyicileri listele | `api_key` | (dokümanda liste formatı) |
| (Webhook gövdesi) | Sunucunuza POST | — | `listener_id`, `changed[]`, `flight{...}` — alan açıklamaları [schedules](https://airlabs.co/docs/schedules) ile uyumlu |
| `webhooks` | Gönderilen webhook geçmişi | `days` (örn. 10) | `webhook_id`, `res_status`, `changed`, `flight`, … |

Webhook çağrıları kotanızdan düşer; AirLabs [webhook IP listesi](https://airlabs.co/webhook_ips.txt) ile whitelist önerilir.

---

## 5. Coğrafi ve arama

### 5.1 `GET .../nearby`

**Parametreler:** `lat`, `lng`, `distance` (km, zorunlu üçlü), `lang`, `_fields`

**Sonuç:** `{ "airports": [...], "cities": [...] }` — her öğede `distance` (km); alanlar airports/cities API ile uyumlu (`iata_code`, `icao_code`, `name`, `timezone`, `slug`, `popularity` vb.).

---

### 5.2 `GET .../suggest` — Autocomplete

**Parametreler:** `q` veya `query` / `s` / `search` / `text` / `term` (3–30 karakter), `lang`, `_fields`

**Sonuç:** Gruplar: `airports`, `cities`, `countries`, `cities_by_airports`, `airports_by_cities`, `airports_by_countries`, `cities_by_countries` — kısmi eşleşmeler.

---

## 6. Veritabanı endpoint’leri

Genel: `api_key` zorunlu; çoğunda `_fields` ile alan seçimi; liste dönenlerde `limit` / `offset` / `request.has_more` (dokümana göre).

### 6.1 `airlines`

**Filtreler:** `iata_code`, `iata_prefix`, `iata_accounting`, `icao_code`, `callsign`, `name`, `country_code`

**Sonuç (örnek alanlar):** `name`, `iata_code`, `icao_code`, `callsign`, `country_code`, `iosa_registered`, `is_scheduled`, `is_passenger`, `is_cargo`, `is_international`, `total_aircrafts`, `average_fleet_age`, `accidents_last_5y`, `crashes_last_5y`, sosyal / `website`, `slug`

Logo URL örnekleri: `https://airlabs.co/img/airline/m/AA.png` (dokümanda).

---

### 6.2 `airports`

**Filtreler:** `iata_code`, `icao_code`, `city_code`, `country_code`

**Sonuç (örnek):** `name`, `iata_code`, `icao_code`, `lat`, `lng`, `alt` (feet), `city`, `city_code`, `un_locode`, `timezone`, `country_code`, `names{...}`, `runways`, `departures`, `connections`, `is_major`, `is_international`, `slug`, iletişim alanları.

---

### 6.3 `cities`

**Filtreler:** `city_code`, `country_code`

**Sonuç:** `name`, `city_code`, `un_locode`, `lat`, `lng`, `alt`, `timezone`, `country_code`, `population`, `names`, `wikipedia`, `slug`

---

### 6.4 `fleets`

**Filtreler:** `airline_iata`, `airline_icao`, `hex`, `reg_number`, `msn`, `flag`; `limit` (max 500, Free 50), `offset`

**Sonuç:** Uçak kaydı + isteğe bağlı son konum: `hex`, `reg_number`, `flag`, `airline_*`, `icao`/`iata` (tip), `model`, `manufacturer`, `msn`, `line`, `type`, `category` (wake), `engine`, `engine_count`, `built`, `age`, `lat`, `lng`, `alt`, `dir`, `speed`, `v_speed`, `squawk`, `last_seen` (dokümanda: geo sadece belirli filtrelerle).

---

### 6.5 `routes`

**Not:** Statik hat programı; **anlık uçuş durumu değildir**. `schedules` ile uzun vadeli tahmin için kullanım önerilir.

**Filtreler (sorgu senaryosuna göre):** `dep_iata` / `dep_icao`, `arr_iata` / `arr_icao`, `airline_iata` / `airline_icao`, isteğe bağlı `flight_*`, `flight_number`, `limit`, `offset`

**Sonuç:** `airline_*`, `flight_*`, `cs_*`, `dep_*`, `arr_*`, `dep_time` / `dep_time_utc`, `arr_time` / `arr_time_utc`, `dep_terminals[]`, `arr_terminals[]`, `duration`, `days[]` (`mon`…`sun`), `aircraft_icao`, `updated`

---

### 6.6 `countries`

**Filtreler:** `code` (ISO-2), `code3`, `continent` (AF, AN, AS, EU, NA, OC, SA)

**Sonuç:** `name`, `code`, `code3`, `population`, `continent`, `currency`, `names`

---

### 6.7 `timezones`

**Parametre:** çoğunlukla sadece `api_key`

**Sonuç:** `[{ "timezone", "country_code", "gmt", "dst" }, ...]`

---

### 6.8 `taxes`

**Parametre:** `api_key`

**Sonuç:** `[{ "code", "name" }, ...]` — açıklamalar İngilizce.

---

## 7. Her servis için örnek kod + gelen bilgiler

Tüm örneklerde `KEY` yerine kendi anahtarını kullan.

### 7.1 `ping`

```bash
curl -s "https://airlabs.co/api/v9/ping?api_key=KEY"
```

```js
const r = await fetch("https://airlabs.co/api/v9/ping?api_key=" + process.env.AIRLABS_API_KEY);
const j = await r.json();
console.log(j);
```

**Gelen bilgiler:** servis erişimi/anahtar doğrulama sonucu, tipik olarak `request` metası.

### 7.2 `flights` (real-time)

```bash
curl -s "https://airlabs.co/api/v9/flights?flight_iata=PC130&api_key=KEY"
```

```js
const url = "https://airlabs.co/api/v9/flights?flight_iata=PC130&api_key=" + process.env.AIRLABS_API_KEY;
const j = await (await fetch(url)).json();
console.log(j.response ?? j);
```

**Gelen bilgiler (tipik):** `hex`, `reg_number`, `lat`, `lng`, `alt`, `dir`, `speed`, `v_speed`, `airline_*`, `flight_*`, `dep_*`, `arr_*`, `updated`, `status`.

### 7.3 `schedules`

```bash
curl -s "https://airlabs.co/api/v9/schedules?dep_iata=SAW&limit=20&api_key=KEY"
```

```js
const url = "https://airlabs.co/api/v9/schedules?dep_iata=SAW&limit=20&api_key=" + process.env.AIRLABS_API_KEY;
const j = await (await fetch(url)).json();
console.log((j.response ?? []).slice(0, 3));
```

**Gelen bilgiler:** `airline_*`, `flight_*`, `cs_*`, `dep_*` (gate/terminal/time/estimated/actual + UTC + ts), `arr_*`, `duration`, `delayed`, `dep_delayed`, `arr_delayed`, `status`.

### 7.4 `flight` (tek uçuş)

```bash
curl -s "https://airlabs.co/api/v9/flight?flight_iata=PC130&api_key=KEY"
```

```js
const url = "https://airlabs.co/api/v9/flight?flight_iata=PC130&api_key=" + process.env.AIRLABS_API_KEY;
const j = await (await fetch(url)).json();
console.log(j.response ?? j);
```

**Gelen bilgiler:** schedule + live + uçak birleşik detay; örn. `flight_*`, `airline_*`, `dep_*`, `arr_*`, `status`, `duration`, `reg_number`, `aircraft_icao`, `updated`, bazen `percent`, `eta`, `utc`.

### 7.5 `delays`

```bash
curl -s "https://airlabs.co/api/v9/delays?delay=60&type=departures&dep_iata=SAW&api_key=KEY"
```

```js
const url = "https://airlabs.co/api/v9/delays?delay=60&type=departures&dep_iata=SAW&api_key=" + process.env.AIRLABS_API_KEY;
const j = await (await fetch(url)).json();
console.log(j.response ?? []);
```

**Gelen bilgiler:** schedules benzeri satırlar + gecikme odaklı alanlar (`delayed`, `dep_delayed`, `arr_delayed`).

### 7.6 `listen` / `unlisten` / `listeners` / `webhooks`

```bash
# listen
curl -s "https://airlabs.co/api/v9/listen?webhook_url=https://example.com/hook&airline_iata=PC&flight_number=130&api_key=KEY"

# unlisten
curl -s "https://airlabs.co/api/v9/unlisten?listener_id=99&api_key=KEY"

# listeners
curl -s "https://airlabs.co/api/v9/listeners?api_key=KEY"

# webhooks history
curl -s "https://airlabs.co/api/v9/webhooks?days=7&api_key=KEY"
```

```js
const key = process.env.AIRLABS_API_KEY;
const listen = await (await fetch(`https://airlabs.co/api/v9/listen?webhook_url=https://example.com/hook&airline_iata=PC&flight_number=130&api_key=${key}`)).json();
console.log(listen); // { listener_id: ... }
```

**Gelen bilgiler:** `listener_id`, `unlistened`, listener listesi; webhook payload’ında `changed[]` + `flight{...}`.

### 7.7 `nearby`

```bash
curl -s "https://airlabs.co/api/v9/nearby?lat=40.9&lng=29.3&distance=50&api_key=KEY"
```

```js
const url = "https://airlabs.co/api/v9/nearby?lat=40.9&lng=29.3&distance=50&api_key=" + process.env.AIRLABS_API_KEY;
const j = await (await fetch(url)).json();
console.log(j.response ?? j); // airports + cities
```

**Gelen bilgiler:** `airports[]`, `cities[]`, öğelerde `distance`, `name`, `iata_code`, `icao_code`, `timezone`, `slug` vb.

### 7.8 `suggest`

```bash
curl -s "https://airlabs.co/api/v9/suggest?q=istanbul&api_key=KEY"
```

```js
const url = "https://airlabs.co/api/v9/suggest?q=istanbul&api_key=" + process.env.AIRLABS_API_KEY;
const j = await (await fetch(url)).json();
console.log(j.response ?? j);
```

**Gelen bilgiler:** `airports`, `cities`, `countries`, `cities_by_airports`, `airports_by_cities`, `airports_by_countries`, `cities_by_countries`.

### 7.9 `airlines`

```bash
curl -s "https://airlabs.co/api/v9/airlines?iata_code=PC&api_key=KEY"
```

**Gelen bilgiler:** havayolu kimlik/veri alanları (`name`, `iata_code`, `icao_code`, `callsign`, `country_code`, filo/operasyon metrikleri, sosyal linkler, `slug`).

### 7.10 `airports`

```bash
curl -s "https://airlabs.co/api/v9/airports?iata_code=SAW&api_key=KEY"
```

**Gelen bilgiler:** meydan bilgisi (`name`, `iata_code`, `icao_code`, `lat`, `lng`, `timezone`, `city`, `country_code`, `runways`, `is_international`, `names`, `slug`).

### 7.11 `cities`

```bash
curl -s "https://airlabs.co/api/v9/cities?city_code=IST&api_key=KEY"
```

**Gelen bilgiler:** şehir bilgisi (`name`, `city_code`, `lat`, `lng`, `timezone`, `country_code`, `population`, `names`, `wikipedia`, `slug`).

### 7.12 `fleets`

```bash
curl -s "https://airlabs.co/api/v9/fleets?airline_iata=PC&limit=50&api_key=KEY"
```

**Gelen bilgiler:** uçak/filo kayıtları (`hex`, `reg_number`, `airline_*`, `icao`/`iata`, `model`, `manufacturer`, `msn`, `engine*`, `built`, `age`, isteğe bağlı son geo alanları).

### 7.13 `routes`

```bash
curl -s "https://airlabs.co/api/v9/routes?airline_iata=PC&dep_iata=SAW&arr_iata=ESB&api_key=KEY"
```

**Gelen bilgiler:** statik rota ve operasyon günleri (`flight_*`, `dep_time`, `arr_time`, `days[]`, `duration`, terminal listeleri, `aircraft_icao`, `updated`).

### 7.14 `countries`

```bash
curl -s "https://airlabs.co/api/v9/countries?code=TR&api_key=KEY"
```

**Gelen bilgiler:** ülke verileri (`code`, `code3`, `name`, `continent`, `currency`, `population`, çok dilli `names`).

### 7.15 `timezones`

```bash
curl -s "https://airlabs.co/api/v9/timezones?api_key=KEY"
```

**Gelen bilgiler:** saat dilimi listesi (`timezone`, `country_code`, `gmt`, `dst`).

### 7.16 `taxes`

```bash
curl -s "https://airlabs.co/api/v9/taxes?api_key=KEY"
```

**Gelen bilgiler:** vergi kodları (`code`, `name`).

---

## 8. Hızlı örnek komut seti (kısa)

```bash
curl -s "https://airlabs.co/api/v9/ping?api_key=KEY"
curl -s "https://airlabs.co/api/v9/flight?flight_iata=PC130&api_key=KEY"
curl -s "https://airlabs.co/api/v9/schedules?dep_iata=SAW&limit=10&api_key=KEY"
curl -s "https://airlabs.co/api/v9/flights?flight_iata=PC130&api_key=KEY"
curl -s "https://airlabs.co/api/v9/airports?iata_code=IST&api_key=KEY"
```

---

## 9. Bu repoda ilgili araç

| Dosya | Amaç |
|-------|------|
| `scripts/airlabs-discover-fields.js` | `flight`, `schedules`, `flights` için tablo + isteğe bağlı ham JSON (FlyFam geliştirme) |
| `npm run airlabs:discover -- PC437` | Kök dizinden çalıştırın; `.env` içinde `AIRLABS_API_KEY` |

---

## 10. Sorumluluk reddi

Alan adları ve limitler AirLabs tarafından değişebilir. Üretim kararları için her zaman [https://airlabs.co/docs/](https://airlabs.co/docs/) kaynağını doğrulayın. Bu rehber “Quickstart” veya SLA yerine geçmez.

---

*Son derleme: AirLabs dokümantasyonu v9 yapısına göre (Mart 2026).*
