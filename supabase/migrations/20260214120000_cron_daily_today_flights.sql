-- "Today's flights" is no longer sent by a daily cron.
-- Crew sends it manually via the "Send flights to my family" button on the Roster screen.
-- If the old cron job was ever scheduled, remove it here.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-family-daily-flights') then
    perform cron.unschedule('notify-family-daily-flights');
  end if;
end $$;
