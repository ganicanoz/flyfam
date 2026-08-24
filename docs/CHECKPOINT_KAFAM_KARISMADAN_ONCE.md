# Checkpoint: “Kafam karışmadan önceki durum” (UTC tarih + dash + cron)

Bu not, **UTC `flight_date` etiketi, dash AE backfill, 30 dk penceresi ve cron sorgu mantığı** değişikliklerinin yapıldığı **son net durum**un özetidir. İleride geri dönmek için:

1. **Git:** Bu dosyanın commit edildiği commit’e dön (`git log -- docs/CHECKPOINT_KAFAM_KARISMADAN_ONCE.md`).
2. **Veya:** Aşağıdaki dosyaları bu commit’teki hallerine çevir.

---

## Davranış özeti

| Konu | Ne yaptık? |
|------|------------|
| **`flight_date`** | Mümkünse planlı kalkışın **UTC takvim günü** (`scheduled_departure`’ın tarih kısmı). Crew `Roster` DB güncellemesinde; aile `update-flights-from-api` içinde. `(flight_number, flight_date)` unique çakışırsa tarih değişmez. |
| **Dash + AE** | Saatlik/sessiz dash yenilemesi **sadece** `flight_date === bugün UTC** (`getUtcDateString()`). |
| **Crew API penceresi** | `scheduled_departure - 30 dk` … varış + 15 dk (`API_WINDOW_START_OFFSET_MS = 30 * 60 * 1000`). |
| **Cron** | `scheduled_departure` dolu; `∈ [now−48s, now+30dk]`; ayrıca `now ≥ dep−30dk`. `landed/parked/cancelled/diverted` atlanır. `flight_date` ile 3 günlük liste kaldırıldı. |
| **Doküman** | `docs/FLIGHT_DATE_UTC_AND_POLLING.md`, `docs/CURRENT_CRON_AND_PUSH_SETUP.md` (ilgili paragraf), `mobile/FLIGHT_LOOKUP_ALGORITHM.md` (dash paragrafı). |

---

## Dokunulan dosyalar

- `mobile/lib/dateUtils.ts` — `getUtcDateString`, `getUtcDateStringPlusDays`
- `mobile/screens/Roster.tsx` — `getDashFlightsUtcToday`, 30 dk pencere, `flight_date` relabel + clash kontrolü, dash çağrıları
- `supabase/functions/check-flight-status-and-notify/index.ts` — yeni liste filtresi + 30 dk + terminal statüler
- `supabase/functions/update-flights-from-api/index.ts` — `scheduled_departure` ile UTC günü `flight_date` hizalama
- `docs/FLIGHT_DATE_UTC_AND_POLLING.md` (yeni)
- `docs/CHECKPOINT_KAFAM_KARISMADAN_ONCE.md` (bu dosya)
- `docs/CURRENT_CRON_AND_PUSH_SETUP.md`
- `mobile/FLIGHT_LOOKUP_ALGORITHM.md`

---

## Geri alma hatırlatması

- Edge Function’ları değiştirdiysen Supabase’te **yeniden deploy** gerekebilir.
- Sadece mobil geri alınırsa cron hâlâ yeni mantıkta çalışır; tam uyum için fonksiyonları da aynı döneme çek.

---

*Not: Sohbet AI’larının kalıcı hafızası yok; geri dönüş için bu repo + git kaynağı doğrudur.*
