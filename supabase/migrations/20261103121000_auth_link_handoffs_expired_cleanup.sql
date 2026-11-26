-- Deterministic cleanup of expired auth_link_handoffs + optional pg_cron schedule.

create or replace function public.cleanup_expired_auth_link_handoffs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  -- Expired unused (and any leftover expired/consumed rows) must not linger.
  delete from public.auth_link_handoffs
  where expires_at < now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_expired_auth_link_handoffs() from public, anon, authenticated;
grant execute on function public.cleanup_expired_auth_link_handoffs() to service_role;

comment on function public.cleanup_expired_auth_link_handoffs() is
  'Delete expired auth_link_handoffs rows; called from Edge Function and pg_cron when available.';

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skip auth_link_handoffs cleanup schedule (Edge Function still awaits cleanup)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'cleanup-expired-auth-link-handoffs') then
    perform cron.unschedule('cleanup-expired-auth-link-handoffs');
  end if;

  -- Handoff TTL is ~2 minutes; purge leftovers every 15 minutes.
  perform cron.schedule(
    'cleanup-expired-auth-link-handoffs',
    '*/15 * * * *',
    $cron$select public.cleanup_expired_auth_link_handoffs()$cron$
  );
  raise notice 'pg_cron job cleanup-expired-auth-link-handoffs scheduled (every 15 min)';
exception
  when undefined_table then
    raise notice 'cron schema missing — skip auth_link_handoffs cleanup schedule';
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;
