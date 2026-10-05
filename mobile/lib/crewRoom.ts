import { supabase } from '@/lib/supabase';

import type { CrewRoomDay, CrewRoomLevel, CrewRoomPerson } from './crewRoomMatches';

export * from './crewRoomMatches';

export type CrewRoomMe = {
  crew_id: string;
  name: string | null;
  has_access: boolean;
  default_level: CrewRoomLevel;
  invisible: boolean;
  notify_layover: boolean;
};

export type CrewRoomRequest = {
  link_id: string;
  crew_id: string;
  name: string | null;
  avatar_url?: string | null;
  airline_icao?: string | null;
  created_at: string;
};

export type CrewRoomOverview = {
  me: CrewRoomMe;
  people: CrewRoomPerson[];
  incoming: CrewRoomRequest[];
  outgoing: CrewRoomRequest[];
};

export type CrewRoomRequestResult =
  | 'requested'
  | 'already_requested'
  | 'already_connected'
  | 'connected'
  | 'not_found'
  | 'self';

/** Known server error codes raised by crew_room_* functions. */
export type CrewRoomErrorCode =
  | 'subscription_required'
  | 'rate_limited'
  | 'crew_only'
  | 'range_too_large'
  | 'unknown';

const KNOWN_ERRORS: CrewRoomErrorCode[] = ['subscription_required', 'rate_limited', 'crew_only', 'range_too_large'];

export class CrewRoomError extends Error {
  code: CrewRoomErrorCode;
  constructor(code: CrewRoomErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function toCrewRoomError(error: { message?: string } | null | undefined): CrewRoomError {
  const msg = String(error?.message ?? 'unknown');
  const code = KNOWN_ERRORS.find((c) => msg.includes(c)) ?? 'unknown';
  return new CrewRoomError(code, msg);
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw toCrewRoomError(error);
  return data as T;
}

export async function fetchCrewRoomOverview(): Promise<CrewRoomOverview> {
  const data = await rpc<CrewRoomOverview>('crew_room_overview');
  return {
    me: data.me,
    people: Array.isArray(data.people) ? data.people : [],
    incoming: Array.isArray(data.incoming) ? data.incoming : [],
    outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
  };
}

export async function fetchCrewRoomDays(fromYmd: string, toYmd: string): Promise<CrewRoomDay[]> {
  const data = await rpc<CrewRoomDay[] | null>('crew_room_days', { p_from: fromYmd, p_to: toYmd });
  return (data ?? []).map((d) => ({
    ...d,
    stations: Array.isArray(d.stations) ? d.stations : [],
    flights: Array.isArray(d.flights) ? d.flights : [],
    layover: d.layover === true,
    layover_at: Array.isArray(d.layover_at) ? d.layover_at : [],
  }));
}

export async function inviteCrewRoomContact(email: string): Promise<{ result: CrewRoomRequestResult }> {
  return rpc('crew_room_request', { p_email: email.trim() });
}

export function respondCrewRoomRequest(linkId: string, accept: boolean) {
  return rpc<string>('crew_room_respond', { p_link_id: linkId, p_accept: accept });
}

export function removeCrewRoomContact(linkId: string) {
  return rpc<string>('crew_room_remove', { p_link_id: linkId });
}

export function setCrewRoomShare(viewerCrewId: string, level: CrewRoomLevel | null) {
  return rpc<string>('crew_room_set_share', { p_viewer_crew_id: viewerCrewId, p_level: level });
}

export function updateCrewRoomPrefs(prefs: {
  defaultLevel?: CrewRoomLevel;
  invisible?: boolean;
  notifyLayover?: boolean;
}) {
  return rpc('crew_room_update_prefs', {
    p_default_level: prefs.defaultLevel ?? null,
    p_invisible: prefs.invisible ?? null,
    p_notify_shared_off: null,
    p_notify_layover: prefs.notifyLayover ?? null,
  });
}
