-- Follow-up for already-applied 20260927120000: flight and flight_crew RLS
-- policies evaluate this read-only helper for signed-in viewers.
revoke execute on function public.crew_has_active_subscription(uuid) from public, anon;
grant execute on function public.crew_has_active_subscription(uuid) to authenticated;
