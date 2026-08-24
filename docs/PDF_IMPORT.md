# PDF roster içe aktarma

## Neden `add_me_to_flight` RPC?

`flights` tablosuna **doğrudan INSERT** yapan eski yol, şema değişikliği sonrası hata veriyor veya listeyi boş gösteriyordu:

- Okuma politikası (RLS): uçuşlar çoğunlukla **`flight_crew`** üzerinden görünür.
- Doğrudan insert **`flight_crew`** satırı eklemediği için roster’da uçuş **görünmez** veya güncellenemez.

**Çözüm:** Her PDF satırı için `add_me_to_flight` — uçuş yoksa oluşturur, `flight_crew`’a ekler; aynı numara+tarih varsa kullanıcıyı ekler ve **gönderilen planı uygular**.

**Önemli (yeniden içe aktarma):** Aynı `flight_number` + `flight_date` satırı zaten varsa, RPC **dolu gelen** `scheduled_departure` / `scheduled_arrival` / `origin` / `destination` / `duty_rest_end` değerleriyle mevcut kaydı **günceller** (`20260321100000_add_me_to_flight_roster_overwrites.sql`). Böylece önceki yanlış import veya API ile dolmuş saatler, script JSON veya doğru PDF ile tekrar içe aktarınca düzelir.

**Yerel saat yorumu:** Kalkış `dep_time_local` → `origin_iata` için `public.airports.timezone_iana`; iniş `arr_time_local` → `destination_iata` TZ. IATA yoksa veya TZ boşsa `Europe/Istanbul` yedek.

**Şimdilik yalnızca uçuş bacakları:** PDF/JSON içe aktarma SIM / FSF / FOF / `duty_off` satırlarını **atlar** (sayı kullanıcıya bildirilir).

**Son ekleyen:** `add_me_to_flight` güncellemesinde `crew_id` son çağıran crew olur; uçuş satırı global tek (`flights_number_date_unique`), plan/rota tüm crew için aynı kalır (`20260321120000_add_me_to_flight_last_writer_crew_id.sql`).

## Kod

- **Tek parser kaynağı:** `supabase/functions/_shared/roster-pdf/` (Pegasus: `airlines/pegasus/`) → `mobile/lib/pdfRosterImport.ts` re-export; Edge sadece metin çıkarır
- **RPC içe aktarma:** `mobile/lib/pdfRosterImport.ts` (`importPdfFlightsViaRpc` + re-export)
- **Uygulama PDF girişi:** `mobile/lib/rosterPdfParse.ts` — Edge `parse-roster-pdf` → `{ text, flights }` (önce sunucu `flights`, yoksa `text` + istemci parse); hata olursa `expo-pdf-text-extract` + istemci parser
- Ekranlar: `mobile/screens/AddFlight.tsx`, `mobile/app/(app)/(crew)/add-flight.tsx`

### Edge function deploy (script ile bire bir metin)

Uygulama içi import’un script’teki gibi doğru **tarih / PC / SAW–FRA / dep–arr** üretmesi için:

```bash
cd /path/to/FLYFAM
supabase functions deploy parse-roster-pdf
```

JWT doğrulaması açık (`config.toml`); kullanıcı oturumlu olmalı. Deploy yoksa uygulama yerel extract’e düşer (satır kırılımı farklı olabilir).

## Parser

- **Pegasus:** `DD.MM.YYYY` + satırlarda `PC 123` / `PC123`; tarih sonraki satırlara taşınır.
- **THY / benzeri:** `15MAR2025` + `TK1234`; tarih **önceki satırlardan** da uygulanır.

**Saatler (aynı satır):**

- `HH:MM` veya `HH.MM` (ikincisi `20.03.2025` gibi tarihlerle çakışmaz).
- Birden fazla saat varsa sırayla **kalkış → iniş** kabul edilir.
- İniş saati kalkıştan küçükse (ör. gece uçuşu) iniş tarihine **+1 gün** eklenir (UTC hesabında).

**Saat dilimi:** PDF’teki saatler **Türkiye duvar saati (UTC+3)** kabul edilir; DB’ye `timestamptz` UTC olarak yazılır. Başka ülke roster’ı için parser/offset ayrı genişletilebilir.

**Duty tablosu (Date(L) / Flight No / Departure(L) / Arrival(L)):** `pdf-parse` çıktısında bu PDF’lerde çoğu zaman **tek satırda değil**, şu blok halinde gelir:

1. Tarih + duty başlangıcı **bitişik**: `22.03.2615:25DUTY` (= 22.03.26 ve 15:25). Aynı desen **`FSF`**, **`FOF`**, **`STBY`**, **`STBYA2`** vb. occupation kodlarıyla da çalışır (`18.03.2603:01FSF` gibi). `STBY` ile başlayan tüm kodlar etikette **Standby** sayılır (A2/B/D şirket ekleri yok sayılır).
2. Alt satırlar: `PC 997` → `SAW` → `16:35` → `FRA` → `17:50` (IATA ve saat ayrı satırlarda). `SAW(OD)` gibi ekler ayıklanır.

**Simülatör (SIM):** Bazı roster’larda satır **4 haneli yıl** ile gelir: `07.04.202617:45OPC3-SIM` (tarih + yapışık saat + `…SIM` ile biten occupation). Hemen altında **iki çift** `DD/MM/YYYY` + saat (`HH:MM` veya `HH:MM:SS`) satırı gelir; bunlar PDF’teki **Duty Start / Duty End** sütunlarına karşılık gelir ve parser’da `duty_slash_*` + `duty_end_*` alanlarına yazılır. Bitişik satırdaki saat `duty_start_time_local` olarak da saklanır.

- **Uçuş görevi** (`DUTY` vb.) için aynı slash blokları farklı anlama gelir: **ilk çift = duty end**, **ikinci çift = resting end** (`duty_end_*`, `duty_rest_end_*`).
- SIM satırları `roster_entry_kind: 'sim'` ile üretilir; `flight_number` genelde PDF occupation (örn. `OPC3-SIM`). **`add_me_to_flight`** ile `flights.roster_entry_kind = sim` olarak kaydedilir (görev başı/sonu `scheduled_*` sütunlarında). Profilde “Simülatörler” kapalıysa listede gizlenir.

**FSF / FOF:** Uçuş satırı yoksa (yalnızca slash blokları varsa) `roster_entry_kind: 'duty_off'`, `flight_number: 'FSF'` veya `'FOF'` satırı üretilir. Uygulamada Türkçe etiket her ikisi için **Boş Gün** (FOF = double off, FSF = single off). PDF’teki **yapışık satır saati** = görev başlangıcı; **ilk slash çifti** = görev sonu; **ikinci çift** = dinlenme sonu. DB’de `flights.roster_entry_kind = duty_off` olur; `scheduled_departure` / `scheduled_arrival` bu görev penceresini tutar (uçuşlardaki kalkış/iniş anlamında değil). Normal **DUTY + PC…** satırlarında kalkış/iniş yine **dep/arr** (IATA blok) üzerinden kalır.

Tek satırda `SAW 16:35` olan başka PDF’ler için aynı modülde **satır-içi fallback** da var.

(L) sütunları şirket ekranında indirme bölgesine göre gösterilir; **Türkiye’den alınan PDF** için bu saatler **aynı TR zaman çizgisinde** yorumlanır.

**Güzergâh (opsiyonel):** Aynı satırda `IST-SAW`, `IST/SAW`, `IST → SAW` gibi **3 harf IATA** çifti varsa `origin` / `destination` doldurulur.

Gürültüyü azaltmak için uçuş numarası **IATA tarzı** filtrelenir (`isLikelyFlightNumber`).

## Hata ayıklama

Geliştirme modunda PDF’den **0 uçuş** çıkarsa Metro konsolunda `[PDF import] Parsed 0 flights. Text sample:` ile metnin ilk ~900 karakteri loglanır; formata göre parser genişletilebilir.

### `Could not find the function public.add_me_to_flight(...) in the schema cache`

Bu, **Supabase’te** `add_me_to_flight` RPC’sinin yok olduğu veya eski bir imza kaldığı anlamına gelir (uygulama güncel, veritabanı migration’ları eksik).

1. Projede: `supabase/migrations` içindeki migration’ları bağlı projeye uygula: `supabase db push` veya Dashboard → **SQL** ile ilgili dosyaları sırayla çalıştır.
2. Özellikle `flights.roster_entry_kind` / `duty_rest_end` sütunları ve **birleşik** `add_me_to_flight` (8 parametre, son ikisi default) tanımı gerekir; repo’da `20260320140000_add_me_to_flight_unified_eight_args.sql` eski 6/8 overload karışıklığını toparlar.
3. Migration’dan birkaç dakika sonra hata sürerse Dashboard’da **Project Settings → API** bölümünde şema yenilemesi / kısa süre bekleme (PostgREST önbelleği) denenebilir.

## Script vs telefon

- **Hedef:** Edge `parse-roster-pdf` **`pdf-parse`** ile metin çıkarır ve sunucuda `parseFlightsFromPdfText` çalıştırır → `{ text, flights }`. Uygulama **varsa önce `flights`** kullanır (simulator/script ile aynı metin+parser); yalnızca eski deploy veya yalnız `text` gelirse istemcide parse eder. Edge yoksa yine yerel extract (metin farklı olabilir).
- Edge yok / hata olursa yedek: `expo-pdf-text-extract` + `normalizePdfTextForRosterParse` + parser (satır kırılımı farklı olabilir).

### Pegasus satır-taraması ve “hepsi 4 Nisan” sapması

Duty PDF’lerinde gövdede geçen `04.04.26` / `04.04.2026` (slash tabloları vb.) eski `\b` taramasıyla **lastDate** oluyor, sonraki tüm `PC…` satırları o güne yazılıyordu. Bunun için:

- `tryPegasusLineAnchorDate`: tarih yalnızca **satır başı** veya `22.03.2615:25DUTY` gibi **duty başlığı**ndan alınır.
- Duty roster belgesinde **en az bir duty/sim/fsf satırı** çıktıysa Pegasus satır-parser tamamen devre dışı; uçuş tarihleri yalnızca duty blok `pendingDate` ile gelir.

Parser değişince Edge function’ı yeniden deploy et: `supabase functions deploy parse-roster-pdf`.

## Expo Go

`expo-pdf-text-extract` native modül gerektirir; **Expo Go’da PDF import çalışmaz** — dev build / production build gerekir.

## Komut satırından önizleme (aynı parser)

Telefona yüklemeden PDF’te ne çıktığını görmek için (`mobile` klasörü):

```bash
cd mobile
npm install
npm run pdf:roster -- /tam/yol/roster.pdf
# ham metin özeti:
npx tsx scripts/pdf-roster-preview.ts /tam/yol/roster.pdf --text
```

Çıktı: Pegasus / THY ara sayıları, birleşik liste, tablo + JSON.  
**Uyarı:** Burada metin `pdf-parse` ile gelir; uygulamadaki `expo-pdf-text-extract` bazen farklı satır sonları verir — sonuçlar yakın ama birebir olmayabilir.

### Uygulamada script ile %100 aynı liste

**Uçuş Ekle** ekranında **「Script JSON (pdf:roster çıktısı)」**: `[ ... ]` dizisini veya tek bir `{ "flight_number": "PC4042", "flight_date": "...", "dep_time_local": "...", ... }` nesnesini yapıştır → `add_me_to_flight` ile eklenir/güncellenir (`dep_time_local` / `arr_time_local` TR duvar saatinden UTC’ye; `origin_iata` / `destination_iata` rota; varsa `duty_rest_end_*` → `duty_rest_end`). PDF/Edge sorunlarından bağımsız.
