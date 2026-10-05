-- Product decision: Crew Room sends no push notifications (shared off days / layovers would leak roster info).
-- Removes the notifier schedule, the service-role matcher and the dedupe table.
-- crew_room_prefs.notify_* columns stay because crew_room_overview / crew_room_update_prefs reference them;
-- they are forced off and unused.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'crew-room-notify') then
    perform cron.unschedule('crew-room-notify');
  end if;
exception
  when undefined_table then null;
end $$;

drop function if exists public.crew_room_pending_notifications(date, date);
drop table if exists public.crew_room_notified;

alter table public.crew_room_prefs alter column notify_shared_off set default false;
alter table public.crew_room_prefs alter column notify_layover set default false;
update public.crew_room_prefs set notify_shared_off = false, notify_layover = false
where notify_shared_off or notify_layover;
