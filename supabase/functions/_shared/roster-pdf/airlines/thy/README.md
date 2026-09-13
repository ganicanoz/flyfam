# THY ekip aylık program PDF

Kaynak: `lineScan.ts` — `parseLocalTimeProgramFromPdfText_THY` / `parseFlightsFromPdfText_THY` / `parseDutyFromPdfText_THY`.

## Birincil: LOKAL SAATLI UCUS PROGRAMI

- Dipnot cümlesindeki “LOKAL SAATLI …” değil; satır başı başlık `LOKAL SAATLI UCUS PROGRAMI`.
- Bölüm sonu: `ACIKLAMALAR`.
- Her gün `MB:` bloğu; uçuşlarda `GMB:` tarihleri + `TK###` + `AAA/h:mm` çiftleri.
- Görevler: blok sonu kod (`RC1`, `EMM`, `HSBY`, `CFR`, …) + saat çifti (`IST/8:30` veya `3:00`).
- **Uçuş:** `TK###` + lokal saat çifti.
- **Görev / boş gün:** blok sonundaki kod + saat çifti (`RC1`, `EMM`, `HSBY`, `CFR`, `IBB`, `IBI`, …).
- Kural: lokal tabloda tanınan her satır import edilir; meta/limit satırları ve bilinmeyen token’lar atlanır.
- Saatler **lokal** (`duty_clock_basis: 'local'`); UTC Edge/istemci import’ta IATA TZ ile üretilir.

## Yedek: Kalkış/GMT · İniş/GMT

Lokal bölüm yoksa yalnız uçuş satırları GMT tablosundan okunur (eski davranış). Aylık takvim grid’inden duty üretilmez (tarih kayması).

## Etiketler

`occupationLabels.ts`: `EMM` (E-Learning), `RC1` (Kokpit Yenileme), `HSBY`, `CFR`, … — training kodları `isTrainingOccupationCode` içinde.
