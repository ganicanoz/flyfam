-- İstemci: remove_me_from_flight / remove_me_from_all_flights (bazı projelerde EXECUTE eksik kalabiliyor)
grant execute on function public.remove_me_from_flight(uuid) to authenticated;
grant execute on function public.remove_me_from_flight(uuid) to service_role;
grant execute on function public.remove_me_from_all_flights() to authenticated;
grant execute on function public.remove_me_from_all_flights() to service_role;
