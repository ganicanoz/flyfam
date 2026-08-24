-- Crew can remove (delete) a family connection; Family.tsx swipe-to-remove calls this RPC.

create or replace function public.remove_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.family_connections
  where id = p_connection_id
    and crew_id in (select id from public.crew_profiles where user_id = auth.uid());

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Connection not found or not allowed';
  end if;
end;
$$;

comment on function public.remove_connection(uuid) is
  'Crew removes a family connection (pending or approved). Cascade clears notification_preferences.';

grant execute on function public.remove_connection(uuid) to authenticated;
grant execute on function public.remove_connection(uuid) to service_role;
