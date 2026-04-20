-- Prevent duplicate flights: one row per (crew_id, flight_number, flight_date).
-- First remove existing duplicates (keep row with latest updated_at per group).

DELETE FROM public.flights
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY crew_id, flight_number, flight_date
        ORDER BY updated_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM public.flights
  ) sub
  WHERE sub.rn > 1
);

ALTER TABLE public.flights
  DROP CONSTRAINT IF EXISTS flights_crew_number_date_unique;

ALTER TABLE public.flights
  ADD CONSTRAINT flights_crew_number_date_unique
  UNIQUE (crew_id, flight_number, flight_date);

comment on constraint flights_crew_number_date_unique on public.flights is
  'One roster entry per crew per flight number per date; prevents duplicate adds.';
