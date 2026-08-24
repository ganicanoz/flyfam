-- Demo roster cleanup: PC1, PC2, PC3
-- Supabase Dashboard -> SQL Editor -> Run

do $$
declare
  d date := (timezone('utc', now()))::date;
begin
  -- First delete join rows to avoid FK issues.
  delete from public.flight_crew fc
  using public.flights f
  where fc.flight_id = f.id
    and f.flight_number in ('PC1', 'PC2', 'PC3')
    and f.flight_date = d;

  -- Then delete flights for today.
  delete from public.flights f
  where f.flight_number in ('PC1', 'PC2', 'PC3')
    and f.flight_date = d;
end $$;

-- If you want to delete all dates too, run this:
-- delete from public.flight_crew fc
-- using public.flights f
-- where fc.flight_id = f.id
--   and f.flight_number in ('PC1', 'PC2', 'PC3');
--
-- delete from public.flights
-- where flight_number in ('PC1', 'PC2', 'PC3');
