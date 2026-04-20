-- Marseille Provence (ICAO LFML / IATA MRS) — şehir: Marseille / Marsilya (FR24/CSV bazen Marignane yazar).
insert into public.airports (
  icao,
  iata,
  name,
  city,
  country_iso,
  timezone_iana,
  name_tr,
  city_tr,
  fetched_at
)
values (
  'LFML',
  'MRS',
  'Marseille Provence Airport',
  'Marseille',
  'FR',
  'Europe/Paris',
  'Marsilya Provence Uluslararası Havalimanı',
  'Marsilya',
  now()
)
on conflict (icao) do update set
  iata = excluded.iata,
  name = excluded.name,
  city = excluded.city,
  country_iso = excluded.country_iso,
  timezone_iana = excluded.timezone_iana,
  name_tr = excluded.name_tr,
  city_tr = excluded.city_tr,
  fetched_at = excluded.fetched_at;
