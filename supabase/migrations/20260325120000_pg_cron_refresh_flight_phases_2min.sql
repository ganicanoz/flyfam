-- Fazlama cron sıklığını 2 dakikaya çeker (önceden 3 dk ile uygulanmış projeler için de idempotent).

do $$
declare
  jid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skip';
    return;
  end if;

  select j.jobid into jid from cron.job j where j.jobname = 'refresh-flight-api-phases' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'refresh-flight-api-phases',
    '*/2 * * * *',
    'select public.refresh_flights_api_refresh_phase()'
  );
  raise notice 'pg_cron job refresh-flight-api-phases (every 2 min)';
exception
  when undefined_table then
    raise notice 'cron schema missing — skip';
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;
