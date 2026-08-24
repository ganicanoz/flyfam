-- self-heal hatası yüzünden flight_status 'landed' / 'parked' yapılmış iptal uçuşlarını düzelt.
-- Supabase SQL Editor'da çalıştır; WHERE koşullarını kendi uçuşuna göre daralt.
--
-- 1) Demo seed (PC1 = iptal): bugünün tarihi + sadece yanlışlıkla landed olanları düzelt
update public.flights
set
  flight_status = 'cancelled',
  internal_status = 'cancelled'
where flight_number = 'PC1'
  and flight_date = (timezone('utc', now()))::date
  and flight_status in ('landed', 'parked');

-- 2) Aynı crew için tüm PC1 kayıtları (tarih farklı demo'lar varsa) — isteğe bağlı:
-- update public.flights f
-- set flight_status = 'cancelled', internal_status = 'cancelled'
-- from public.crew_profiles c
-- where f.crew_id = c.id
--   and c.user_id = '58e63a65-999d-4bba-9885-e7df05ff5ef8'::uuid
--   and f.flight_number = 'PC1'
--   and f.flight_status in ('landed', 'parked');

-- 3) Genel: belli bir id (app veya Dashboard'dan kopyala)
-- update public.flights
-- set flight_status = 'cancelled', internal_status = 'cancelled'
-- where id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid
--   and flight_status in ('landed', 'parked');
