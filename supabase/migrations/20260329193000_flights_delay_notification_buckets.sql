-- Track last sent delay bucket notifications (15-minute steps, threshold >=5m)
alter table public.flights
  add column if not exists dep_delay_notified_bucket integer,
  add column if not exists arr_delay_notified_bucket integer;

comment on column public.flights.dep_delay_notified_bucket is
  'Last sent departure delay notification bucket. Buckets: 5-19=1, 20-34=2, signed for early/late.';

comment on column public.flights.arr_delay_notified_bucket is
  'Last sent arrival delay notification bucket. Buckets: 5-19=1, 20-34=2, signed for early/late.';

