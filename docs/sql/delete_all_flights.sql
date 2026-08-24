-- Tüm uçuşları ve flight_crew bağlarını siler. GERİ ALINAMAZ.
-- Supabase SQL Editor veya: psql … < delete_all_flights.sql
-- Başka tablolar flights’a FK ile bağlıysa önce onları temizlemeniz veya CASCADE gerekebilir.

begin;

delete from public.flight_crew;
delete from public.flights;

commit;

-- Doğrulama:
-- select count(*) from public.flights;
-- select count(*) from public.flight_crew;
