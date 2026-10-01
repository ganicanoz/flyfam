-- Crew peer "unlink" only hid the peer on the device (AsyncStorage); the approved
-- crew_peer_links row stayed, so notify-family kept pushing that crew's flights.
-- Follower revokes own link. 'revoked' keeps history; request_crew_peer_follow
-- already turns revoked → pending on re-follow.

create or replace function public.unfollow_crew_peer(p_peer_crew_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.crew_peer_links
  set status = 'revoked'
  where follower_user_id = auth.uid()
    and peer_crew_id = p_peer_crew_id
    and status <> 'revoked';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.unfollow_crew_peer(uuid) is
  'Follower stops following a crew peer (status → revoked). Stops roster access and peer push.';

revoke all on function public.unfollow_crew_peer(uuid) from public, anon;
grant execute on function public.unfollow_crew_peer(uuid) to authenticated;
grant execute on function public.unfollow_crew_peer(uuid) to service_role;
