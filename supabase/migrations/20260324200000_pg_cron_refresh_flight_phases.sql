-- Uçuş fazını (api_refresh_phase) yalnızca Postgres ile güncelle — FR24/AE yok.
-- pg_cron kurulu ve etkin projelerde her 2 dakikada bir çalışır.
-- Cron yoksa: refresh-flight-api-phases Edge fonksiyonunu dış zamanlayıcı ile tetikleyin.

do $$
declare
  jid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — use Edge function refresh-flight-api-phases on a schedule';
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
  raise notice 'pg_cron job refresh-flight-api-phases scheduled (every 2 min)';
exception
  when undefined_table then
    raise notice 'cron schema missing — skip pg_cron schedule';
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;
