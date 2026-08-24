# PDF roster → uygulama: adım adım (şimdilik sadece **uçuş görevi / flight**)

Bu doküman, telefondaki PDF’in nasıl metne çevrildiğini ve hangi kurallarla **uçuş satırı** üretildiğini özetler. **Şu an yalnızca Pegasus** crew roster PDF’i hedeflenir (`roster-pdf/airlines/pegasus/`). Örnek: `19.03.26-19.04.26 2.pdf`.

## 1) PDF dosyası cihazdan okunur

- **Ekran:** Uçuş Ekle → «Uçuşları içe aktar».
- **Kod:** `mobile/lib/rosterPdfParse.ts` → `FileSystem.readAsStringAsync(uri, Base64)`.

## 2) Metin çıkarma (script ile aynı sıra)

Aynı dosya için önce **Edge** (önce `fetch`, sonra `invoke`), olmazsa **yerel**:

| Sıra | Nerede | Motor | Not |
|------|--------|--------|-----|
| 1 | Edge `parse-roster-pdf` (`fetch`) | `pdf-parse` (Node) | Yanıt `{ text }`; `npm run pdf:roster` ile aynı metin motoru. |
| 2 | Aynı endpoint `invoke` | Aynı | `fetch` başarısızsa; JWT + `apikey`. |
| 3 | Yerel fallback | `expo-pdf-text-extract` | Edge yok/başarısız; **satır kırılımı farklı** olabilir. |

Edge: `parse-roster-pdf/index.ts` → `pdfParse(buf)` → JSON `{ text, flights }` (sunucu parser = repo). Uygulama önce `flights` kullanır.

## 3) Ham metin normalize edilir

- **Kod:** `normalizePdfTextForRosterParse` (`supabase/functions/_shared/roster-pdf/normalize.ts`).
- **Amaç:** `SAW16:35` → `SAW 16:35`, yapışık `22.03.2615:25DUTY` satır başına vb.

## 4) Uçuş listesi: `parseFlightsFromPdfText(text)`

Ana birleştirici: **`supabase/functions/_shared/roster-pdf/parseFlightsFromPdfText.ts`**; Pegasus modülleri **`airlines/pegasus/`** altında.

### 4a) Pegasus **duty tablosu** (asıl “flight duty”)

- **Fonksiyon:** `parseFlightsFromPdfText_DutyLocalTableCore`.
- **Ne arar:** Satırda `GG.AA.YY` + saat + `DUTY` / `FSF` / `FOF` / `STBY…` / `…SIM`; altta slash tarih çiftleri; sonra `PC 1234` gibi satır ve **4 satır:** dep IATA, dep saat, arr IATA, arr saat.
- **Çıkan uçuş satırı:** `roster_entry_kind: 'flight'`, `flight_date` = o duty bloğunun `pendingDate` (tarih satırından).
- **FSF/FOF (Boş Gün):** Uçuş satırı yoksa `roster_entry_kind: 'duty_off'`, `flight_number: 'FSF'|'FOF'` — **uygulama içe aktarmada bunlar bilinçli olarak atlanır.**

### 4b) Pegasus duty PDF: satır taran Pegasus kapatılır, THY bu dosyada **yok**

`looksLikePegasusDutyStylePdf(text)` **ve** `DutyLocalTable`’dan **en az bir satır** geldiyse:

- Satır taramalı **Pegasus** (`parseFlightsFromPdfText_Pegasus`) **çalışmaz** (`lastDate` ile yanlış güne yapışan PC satırları önlenir).
- **THY** (`parseFlightsFromPdfText_THY`) **çalışmaz** — bu repo aşamasında Pegasus PDF’i THY ile karıştırılmaz; THY kullanıcısı ileride ayrı dosya / ayrı akış.

`DutyLocalTable` = **önce tek-satır fallback, sonra çekirdek tablo** — Map birleşiminde çekirdek **son** geldiği için aynı `tarih|uçuş no` anahtarında **DUTY satırı kazanır**. Ardından `dropSingleLineFlightDateGhosts`: çekirdekte o uçuş no için `flight` satırı varken, kind’siz ve **farklı tarihli** hayalet tekrarlar silinir (ör. PC1259’un 20 Mart yerine yanlış güne düşmesi).

Birleşik liste yine `Map` ile `pdfRowDedupeKey` üzerinden tekilleştirilir.

### 4c) İçe aktarma filtresi (sadece uçuş bacakları)

**Kod:** `mobile/lib/pdfRosterImport.ts` → `pickFlightLegRowsForImport`.

- `sim`, `duty_off` → **yok**.
- `FSF`, `FOF`, `SIM`, `STBY…` → **yok**.
- `isLikelyFlightNumber` (ör. `PC2289`) değilse → **yok**.
- `roster_entry_kind` **undefined** olabilir (tek-satır duty çıktısı); yukarıdakiler geçiyorsa **uçuş** sayılır.

## 5) Veritabanı: `add_me_to_flight`

- **Kod:** `importPdfFlightsViaRpc` → her bacak için RPC.
- **Tarih/saat:** `rowToScheduleIso` — kalkış TZ = `origin_iata`, iniş TZ = `destination_iata` (`public.airports.timezone_iana`; yoksa `Europe/Istanbul`).

## Senin PDF’in (`Downloads/…`)

Bu ortam **senin Mac’indeki** `/Users/mineoz/Downloads/...` dosyasını okuyamaz. Yerelde kontrol için:

```bash
cd mobile
npx tsx scripts/pdf-roster-preview.ts "/Users/mineoz/Downloads/19.03.26-19.04.26 2.pdf"
```

Çıktıdaki **birleşik JSON** artık Pegasus duty + çekirdek tablo senaryosunda **yalnızca duty çekirdeğinden** gelen uçuşları (ve parse seviyesinde hâlâ duran FSF/FOF satırlarını, bunlar DB’ye gitmez) gösterir.

## Tüm uçuşları silmek

**Dosya:** `docs/sql/delete_all_flights.sql` — Supabase SQL Editor’da çalıştır (geri alınamaz).
