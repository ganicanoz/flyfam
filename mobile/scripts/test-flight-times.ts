/**
 * Offline regression tests for flight time handling (UTC vs airport local, overnight arrivals, DST, manual entry).
 * Run: cd mobile && npx tsx scripts/test-flight-times.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, report, stubMobileSupabaseClient } from './flightTestHarness';
import {
  fr24ScheduledFieldToUtcIso,
  utcFieldOrAirportLocalToUtcIso,
  utcIsoToLocalDateAtAirport as edgeLocalDateAtAirport,
} from '../../supabase/functions/_shared/fr24FlightDateMatch';
import {
  localDateTimeInTimezoneToUtcIso,
  pegasusUtcSchedulePairFromFlightDate,
  rowToScheduleIso,
  trLocalDateTimeToUtcIso,
} from '../../supabase/functions/_shared/roster-pdf/timeAndSchedule';
import type { PdfFlightRow } from '../../supabase/functions/_shared/roster-pdf/types';
import { AIRPORT_IANA_BY_CODE } from '../../supabase/functions/_shared/airportIanaByCode';
import { getAirportTimezone } from '../constants/airports';
import { getEffectiveUtcOffsetMinutesForAirportAtFlightDate } from '../lib/airportUtcOffset';
import { flightTimeToUtcHHMM, formatFlightTimeInTz, parseFlightTimeAsUtc } from '../lib/dateUtils';
import { formatCrewFlightTimeRange } from '../lib/flightDisplayTime';
import { resolveManualSchedulePair } from '../lib/manualFlightSchedule';

/** `AIRPORT_TIMEZONES` in constants/airports.ts is module-private; read it from source for the parity check. */
function mobileAirportTimezones(): Record<string, string> {
  const src = readFileSync(join(__dirname, '..', 'constants', 'airports.ts'), 'utf8');
  const start = src.indexOf('const AIRPORT_TIMEZONES');
  const block = src.slice(start, src.indexOf('};', start));
  return Object.fromEntries([...block.matchAll(/([A-Z0-9]{3,4}):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}

function row(flight_date: string, dep: string, arr: string): PdfFlightRow {
  return { flight_date, dep_time_local: dep, arr_time_local: arr } as PdfFlightRow;
}

async function main() {
  stubMobileSupabaseClient();
  const { airportLocalHhmmToUtcIso } = await import('../lib/flightApi');

  // --- Provider fields: real UTC vs airport-local wall clock (edge) ---
  await check('provider: explicit UTC wins over a different local clock', () => {
    assert.equal(utcFieldOrAirportLocalToUtcIso('2026-10-09T20:30:00Z', '2026-10-09 23:30', 'IST'), '2026-10-09T20:30:00.000Z');
  });
  await check('provider: "utc" field repeating the local clock is treated as local (no +3h shift)', () => {
    assert.equal(utcFieldOrAirportLocalToUtcIso('2026-10-09T23:30:00Z', '2026-10-09 23:30', 'IST'), '2026-10-09T20:30:00.000Z');
  });
  await check('provider: local-only IST time converts with +3', () => {
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-10-09 23:30', 'IST'), '2026-10-09T20:30:00.000Z');
  });
  await check('provider: local HH:MM uses the fallback flight date', () => {
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '23:30', 'IST', '2026-10-09'), '2026-10-09T20:30:00.000Z');
  });
  await check('provider: London summer (BST) vs winter (GMT)', () => {
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-07-15 10:00', 'LHR'), '2026-07-15T09:00:00.000Z');
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-12-15 10:00', 'LHR'), '2026-12-15T10:00:00.000Z');
  });
  await check('provider: New York summer is UTC-4 (IATA and ICAO)', () => {
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-07-15 10:00', 'JFK'), '2026-07-15T14:00:00.000Z');
    assert.equal(fr24ScheduledFieldToUtcIso('2026-07-15T10:00:00', 'KJFK', '2026-07-15'), '2026-07-15T14:00:00.000Z');
  });
  await check('edge time zone table covers every airport the app knows, with the same zone', () => {
    const mobile = mobileAirportTimezones();
    assert.ok(Object.keys(mobile).length > 300, 'mobile table not parsed');
    const missing = Object.keys(mobile).filter((c) => !AIRPORT_IANA_BY_CODE[c]);
    const differing = Object.keys(mobile).filter((c) => AIRPORT_IANA_BY_CODE[c] && AIRPORT_IANA_BY_CODE[c] !== mobile[c]);
    assert.deepEqual({ missing, differing }, { missing: [], differing: [] });
    assert.equal(getAirportTimezone('KJFK'), AIRPORT_IANA_BY_CODE.KJFK);
  });
  await check('provider: unknown airport falls back to UTC (documented limitation)', () => {
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-10-09 10:00', 'XYZ'), '2026-10-09T10:00:00.000Z');
  });
  await check('provider: DST switch day uses the offset at that moment, not at noon', () => {
    // London switches at 01:00 UTC: 00:30 local is still GMT on 2026-03-29.
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-03-29 00:30', 'LHR'), '2026-03-29T00:30:00.000Z');
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-03-29 10:00', 'LHR'), '2026-03-29T09:00:00.000Z');
    // Repeated hour when clocks go back: earlier instant.
    assert.equal(utcFieldOrAirportLocalToUtcIso(null, '2026-10-25 01:30', 'LHR'), '2026-10-25T00:30:00.000Z');
    assert.equal(fr24ScheduledFieldToUtcIso('2026-03-29T00:30:00', 'EGLL', '2026-03-29'), '2026-03-29T00:30:00.000Z');
  });

  // --- FR24 schedule fields (offsetless = airport local) ---
  await check('FR24: offsetless schedule is origin-local (ICAO code)', () => {
    assert.equal(fr24ScheduledFieldToUtcIso('2026-10-09T23:30:00', 'LTFM', '2026-10-09'), '2026-10-09T20:30:00.000Z');
  });
  await check('FR24: schedule with Z is real UTC', () => {
    assert.equal(fr24ScheduledFieldToUtcIso('2026-10-09T20:30:00Z', 'LTFM', '2026-10-09'), '2026-10-09T20:30:00.000Z');
  });
  await check('FR24: overnight arrival keeps its own date', () => {
    assert.equal(fr24ScheduledFieldToUtcIso('2026-10-10T01:30:00', 'EGLL', '2026-10-09'), '2026-10-10T00:30:00.000Z');
  });

  // --- Local calendar date at airport (date matching) ---
  await check('local date: 22:30Z is next day in Istanbul, same day in New York', () => {
    assert.equal(edgeLocalDateAtAirport('2026-10-09T22:30:00Z', 'IST'), '2026-10-10');
    assert.equal(edgeLocalDateAtAirport('2026-10-09T22:30:00Z', 'JFK'), '2026-10-09');
  });

  // --- Roster PDF schedule (IANA zones, overnight rollover) ---
  await check('roster: IST 23:30 → LHR 01:30 rolls arrival to next day', () => {
    const r = rowToScheduleIso(row('2026-10-09', '23:30', '01:30'), { originTz: 'Europe/Istanbul', destTz: 'Europe/London' });
    assert.deepEqual(r, { depIso: '2026-10-09T20:30:00.000Z', arrIso: '2026-10-10T00:30:00.000Z' });
  });
  await check('roster: westbound same-day flight is not rolled', () => {
    const r = rowToScheduleIso(row('2026-10-09', '08:00', '10:00'), { originTz: 'Europe/Istanbul', destTz: 'Europe/London' });
    assert.deepEqual(r, { depIso: '2026-10-09T05:00:00.000Z', arrIso: '2026-10-09T09:00:00.000Z' });
  });
  await check('roster: long-haul arrival later in local clock stays same day', () => {
    const r = rowToScheduleIso(row('2026-07-15', '14:00', '17:30'), { originTz: 'Europe/Istanbul', destTz: 'America/New_York' });
    assert.deepEqual(r, { depIso: '2026-07-15T11:00:00.000Z', arrIso: '2026-07-15T21:30:00.000Z' });
  });
  await check('roster: DST switch-day local time is exact (no noon probe)', () => {
    assert.equal(localDateTimeInTimezoneToUtcIso('2026-03-29', '00:30', 'Europe/London'), '2026-03-29T00:30:00.000Z');
  });
  await check('roster: repeated hour on DST end picks the earlier instant', () => {
    assert.equal(localDateTimeInTimezoneToUtcIso('2026-10-25', '01:30', 'Europe/London'), '2026-10-25T00:30:00.000Z');
  });
  await check('roster: Pegasus (Z) times roll arrival past midnight', () => {
    assert.deepEqual(pegasusUtcSchedulePairFromFlightDate('2026-10-09', '22:00', '01:15'), {
      dep_schedule_utc_iso: '2026-10-09T22:00:00.000Z',
      arr_schedule_utc_iso: '2026-10-10T01:15:00.000Z',
    });
  });
  await check('roster: Turkey wall clock is fixed +3', () => {
    assert.equal(trLocalDateTimeToUtcIso('2026-10-09', '02:00'), '2026-10-08T23:00:00.000Z');
  });

  // --- Manual entry converter (Add/Edit flight) ---
  await check('manual: airport offsets on the flight date', () => {
    assert.equal(getEffectiveUtcOffsetMinutesForAirportAtFlightDate('IST', '2026-10-09'), 180);
    assert.equal(getEffectiveUtcOffsetMinutesForAirportAtFlightDate('LHR', '2026-07-15'), 60);
    assert.equal(getEffectiveUtcOffsetMinutesForAirportAtFlightDate('LHR', '2026-12-15'), 0);
    assert.equal(getEffectiveUtcOffsetMinutesForAirportAtFlightDate('JFK', '2026-07-15'), -240);
  });
  await check('manual: entered local HH:MM converts to UTC on the given date', () => {
    assert.equal(airportLocalHhmmToUtcIso('2026-10-09', '23:30', 'IST'), '2026-10-09T20:30:00.000Z');
    assert.equal(airportLocalHhmmToUtcIso('2026-10-09', '01:30', 'LHR'), '2026-10-09T00:30:00.000Z');
  });
  await check('manual: no airport → time is taken as UTC', () => {
    assert.equal(airportLocalHhmmToUtcIso('2026-10-09', '07:05', null), '2026-10-09T07:05:00.000Z');
  });
  await check('manual: invalid input is rejected', () => {
    assert.equal(airportLocalHhmmToUtcIso('2026-10-9', '07:05', 'IST'), undefined);
    assert.equal(airportLocalHhmmToUtcIso('2026-10-09', '7h05', 'IST'), undefined);
  });
  await check('manual: DST switch day converts with the offset at that moment', () => {
    assert.equal(airportLocalHhmmToUtcIso('2026-03-29', '00:30', 'LHR'), '2026-03-29T00:30:00.000Z');
    assert.equal(airportLocalHhmmToUtcIso('2026-03-29', '10:00', 'LHR'), '2026-03-29T09:00:00.000Z');
  });

  // --- Manual add: departure/arrival pair saved by AddFlight ---
  const pair = (dateYmd: string, depHhmm: string, arrHhmm: string, originCode: string | null, destCode: string | null, api?: { dep?: string; arr?: string }) =>
    resolveManualSchedulePair({ dateYmd, depHhmm, arrHhmm, originCode, destCode, apiDepUtc: api?.dep ?? null, apiArrUtc: api?.arr ?? null });
  await check('manual pair: arrival after midnight is saved on the next day', () => {
    assert.deepEqual(pair('2026-10-09', '23:30', '01:30', 'IST', 'LHR'), {
      dep: '2026-10-09T20:30:00.000Z',
      arr: '2026-10-10T00:30:00.000Z',
    });
  });
  await check('manual pair: same-day flight is unchanged', () => {
    assert.deepEqual(pair('2026-10-09', '08:00', '10:00', 'IST', 'LHR'), {
      dep: '2026-10-09T05:00:00.000Z',
      arr: '2026-10-09T09:00:00.000Z',
    });
  });
  await check('manual pair: eastbound overnight with later local clock rolls by UTC, not by clock', () => {
    // IST 20:00 → Singapore 11:00 next morning.
    assert.deepEqual(pair('2026-10-09', '20:00', '11:00', 'IST', 'SIN'), {
      dep: '2026-10-09T17:00:00.000Z',
      arr: '2026-10-10T03:00:00.000Z',
    });
  });
  await check('manual pair: overnight into the repeated DST hour picks the earlier instant', () => {
    assert.deepEqual(pair('2026-10-24', '23:30', '01:30', 'IST', 'LHR'), {
      dep: '2026-10-24T20:30:00.000Z',
      arr: '2026-10-25T00:30:00.000Z',
    });
  });
  await check('manual pair: empty local times fall back to provider UTC', () => {
    assert.deepEqual(pair('2026-10-09', '', '', 'IST', 'LHR', { dep: '2026-10-09T20:30:00.000Z', arr: '2026-10-10T00:30:00.000Z' }), {
      dep: '2026-10-09T20:30:00.000Z',
      arr: '2026-10-10T00:30:00.000Z',
    });
  });
  await check('manual pair: provider arrival before departure is moved by 24h', () => {
    assert.equal(pair('2026-10-09', '23:30', '', 'IST', 'LHR', { arr: '2026-10-09T00:30:00.000Z' }).arr, '2026-10-10T00:30:00.000Z');
  });
  await check('manual pair: unknown airport keeps times as UTC and still rolls', () => {
    assert.deepEqual(pair('2026-10-09', '22:00', '01:00', null, null), {
      dep: '2026-10-09T22:00:00.000Z',
      arr: '2026-10-10T01:00:00.000Z',
    });
  });
  await check('manual pair: missing times stay null', () => {
    assert.deepEqual(pair('2026-10-09', '', '', 'IST', 'LHR'), { dep: null, arr: null });
  });

  // --- Display ---
  await check('display: stored UTC shows in the airport time zone', () => {
    assert.equal(formatFlightTimeInTz('2026-10-09T20:30:00.000Z', 'Europe/Istanbul'), '23:30');
    assert.equal(formatFlightTimeInTz('2026-10-10T00:30:00.000Z', 'Europe/London'), '01:30');
    assert.equal(formatFlightTimeInTz(null, 'Europe/London'), '—');
  });
  await check('display: crew card shows each leg in its own airport time', () => {
    assert.equal(
      formatCrewFlightTimeRange('2026-10-09T20:30:00.000Z', '2026-10-10T00:30:00.000Z', 'IST', 'LHR'),
      '23:30 (IST) – 01:30 (LHR)',
    );
  });
  await check('display: offsetless stored time is read as UTC', () => {
    assert.equal(parseFlightTimeAsUtc('2026-10-09T20:30:00')?.toISOString(), '2026-10-09T20:30:00.000Z');
    assert.equal(flightTimeToUtcHHMM('2026-10-09T23:30:00+03:00'), '20:30');
  });

  report('flight times');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
