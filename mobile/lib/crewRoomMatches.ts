export type CrewRoomLevel = 'hidden' | 'availability' | 'destination' | 'full';

/** Server day status; `busy` only appears at availability level. */
export type CrewRoomDayStatus =
  | 'flying'
  | 'layover'
  | 'standby'
  | 'duty'
  | 'off'
  | 'free'
  | 'busy'
  | 'unknown';

export const CREW_ROOM_LEVELS: CrewRoomLevel[] = ['full', 'destination', 'availability', 'hidden'];

export function crewRoomLevelRank(level: CrewRoomLevel | string | null | undefined): number {
  switch (level) {
    case 'full':
      return 3;
    case 'destination':
      return 2;
    case 'availability':
      return 1;
    default:
      return 0;
  }
}

export type CrewRoomPerson = {
  crew_id: string;
  name: string | null;
  avatar_url: string | null;
  airline_icao: string | null;
  home_base: string | null;
  link_id: string;
  has_access: boolean;
  their_level: CrewRoomLevel;
  my_level: CrewRoomLevel;
  my_override: CrewRoomLevel | null;
};

export type CrewRoomFlight = {
  no: string;
  from: string | null;
  to: string | null;
  dep: string | null;
  arr: string | null;
};

export type CrewRoomDay = {
  crew_id: string;
  day: string;
  level: CrewRoomLevel;
  status: CrewRoomDayStatus;
  stations: string[];
  flights: CrewRoomFlight[];
  /** Away overnight on this day (also on flight days); visible at every shared level. */
  layover: boolean;
  /** Layover station(s); empty unless the owner shares at least 'destination'. */
  layover_at: string[];
};

/** Local calendar date as YYYY-MM-DD. */
export function localYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + n);
  return localYmd(dt);
}

export type CrewRoomMatch = {
  day: string;
  kind: 'shared_off' | 'same_place';
  person: CrewRoomPerson;
  stations: string[];
  bothLayover: boolean;
};

/** 'free' = no roster entry that day; it is not a confirmed day off. */
const AVAILABLE: CrewRoomDayStatus[] = ['off'];

/**
 * Shared off days and same-place days for the loaded window.
 * Same-place requires both directions ≥ destination (mutual consent).
 */
export function computeCrewRoomMatches(
  meCrewId: string,
  people: CrewRoomPerson[],
  days: CrewRoomDay[],
): CrewRoomMatch[] {
  const byCrew = new Map<string, Map<string, CrewRoomDay>>();
  for (const d of days) {
    let m = byCrew.get(d.crew_id);
    if (!m) {
      m = new Map();
      byCrew.set(d.crew_id, m);
    }
    m.set(d.day, d);
  }
  const mine = byCrew.get(meCrewId);
  if (!mine) return [];

  const out: CrewRoomMatch[] = [];
  for (const person of people) {
    const theirs = byCrew.get(person.crew_id);
    if (!theirs) continue;
    const mutualPlace =
      crewRoomLevelRank(person.their_level) >= 2 && crewRoomLevelRank(person.my_level) >= 2;
    for (const [day, myDay] of mine) {
      const theirDay = theirs.get(day);
      if (!theirDay) continue;
      if (AVAILABLE.includes(myDay.status) && AVAILABLE.includes(theirDay.status)) {
        out.push({ day, kind: 'shared_off', person, stations: [], bothLayover: false });
        continue;
      }
      if (!mutualPlace) continue;
      const shared = myDay.stations.filter((s) => theirDay.stations.includes(s));
      if (shared.length === 0) continue;
      out.push({
        day,
        kind: 'same_place',
        person,
        stations: shared,
        bothLayover: myDay.status === 'layover' && theirDay.status === 'layover',
      });
    }
  }
  out.sort((a, b) => (a.day === b.day ? a.kind.localeCompare(b.kind) : a.day.localeCompare(b.day)));
  return out;
}
