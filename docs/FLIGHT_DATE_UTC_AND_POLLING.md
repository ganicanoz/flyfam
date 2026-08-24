# Uçuş tarihi (UTC), dash AE backfill ve cron penceresi

## `flight_date` ne anlama geliyor?

- **Hedef:** Liste gruplaması ve FR24/AE sorgularında kullanılan gün, mümkün olduğunda **planlı kalkışın UTC takvim günü** (`scheduled_departure`’ın `YYYY-MM-DD` kısmı).
- PDF/import ile önce sadece roster günü yazılmış olabilir; crew uygulaması veya aile `update-flights-from-api` ile **ilk kez plan saati geldiğinde** tarih, çakışma yoksa (`flights_number_date_unique`) bu UTC güne **otomatik kaydırılır**.

## Dash (saat yok) — AE timetable

- **Sadece bugün UTC:** `scheduled_departure` ve `scheduled_arrival` boş olan uçuşlar için saatlik AE denemesi yalnızca `flight_date === bugün (UTC)` olanlar üzerinde çalışır (`getUtcDateString()`).
- Gelecek günlerdeki dash uçuşlara o gün gelene kadar otomatik AE isteği atılmaz; PDF/manuel saat veya o UTC günü gelince dolar.

## Crew — uygulama içi canlı API penceresi

- `Roster`: `scheduled_departure - 30 dk` ile `(varış + 15 dk)` arasında sessiz yenileme (cron ile aynı “30 dk önce” mantığı).

## Cron — `check-flight-status-and-notify`

- Dışarıda **~5 dakikada bir** tetiklenmeli (cron-job.org vb.).
- **Sorgulanan satırlar:** `scheduled_departure` dolu, `scheduled_departure ∈ [now−48sa, now+30dk]` (indeks yoksa büyük tabloda yavaşlayabilir; gerekirse `scheduled_departure` için indeks eklenir).
- **İşlenen satırlar:** Ayrıca `now ≥ scheduled_departure − 30 dk` ve `flight_status` henüz `landed` / `parked` / `cancelled` / `diverted` değil.
- Planı olmayan uçuşlar cron’da yoktur; önce mobilin bugün-UTC AE backfill’i planı yazmalıdır.
