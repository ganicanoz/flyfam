# PC1029 — DB'de kontrol ve ne görünmeli

## DB'de ne var?

Supabase Dashboard → **SQL Editor** veya **Table Editor** kullan.

### SQL ile tek uçuş (PC1029)

```sql
SELECT id, flight_number, flight_date, flight_status,
       scheduled_departure, scheduled_arrival, actual_departure, actual_arrival,
       updated_at
FROM public.flights
WHERE UPPER(TRIM(flight_number)) = 'PC1029'
ORDER BY flight_date DESC;
```

- **0 satır:** PC1029 daha önce otomatik silindi; tekrar "Uçuş Ekle" ile eklemen gerekir.
- **1+ satır:** O satırlarda şunlara bak:

| Alan | Havadayken (beklenen) | İndikten sonra |
|------|------------------------|-----------------|
| `flight_status` | `en_route` (veya `departed` / `taxi_out`) | `landed` veya `parked` |
| `actual_arrival` | `NULL` | Dolu (timestamp) |
| `scheduled_arrival` | Dolu (planlanan varış) | Dolu |

## Uygulamada ne görünmeli?

Roster ekranı **sadece DB'deki** `flight_status` değerini kullanıyor:

- `flight_status = 'en_route'` (veya `departed` / `taxi_out`) → **"Yolda"**
- `flight_status = 'landed'` (veya `parked`) → **"İndi"**
- `flight_status = 'scheduled'` → **"Planlandı"**

Yani:

- **Uçuş hâlâ havadaysa:** DB'de `flight_status = 'en_route'` ve `actual_arrival = NULL` olmalı; uygulama "Yolda" göstermeli.
- **Yanlış "İndi" görünüyorsa:** DB'de `flight_status = 'landed'` yazıyordur; cron düzeltmesi sonraki çalışmada bunu `en_route` yapmalı (AE artık sadece gerçek/tahmini varış varken "landed" diyor).

## Cron ne yazıyor?

`check-flight-status-and-notify` her 5 dakikada:

- FR24 veya AE’den status alır.
- Sadece **actual/estimated arrival** geçtiyse "landed" yazar; yoksa (gecikmeli, hâlâ havada) "en_route" yazar.
- DB’deki `flight_status` (ve gerekirse diğer alanlar) güncellenir.

Özet: PC1029 için DB’de satır yoksa tekrar ekle; varsa yukarıdaki SQL ile `flight_status` ve `actual_arrival` değerlerine bak. Havadayken `en_route` + `actual_arrival = NULL`, uygulamada "Yolda" görünmeli.

---

## Bu mantıkla PC1029 ne oldu?

**Landed kararı (AE fallback):**
- **actual** var ve geçmişte → `landed`
- **actual** yok, **estimated** var ve geçmişte → `landed` (gecikmeli uçuşlarda actual geç gelir)
- Sadece **scheduled** var (actual + estimated yok) → asla `landed` değil, `en_route` kalır

**Akış:** Cron önce FR24 dener; 402/veri yoksa AE timetable. AE’de `arrival.actualTime ?? arrival.estimatedTime` alınır; ikisi de yoksa "landed" atanmaz. Sonuç DB’ye yazılır.

**Kontrol:** (1) DB’de `flight_status`. (2) AE ham veri: `node scripts/check-ae-1029.js 2026-03-18`. (3) Supabase → check-flight-status-and-notify Logs’ta "PC1029" veya "AE timetable" ara.
