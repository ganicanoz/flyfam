-- Invite codes are secrets. Clients redeem an exact code through the
-- authenticated SECURITY DEFINER RPC; they must never enumerate the table.

drop policy if exists "Anyone can read invite codes (for lookup by code)"
  on public.invite_codes;

revoke select on table public.invite_codes from anon;

revoke execute on function public.generate_invite_code(integer) from public, anon;
revoke execute on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.generate_invite_code(integer) to authenticated;
grant execute on function public.redeem_invite_code(text) to authenticated;
