-- Vnukovo International (ICAO UUWW / IATA VKO), Moscow — Russia UTC+3 (Europe/Moscow).
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
  'UUWW',
  'VKO',
  'Vnukovo International Airport',
  'Moscow',
  'RU',
  'Europe/Moscow',
  'Vnukovo Uluslararası Havalimanı',
  'Moskova',
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
