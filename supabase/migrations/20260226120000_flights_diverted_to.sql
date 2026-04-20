-- Store diverted-to airport (IATA) when flight_status = 'diverted' from Aviation Edge / API
alter table public.flights
  add column if not exists diverted_to text;

comment on column public.flights.diverted_to is 'IATA code of airport where flight was diverted to, when flight_status is diverted';
