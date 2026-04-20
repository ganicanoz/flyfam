-- Fill missing/airport-code city fields from public.airports.
-- Helps notifications and UI show city names instead of IATA (e.g. SZF).

update public.flights f
set origin_city = a.city
from public.airports a
where a.iata is not null
  and upper(trim(f.origin_airport)) = upper(trim(a.iata))
  and a.city is not null
  and trim(a.city) <> ''
  and (
    f.origin_city is null
    or trim(f.origin_city) = ''
    or trim(f.origin_city) ~ '^[A-Z0-9]{3,4}$'
  );

update public.flights f
set destination_city = a.city
from public.airports a
where a.iata is not null
  and upper(trim(f.destination_airport)) = upper(trim(a.iata))
  and a.city is not null
  and trim(a.city) <> ''
  and (
    f.destination_city is null
    or trim(f.destination_city) = ''
    or trim(f.destination_city) ~ '^[A-Z0-9]{3,4}$'
  );
