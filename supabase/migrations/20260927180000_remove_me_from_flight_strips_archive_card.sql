-- User delete of a finished flight must not resurrect it as a slim archive card.
-- Before: remove_me_from_flight deleted the live row → tg_flights_ops_log_bd archived
-- tracked flights as past_12h_slim_card with the caller as crew → the roster merged
-- the archive card back. Archived-only cards (id = original_flight_id) were a no-op.
-- Now: after the live cleanup, strip the caller from flights_archive for that id and
-- drop the archive row when no crew is left. Cron archive path is unchanged.

create or replace function public.remove_me_from_flight(p_flight_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    return;
  end if;

  delete from public.flight_crew where flight_id = p_flight_id and crew_id = v_crew_id;
  if not exists (select 1 from public.flight_crew where flight_id = p_flight_id) then
    delete from public.flights where id = p_flight_id;
  end if;

  update public.flights_archive a
  set
    crew_ids = array_remove(coalesce(a.crew_ids, '{}'::uuid[]), v_crew_id),
    crew_id = case
      when a.crew_id = v_crew_id then (array_remove(coalesce(a.crew_ids, '{}'::uuid[]), v_crew_id))[1]
      else a.crew_id
    end
  where a.original_flight_id = p_flight_id
    and (a.crew_id = v_crew_id or v_crew_id = any(coalesce(a.crew_ids, '{}'::uuid[])));

  delete from public.flights_archive a
  where a.original_flight_id = p_flight_id
    and a.crew_id is null
    and coalesce(cardinality(a.crew_ids), 0) = 0;
end;
$$;

comment on function public.remove_me_from_flight(uuid) is
  'Remove caller from a live flight (delete when no crew left) and from its slim archive card (delete card when no crew left).';

grant execute on function public.remove_me_from_flight(uuid) to authenticated;
grant execute on function public.remove_me_from_flight(uuid) to service_role;
