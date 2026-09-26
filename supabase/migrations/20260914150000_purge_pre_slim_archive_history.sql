-- Fresh start: drop pre-slim archive junk so past roster history stays empty
-- until new 12h slim cards (archived_reason = past_12h_slim_card) accumulate.

delete from public.flights_archive
where archived_reason is distinct from 'past_12h_slim_card';
