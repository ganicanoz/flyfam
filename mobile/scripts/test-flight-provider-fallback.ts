/**
 * Offline regression tests for the server flight-by-number provider chain
 * (`supabase/functions/_shared/flightByNumberEdge.ts`): order, 429 cooldown, date matching, overnight FR24 legs.
 * Network and Deno are stubbed; no keys or requests leave the machine.
 * Run: cd mobile && npx tsx scripts/test-flight-provider-fallback.ts
 */
import assert from 'node:assert/strict';
import { check, pinNow, report } from './flightTestHarness';

type Provider = 'airlabs' | 'aerodatabox' | 'aeroapi' | 'aviationstack' | 'flightapi' | 'fr24';
type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Route = Partial<Record<Provider, (url: URL) => Reply>>;

const HOSTS: Record<string, Provider> = {
  'airlabs.co': 'airlabs',
  'aerodatabox.p.rapidapi.com': 'aerodatabox',
  'aeroapi.flightaware.com': 'aeroapi',
  'api.aviationstack.com': 'aviationstack',
  'api.flightapi.io': 'flightapi',
  'fr24api.flightradar24.com': 'fr24',
};

const env: Record<string, string> = {
  RAPIDAPI_KEY: 'test-rapid',
  AEROAPI_API_KEY: 'test-aeroapi',
  AVIATIONSTACK_API_KEY: 'test-aviationstack',
  FLIGHTAPI_API_KEY: 'test-flightapi',
};
(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => env[k] } };

let calls: { provider: Provider; url: URL }[] = [];

function installFetch(route: Route): void {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const provider = HOSTS[url.host];
    if (!provider) throw new Error(`unexpected host ${url.host}`);
    calls.push({ provider, url });
    const reply = route[provider]?.(url) ?? { status: 404, body: { error: 'not found' } };
    return new Response(JSON.stringify(reply.body ?? null), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    });
  }) as typeof fetch;
}

/** Provider sequence with consecutive duplicates collapsed. */
function order(): string {
  return calls.map((c) => c.provider).filter((p, i, a) => p !== a[i - 1]).join(' > ');
}

function count(p: Provider): number {
  return calls.filter((c) => c.provider === p).length;
}

let airportQueries: string[] = [];

/** `public.airports` stub: answers `.or(icao.in.(…),iata.in.(…))` from an IATA → IANA map. */
function airportsQuery(zones: Record<string, string>) {
  let filter = '';
  const q = {
    select: () => q,
    or: (f: string) => {
      filter = f;
      airportQueries.push(f);
      return q;
    },
    not: () => q,
    limit: async () => ({
      data: Object.entries(zones)
        .filter(([iata]) => filter.includes(iata))
        .map(([iata, tz]) => ({ icao: null, iata, timezone_iana: tz })),
      error: null,
    }),
  };
  return q;
}

function makeCtx(opts: { fr24?: boolean; blocked?: string[]; airports?: Record<string, string> } = {}) {
  const upserts: string[] = [];
  const cooldownMap = new Map<string, number>();
  for (const p of opts.blocked ?? []) cooldownMap.set(p, Date.now() + 10 * 60 * 1000);
  const ctx = {
    supabase: {
      from: (table: string) =>
        table === 'airports'
          ? airportsQuery(opts.airports ?? {})
          : {
              upsert: async (row: { provider: string }) => {
                upserts.push(row.provider);
                return { error: null };
              },
            },
    },
    cooldownMap,
    airlabsKey: 'test-airlabs',
    fr24Token: opts.fr24 ? 'test-fr24' : null,
    debugLog: [],
  };
  return { ctx, upserts };
}

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** AirLabs /flight: IST → LHR on the given UTC instants. */
function airlabs(depIso: string, arrIso: string, withCities = true, status = 'scheduled'): Reply {
  return {
    status: 200,
    body: {
      response: {
        dep_iata: 'IST',
        arr_iata: 'LHR',
        ...(withCities ? { dep_city: 'Istanbul', arr_city: 'London' } : {}),
        dep_time_ts: ts(depIso),
        arr_time_ts: ts(arrIso),
        status,
      },
    },
  };
}

function aerodatabox(depUtc: string, arrUtc: string): Reply {
  return {
    status: 200,
    body: [
      {
        departure: { airport: { iata: 'IST', municipalityName: 'Istanbul' }, scheduledTime: { utc: depUtc } },
        arrival: { airport: { iata: 'LHR', municipalityName: 'London' }, scheduledTime: { utc: arrUtc } },
        status: 'Expected',
      },
    ],
  };
}

async function main() {
  const { fetchFlightByNumberEdge } = await import('../../supabase/functions/_shared/flightByNumberEdge');
  const TODAY = '2026-10-09';
  const TOMORROW = '2026-10-10';
  pinNow('2026-10-09T08:00:00Z');

  await check('today: complete AirLabs answer stops the chain and drops live status', async () => {
    installFetch({ airlabs: () => airlabs('2026-10-09T10:00:00Z', '2026-10-09T13:50:00Z') });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(order(), 'airlabs');
    assert.equal(r?.scheduled_departure_utc, '2026-10-09T10:00:00.000Z');
    assert.equal(r?.scheduled_arrival_utc, '2026-10-09T13:50:00.000Z');
    assert.equal(r?.depTime, '10:00');
    assert.equal(r?.flightStatus, undefined);
  });

  await check('today: AirLabs without cities is filled from AeroDataBox (no paid fallbacks)', async () => {
    installFetch({
      airlabs: () => airlabs('2026-10-09T10:00:00Z', '2026-10-09T13:50:00Z', false),
      aerodatabox: () => aerodatabox('2026-10-09 10:00Z', '2026-10-09 13:50Z'),
    });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(order(), 'airlabs > aerodatabox');
    assert.equal(r?.originCity, 'Istanbul');
    assert.equal(r?.destinationCity, 'London');
    assert.equal(r?.scheduled_departure_utc, '2026-10-09T10:00:00.000Z');
  });

  await check('429 on AirLabs: cooldown saved once, chain falls through to AviationStack when AeroAPI is empty', async () => {
    installFetch({
      airlabs: () => ({ status: 429, headers: { 'retry-after': '120' } }),
      aeroapi: () => ({ status: 200, body: { flights: [] } }),
      aviationstack: () => ({
        status: 200,
        body: {
          data: [
            {
              departure: { iata: 'IST', scheduled: '2026-10-09T13:00:00+00:00' },
              arrival: { iata: 'LHR', scheduled: '2026-10-09T14:50:00+00:00' },
              flight_status: 'scheduled',
            },
          ],
        },
      }),
    });
    const { ctx, upserts } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(order(), 'airlabs > aerodatabox > aeroapi > aviationstack > flightapi');
    assert.equal(count('airlabs'), 1, 'AirLabs must stop after 429');
    assert.deepEqual(upserts, ['airlabs']);
    const until = ctx.cooldownMap.get('airlabs');
    assert.equal(until, Date.now() + 120_000);
    assert.equal(r?.scheduled_departure_utc, '2026-10-09T10:00:00.000Z');
    assert.equal(r?.origin, 'IST');
  });

  await check('cooldown: a blocked provider is skipped entirely', async () => {
    installFetch({ aerodatabox: () => aerodatabox('2026-10-09 10:00Z', '2026-10-09 13:50Z') });
    const { ctx } = makeCtx({ blocked: ['airlabs'] });
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(count('airlabs'), 0);
    assert.equal(calls[0]?.provider, 'aerodatabox');
    assert.equal(r?.destination, 'LHR');
  });

  await check('cooldown: without Retry-After the default wait is 90 s', async () => {
    installFetch({ airlabs: () => ({ status: 429 }) });
    const { ctx } = makeCtx();
    await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(ctx.cooldownMap.get('airlabs'), Date.now() + 90_000);
  });

  await check('AirLabs monthly quota (HTTP 200 + error code): one call, 6 h cooldown, chain moves on', async () => {
    installFetch({
      airlabs: () => ({ status: 200, body: { error: { message: 'limit', code: 'month_limit_exceeded' } } }),
      aerodatabox: () => aerodatabox('2026-10-09 10:00Z', '2026-10-09 13:50Z'),
    });
    const { ctx, upserts } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(count('airlabs'), 1);
    assert.deepEqual(upserts, ['airlabs']);
    assert.equal(ctx.cooldownMap.get('airlabs'), Date.now() + 6 * 3600_000);
    assert.equal(r?.scheduled_departure_utc, '2026-10-09T10:00:00.000Z');
  });

  await check('AirLabs non-quota error: other variants are still tried, no cooldown', async () => {
    installFetch({ airlabs: () => ({ status: 200, body: { error: { code: 'not_found' } } }) });
    const { ctx, upserts } = makeCtx();
    await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.ok(count('airlabs') > 1, `airlabs calls: ${count('airlabs')}`);
    assert.equal(upserts.includes('airlabs'), false);
  });

  await check('AeroAPI hit: AviationStack is not called', async () => {
    installFetch({
      aeroapi: () => ({
        status: 200,
        body: {
          flights: [
            {
              scheduled_out: '2026-10-09T10:00:00Z',
              scheduled_in: '2026-10-09T13:50:00Z',
              origin: { code_iata: 'IST' },
              destination: { code_iata: 'LHR' },
              status: 'Scheduled',
            },
          ],
        },
      }),
    });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(count('aviationstack'), 0);
    assert.equal(r?.scheduled_arrival_utc, '2026-10-09T13:50:00.000Z');
  });

  await check('overnight: AeroAPI arrival before departure is moved to the next day', async () => {
    installFetch({
      aeroapi: () => ({
        status: 200,
        body: {
          flights: [
            {
              scheduled_out: '2026-10-09T20:30:00Z',
              scheduled_in: '2026-10-09T00:30:00Z',
              origin: { code_iata: 'IST' },
              destination: { code_iata: 'LHR' },
            },
          ],
        },
      }),
    });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(r?.scheduled_arrival_utc, '2026-10-10T00:30:00.000Z');
  });

  await check('future date: FR24 is asked first; a leg on another day is rejected', async () => {
    installFetch({
      fr24: () => ({ status: 200, body: { data: [] } }),
      airlabs: () => airlabs('2026-10-09T10:00:00Z', '2026-10-09T13:50:00Z'),
    });
    const { ctx } = makeCtx({ fr24: true });
    const r = await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, ctx);
    assert.equal(order(), 'fr24 > airlabs');
    assert.equal(r, null);
  });

  await check('FR24 live overnight leg: local schedule → UTC, arrival on next day, status from takeoff', async () => {
    pinNow('2026-10-08T22:00:00Z');
    installFetch({
      fr24: () => ({
        status: 200,
        body: {
          data: [
            {
              orig_icao: 'LTFM',
              dest_icao: 'EGLL',
              scheduled_departure: '2026-10-08T23:30:00',
              scheduled_arrival: '2026-10-09T01:30:00',
              first_seen: '2026-10-08T20:20:00Z',
              datetime_takeoff: '2026-10-08T20:45:00Z',
              flight_ended: false,
            },
          ],
        },
      }),
    });
    const { ctx } = makeCtx({ fr24: true });
    const r = await fetchFlightByNumberEdge('TK1979', '2026-10-08', TODAY, TOMORROW, ctx);
    pinNow('2026-10-09T08:00:00Z');
    assert.equal(order(), 'fr24');
    assert.equal(r?.scheduled_departure_utc, '2026-10-08T20:30:00.000Z');
    assert.equal(r?.scheduled_arrival_utc, '2026-10-09T00:30:00.000Z');
    assert.equal(r?.flightStatus, 'en_route');
  });

  await check('FR24 429: cooldown saved and the timetable chain still answers', async () => {
    installFetch({
      fr24: () => ({ status: 429, headers: { 'retry-after': '60' } }),
      airlabs: () => airlabs('2026-10-20T10:00:00Z', '2026-10-20T13:50:00Z'),
    });
    const { ctx, upserts } = makeCtx({ fr24: true });
    const r = await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, ctx);
    assert.deepEqual(upserts, ['fr24']);
    assert.equal(r?.scheduled_departure_utc, '2026-10-20T10:00:00.000Z');
  });

  await check('nothing found anywhere → null', async () => {
    installFetch({});
    const { ctx } = makeCtx({ fr24: true });
    assert.equal(await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, ctx), null);
  });

  await check('quota: AeroAPI, AviationStack and each AeroDataBox source stop after a 429', async () => {
    installFetch({
      aerodatabox: () => ({ status: 429 }),
      aeroapi: () => ({ status: 429 }),
      aviationstack: () => ({ status: 429 }),
    });
    const { ctx, upserts } = makeCtx();
    await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, ctx);
    assert.equal(count('aerodatabox'), 1);
    assert.equal(count('aeroapi'), 1);
    assert.equal(count('aviationstack'), 1);
    assert.deepEqual([...upserts].sort(), ['aeroapi', 'aerodatabox', 'aviationstack']);
  });

  await check('quota: the timetable chain runs once per lookup even when today’s answer is for another day', async () => {
    installFetch({ airlabs: () => airlabs('2026-10-08T10:00:00Z', '2026-10-08T13:50:00Z') });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(count('airlabs'), 1);
    assert.equal(r, null);
  });

  await check('AviationStack: picks the leg on the selected date and stays on free-plan parameters', async () => {
    installFetch({
      aeroapi: () => ({ status: 200, body: { flights: [] } }),
      aviationstack: () => ({
        status: 200,
        body: {
          data: [
            {
              departure: { iata: 'IST', scheduled: '2026-10-19T13:00:00+00:00' },
              arrival: { iata: 'LHR', scheduled: '2026-10-19T14:50:00+00:00' },
            },
            {
              departure: { iata: 'IST', scheduled: '2026-10-20T13:00:00+00:00' },
              arrival: { iata: 'LHR', scheduled: '2026-10-20T14:50:00+00:00' },
            },
          ],
        },
      }),
    });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, ctx);
    const av = calls.find((c) => c.provider === 'aviationstack');
    assert.ok(av, 'AviationStack was not called');
    assert.equal(av.url.searchParams.has('flight_date'), false);
    assert.equal(r?.scheduled_departure_utc, '2026-10-20T10:00:00.000Z');
  });

  await check('AviationStack: local times labelled +00:00 are converted at each airport (live TK1 IST→JFK)', async () => {
    installFetch({
      aeroapi: () => ({ status: 500 }),
      aviationstack: () => ({
        status: 200,
        body: {
          data: [
            {
              departure: { iata: 'IST', timezone: 'Europe/Istanbul', scheduled: '2026-10-09T14:10:00+00:00' },
              arrival: { iata: 'JFK', timezone: 'America/New_York', scheduled: '2026-10-09T17:55:00+00:00' },
            },
          ],
        },
      }),
    });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1', TODAY, TODAY, TOMORROW, ctx);
    assert.equal(r?.scheduled_departure_utc, '2026-10-09T11:10:00.000Z');
    assert.equal(r?.scheduled_arrival_utc, '2026-10-09T21:55:00.000Z');
  });

  await check('AviationStack: no timezone field → airport table; a real non-zero offset is kept', async () => {
    installFetch({
      aeroapi: () => ({ status: 200, body: { flights: [] } }),
      aviationstack: () => ({
        status: 200,
        body: {
          data: [
            {
              departure: { iata: 'IST', timezone: 'Not/AZone', scheduled: '2026-10-20T13:00:00+00:00' },
              arrival: { iata: 'LHR', scheduled: '2026-10-20T14:50:00+01:00' },
            },
          ],
        },
      }),
    });
    const { ctx } = makeCtx();
    const r = await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, ctx);
    assert.equal(r?.scheduled_departure_utc, '2026-10-20T10:00:00.000Z');
    assert.equal(r?.scheduled_arrival_utc, '2026-10-20T13:50:00.000Z');
  });

  await check('airport missing from the static table: timezone comes from public.airports, asked once', async () => {
    const leg = {
      departure: { iata: 'QQA', scheduled: '2026-10-20T13:00:00+00:00' },
      arrival: { iata: 'IST', scheduled: '2026-10-20T17:00:00+00:00' },
      airline: { iata: 'TK', icao: 'THY' },
      flight: { iata: 'TK1979' },
    };
    airportQueries = [];
    installFetch({
      aeroapi: () => ({ status: 200, body: { flights: [] } }),
      aviationstack: () => ({ status: 200, body: { data: [leg] } }),
    });
    const { ctx } = makeCtx({ airports: { QQA: 'Asia/Tokyo' } });
    const r = await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, ctx);
    assert.equal(r?.scheduled_departure_utc, '2026-10-20T04:00:00.000Z');
    assert.equal(r?.scheduled_arrival_utc, '2026-10-20T14:00:00.000Z');
    assert.equal(airportQueries.length, 1);
    assert.ok(!airportQueries[0].includes('IST') && !airportQueries[0].includes('THY'), airportQueries[0]);
    installFetch({
      aeroapi: () => ({ status: 200, body: { flights: [] } }),
      aviationstack: () => ({ status: 200, body: { data: [leg] } }),
    });
    await fetchFlightByNumberEdge('TK1979', '2026-10-20', TODAY, TOMORROW, makeCtx().ctx);
    assert.equal(airportQueries.length, 1);
  });

  pinNow(null);
  report('provider fallback');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
