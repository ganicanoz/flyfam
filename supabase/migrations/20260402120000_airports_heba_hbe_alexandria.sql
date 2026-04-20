-- Borg El Arab (ICAO HEBA / IATA HBE) — İskenderiye; eski CSV satırında icao_code yanlışlıkla HEAX yazılmıştı.
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
  'HEBA',
  'HBE',
  'Borg El Arab International Airport',
  'Alexandria',
  'EG',
  'Africa/Cairo',
  'Borg El Arab Uluslararası Havalimanı',
  'İskenderiye',
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
