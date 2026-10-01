import type { SupabaseClient } from '@supabase/supabase-js';
import { airborneFromLiveFields, landedFromRow } from './flightApiRefreshPhase';

export type ClearableFlightRow = {
  id: string;
  flight_number: string | null;
  flight_date: string | null;
  roster_entry_kind?: string | null;
  flight_status?: string | null;
  internal_status?: string | null;
  actual_arrival?: string | null;
  actual_departure?: string | null;
  fr24_datetime_landed_utc?: string | null;
  fr24_datetime_takeoff_utc?: string | null;
};

function parseUtcMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** Canlı (havada) uçuş — iniş sinyali yok. */
export function isLiveAirborneFlight(f: ClearableFlightRow): boolean {
  const kind = (f.roster_entry_kind ?? 'flight').toLowerCase();
  if (kind === 'duty_off' || kind === 'sim') return false;
  if (
    landedFromRow({
      flight_status: f.flight_status,
      internal_status: f.internal_status,
      actual_arrival: f.actual_arrival,
      fr24_datetime_landed_utc: f.fr24_datetime_landed_utc,
      scheduled_departure: (f as { scheduled_departure?: string | null }).scheduled_departure,
    })
  ) {
    return false;
  }
  const st = String(f.flight_status ?? '').toLowerCase();
  if (st === 'cancelled' || st === 'canceled' || st === 'landed' || st === 'parked') return false;
  if (airborneFromLiveFields(f.flight_status, f.internal_status)) return true;
  if (st === 'en_route' || st === 'departed') return true;
  const takeoffMs =
    parseUtcMs(f.actual_departure) || parseUtcMs(f.fr24_datetime_takeoff_utc);
  if (takeoffMs > 0 && takeoffMs <= Date.now()) return true;
  return false;
}

export function flightsForClearScope(
  rows: ClearableFlightRow[],
  scope: 'future' | 'all',
  todayYmd: string,
): { toDelete: ClearableFlightRow[]; activeKept: number } {
  let activeKept = 0;
  const toDelete: ClearableFlightRow[] = [];
  for (const f of rows) {
    if (isLiveAirborneFlight(f)) {
      activeKept += 1;
      continue;
    }
    if (scope === 'future') {
      const ymd = String(f.flight_date ?? '').slice(0, 10);
      if (ymd && ymd < todayYmd) continue;
    }
    toDelete.push(f);
  }
  return { toDelete, activeKept };
}

export function flightsForDayClear(
  rows: ClearableFlightRow[],
  dateYmd: string,
): { toDelete: ClearableFlightRow[]; activeKept: number } {
  let activeKept = 0;
  const toDelete: ClearableFlightRow[] = [];
  for (const f of rows) {
    const ymd = String(f.flight_date ?? '').slice(0, 10);
    if (ymd !== dateYmd) continue;
    if (isLiveAirborneFlight(f)) {
      activeKept += 1;
      continue;
    }
    toDelete.push(f);
  }
  return { toDelete, activeKept };
}

export function flightConflictKey(flightNumber: string | null | undefined, flightDate: string | null | undefined): string | null {
  const num = String(flightNumber ?? '')
    .replace(/\s/g, '')
    .toUpperCase();
  const date = String(flightDate ?? '').slice(0, 10);
  if (!num || date.length !== 10) return null;
  return `${num}|${date}`;
}

export function existingFlightConflictKeys(rows: ClearableFlightRow[]): Set<string> {
  const keys = new Set<string>();
  for (const f of rows) {
    const key = flightConflictKey(f.flight_number, f.flight_date);
    if (key) keys.add(key);
  }
  return keys;
}

export function countImportConflicts(
  importRows: Array<{ flight_number?: string | null; flight_date?: string | null }>,
  existingKeys: Set<string>,
): number {
  let n = 0;
  const seen = new Set<string>();
  for (const row of importRows) {
    const key = flightConflictKey(row.flight_number, row.flight_date);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (existingKeys.has(key)) n += 1;
  }
  return n;
}

const CLEARABLE_SELECT =
  'id, flight_number, flight_date, roster_entry_kind, flight_status, internal_status, actual_arrival, actual_departure, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc';

export async function fetchCrewClearableFlights(
  client: SupabaseClient,
  crewId: string,
): Promise<ClearableFlightRow[]> {
  const { data: fcRows, error: fcErr } = await client
    .from('flight_crew')
    .select('flight_id')
    .eq('crew_id', crewId);
  if (fcErr || !fcRows?.length) return [];
  const ids = fcRows.map((r: { flight_id: string }) => r.flight_id).filter(Boolean);
  if (ids.length === 0) return [];

  let cols = CLEARABLE_SELECT;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await client.from('flights').select(cols).in('id', ids);
    if (!error) return ((data ?? []) as unknown) as ClearableFlightRow[];
    const msg = String(error.message || '');
    let next = cols;
    if (msg.includes('fr24_datetime_takeoff_utc') || msg.includes('fr24_datetime_landed_utc')) {
      next = next.replace(', fr24_datetime_takeoff_utc, fr24_datetime_landed_utc', '');
    }
    if (msg.includes('actual_departure') || msg.includes('actual_arrival')) {
      next = next.replace(', actual_arrival, actual_departure', '');
    }
    if (msg.includes('roster_entry_kind')) {
      next = next.replace(', roster_entry_kind', '');
    }
    if (msg.includes('internal_status')) {
      next = next.replace(', internal_status', '');
    }
    if (next === cols) break;
    cols = next;
  }
  return [];
}

let pendingRosterClearFlush: (() => Promise<void>) | null = null;
let rosterClearCommitInFlight: Promise<void> | null = null;

/** Roster undo-clear: register the "commit now" handler while the undo window is open. */
export function setPendingRosterClearFlush(flush: (() => Promise<void>) | null): void {
  pendingRosterClearFlush = flush;
}

/** Roster undo-clear: track the sequential delete loop so imports can wait for it. */
export function trackRosterClearCommit(commit: Promise<void>): Promise<void> {
  const previous = rosterClearCommitInFlight;
  const tracked = Promise.all([previous, commit]).then(() => undefined).finally(() => {
    if (rosterClearCommitInFlight === tracked) rosterClearCommitInFlight = null;
  });
  rosterClearCommitInFlight = tracked;
  return tracked;
}

/**
 * Must run before adding flights: add_me_to_flight reuses rows by number+date, so a
 * clear still deleting in the background would remove freshly imported flights.
 */
export async function flushPendingRosterClear(): Promise<void> {
  const flush = pendingRosterClearFlush;
  pendingRosterClearFlush = null;
  try {
    if (flush) await flush();
    if (rosterClearCommitInFlight) await rosterClearCommitInFlight;
  } catch {
    // Import must still run; clear errors are per-row and non-fatal.
  }
}

export async function removeCrewFlightMembership(
  client: SupabaseClient,
  crewId: string,
  flightId: string,
): Promise<string | null> {
  const { error: rpcErr } = await client.rpc('remove_me_from_flight', { p_flight_id: flightId });
  if (!rpcErr) {
    await client.from('flights').delete().eq('id', flightId);
    return null;
  }
  const { error: relErr } = await client
    .from('flight_crew')
    .delete()
    .eq('flight_id', flightId)
    .eq('crew_id', crewId);
  if (!relErr) {
    await client.from('flights').delete().eq('id', flightId);
    return null;
  }
  const { error: legacyErr } = await client
    .from('flights')
    .delete()
    .eq('id', flightId)
    .eq('crew_id', crewId);
  if (!legacyErr) return null;
  return String(rpcErr.message || relErr.message || legacyErr.message || 'delete failed');
}
