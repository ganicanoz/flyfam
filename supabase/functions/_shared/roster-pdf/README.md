# Roster PDF → uçuş satırları

Şu an **yalnızca Pegasus** crew roster PDF’i desteklenir (duty tablosu + `DD.MM.YY` satır formatı).

## Dosya yapısı

| Yol | Açıklama |
|-----|----------|
| `types.ts` | `PdfFlightRow`, `RowScheduleZones` |
| `textUtils.ts`, `timeAndSchedule.ts`, `normalize.ts` | Ortak metin/saat/takvim |
| `occupationLabels.ts` | DUTY / FSF / FOF / STBY / SIM etiketleri |
| `merge.ts` | Birleştirme + hayalet satır temizliği (dışa açılmaz) |
| `parseFlightsFromPdfText.ts` | Ana giriş: normalize → Pegasus + (ileride) diğer şirketler |
| `airlines/pegasus/` | Pegasus satır taraması + duty tablosu parser’ları |
| `airlines/thy/` | THY tarzı satır parser (Pegasus PDF’inde devre dışı; ileride ayrı akış) |
| `public.ts` | Tüm dış API re-export |
| `../pdfRosterImport.ts` | İnce barrel → `public.ts` (mobil + Edge uyumu) |

Yeni şirket: `airlines/<iata-kodu>/` altında parser ekle, `parseFlightsFromPdfText.ts` içinde şirket seçimine bağla (ör. crew profilinde `airline`).
