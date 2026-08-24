# FR24 Airports Light → Supabase

Flightradar24’un **Airports Light** API’sinden havalimanı listesini çekip Supabase `airports` tablosuna yazar.

## FR24 kuralları

- **Storage rule:** FR24 verisi ilk alındıktan sonra **30 günden fazla** saklanmamalı. Bu script’i en az 30 günde bir (tercihen 2 haftada bir) tekrar çalıştırın veya eski veriyi silin.
- API: `GET /api/static/airports/{code}/light` — her havalimanı için ayrı istek (IATA veya ICAO ile).

## Gereksinimler

- `FR24_API_TOKEN` veya `EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN`
- `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY`
- Migration uygulanmış: `supabase/migrations/20260228120000_airports_fr24.sql`

## Çalıştırma

```bash
# Proje kökünden (mobile/node_modules içindeki @supabase/supabase-js kullanılır)
node scripts/sync-fr24-airports.js
```

Veya env dosyası ile:

```bash
export FR24_API_TOKEN=...
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
node scripts/sync-fr24-airports.js
```

`.env` veya `mobile/.env` varsa script otomatik yükler.

## Havalimanı kod listesi

Varsayılan: `scripts/data/airport-codes.txt` — satır başına bir ICAO (4 harf) veya IATA (3 harf). Yorum satırları `#` ile başlar.

- Şu an dosyada `mobile/constants/airports.ts` içindeki ICAO kodları var (~212).
- Tüm dünya listesi için [OurAirports](https://ourairports.com/data/) veya benzeri kaynaktan ICAO listesi alıp aynı formatta ekleyebilirsiniz.
- Farklı dosya kullanmak: `CODES_FILE=./my-codes.txt node scripts/sync-fr24-airports.js`

## Tablo şeması (`public.airports`)

| Kolon           | Açıklama                          |
|-----------------|-----------------------------------|
| `icao` (PK)     | ICAO veya IATA (birincil anahtar) |
| `iata`          | IATA kodu                         |
| `name`          | Havalimanı adı                    |
| `city`          | Şehir                             |
| `country_iso`   | Ülke kodu                         |
| `timezone_iana` | IANA timezone                     |
| `raw_light`     | FR24 ham yanıt (jsonb)            |
| `fetched_at`    | Son çekilme zamanı                |

## Bulk endpoint

FR24 ileride “tüm listeyi tek istekte” veren bir endpoint sunarsa script önce şu adresleri dener:

- `GET /api/static/airports/light`
- `GET /api/airports/light`

Bunlar çalışmazsa `airport-codes.txt` içindeki kodlarla tek tek istek atar.
