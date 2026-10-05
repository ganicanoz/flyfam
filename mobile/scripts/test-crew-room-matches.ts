import assert from 'node:assert/strict';
import { addDaysYmd, computeCrewRoomMatches, type CrewRoomDay, type CrewRoomPerson } from '../lib/crewRoomMatches';

const ME = 'me';

function person(id: string, their: CrewRoomPerson['their_level'], mine: CrewRoomPerson['my_level']): CrewRoomPerson {
  return {
    crew_id: id,
    name: id,
    avatar_url: null,
    airline_icao: null,
    home_base: 'SAW',
    link_id: 'l',
    has_access: true,
    their_level: their,
    my_level: mine,
    my_override: null,
  };
}

function day(crew: string, d: string, status: CrewRoomDay['status'], stations: string[] = []): CrewRoomDay {
  const layover = status === 'layover';
  return { crew_id: crew, day: d, level: 'full', status, stations, flights: [], layover, layover_at: layover ? stations : [] };
}

const d1 = '2026-10-05';
const d2 = '2026-10-06';
const d3 = '2026-10-07';

const people = [person('a', 'full', 'full'), person('b', 'availability', 'full'), person('c', 'destination', 'availability')];
const days: CrewRoomDay[] = [
  day(ME, d1, 'off'),
  day(ME, d2, 'layover', ['FRA']),
  day(ME, d3, 'flying', ['TIA']),
  day('a', d1, 'free'),
  day('a', d2, 'layover', ['FRA']),
  day('a', d3, 'flying', ['TIA']),
  day('b', d1, 'off'),
  day('b', d2, 'busy'),
  day('c', d2, 'layover', ['FRA']),
];

const m = computeCrewRoomMatches(ME, people, days);
const key = m.map((x) => `${x.day}:${x.person.crew_id}:${x.kind}:${x.stations.join(',')}:${x.bothLayover}`);

assert.deepEqual(key, [
  `${d1}:b:shared_off::false`,
  `${d2}:a:same_place:FRA:true`,
  `${d3}:a:same_place:TIA:false`,
]);
assert.equal(addDaysYmd('2026-10-30', 3), '2026-11-02');
assert.equal(computeCrewRoomMatches('nobody', people, days).length, 0);
console.log('crew room matches OK');
