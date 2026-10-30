/**
 * Ardışık boş gün birleştirme — computeOffDayWindows mantığının birim testi.
 * Çalıştır: npx tsx mobile/scripts/test-off-day-windows.ts
 */
import assert from 'node:assert/strict';

function addUtcDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function inclusiveYmdDayCount(startYmd: string, endYmd: string): number {
  if (!startYmd || !endYmd || endYmd < startYmd) return 0;
  let n = 0;
  let cur = startYmd;
  while (cur <= endYmd) {
    n += 1;
    cur = addUtcDaysToYmd(cur, 1);
  }
  return n;
}

function parseUtcMs(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

const OFF_CODES = new Set([
  'FOF',
  'OFF',
  'FSF',
  'MSF',
  'SOF',
  'ROF',
  'RSF',
  'BDF',
  'IBB',
  'IBI',
  'AVAC',
]);

function isMergeableOff(code: string, kind: string): boolean {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (['STBY', 'HSBY', 'CFR', 'RSV', 'SIM', 'COTD', 'YERDR'].includes(u)) return false;
  if (OFF_CODES.has(u)) return true;
  return kind === 'duty_off';
}

function formatOffSpanComposition(dayCodes: string[]): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const raw of dayCodes) {
    const c = (raw || 'OFF').trim().toUpperCase() || 'OFF';
    if (!counts.has(c)) order.push(c);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return order
    .map((c) => {
      const n = counts.get(c) ?? 1;
      return n > 1 ? `${c}×${n}` : c;
    })
    .join(' · ');
}

type Row = {
  id: string;
  flight_date: string;
  flight_number: string;
  roster_entry_kind: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
};

function computeOffDayWindows(flights: Row[]) {
  const byDate = new Map<string, Row[]>();
  for (const f of flights) {
    if (!byDate.has(f.flight_date)) byDate.set(f.flight_date, []);
    byDate.get(f.flight_date)!.push(f);
  }
  const pure: string[] = [];
  const offsBy = new Map<string, Row[]>();
  for (const [ymd, rows] of byDate) {
    if (!rows.every((r) => isMergeableOff(r.flight_number, r.roster_entry_kind))) continue;
    const offs = rows.filter((r) => isMergeableOff(r.flight_number, r.roster_entry_kind));
    if (!offs.length) continue;
    pure.push(ymd);
    offsBy.set(ymd, offs);
  }
  pure.sort();
  const windows: {
    start: string;
    end: string;
    days: number;
    ids: string[];
    dayCodes: string[];
    durationMs: number;
  }[] = [];
  let i = 0;
  while (i < pure.length) {
    const start = pure[i]!;
    let end = start;
    let j = i + 1;
    while (j < pure.length && pure[j] === addUtcDaysToYmd(end, 1)) {
      end = pure[j]!;
      j += 1;
    }
    const days = inclusiveYmdDayCount(start, end);
    if (days >= 2) {
      const ids: string[] = [];
      const dayCodes: string[] = [];
      let offStartMs = 0;
      let offEndMs = 0;
      let cur = start;
      while (cur <= end) {
        const dayRows = offsBy.get(cur) ?? [];
        if (dayRows[0]) dayCodes.push(dayRows[0].flight_number.toUpperCase());
        for (const r of dayRows) {
          ids.push(r.id);
          const a = parseUtcMs(r.scheduled_departure);
          const b = parseUtcMs(r.scheduled_arrival);
          if (a > 0 && (offStartMs === 0 || a < offStartMs)) offStartMs = a;
          if (b > 0 && b > offEndMs) offEndMs = b;
        }
        cur = addUtcDaysToYmd(cur, 1);
      }
      let prevFlightEnd = 0;
      for (const f of flights) {
        const kind = (f.roster_entry_kind || 'flight').toLowerCase();
        if (kind !== 'flight' && kind !== '') continue;
        if (isMergeableOff(f.flight_number, f.roster_entry_kind)) continue;
        if (!f.flight_date || f.flight_date >= start) continue;
        const arr = parseUtcMs(f.scheduled_arrival);
        if (arr > prevFlightEnd) prevFlightEnd = arr;
      }
      let nextDutyStart = 0;
      for (const f of flights) {
        if (isMergeableOff(f.flight_number, f.roster_entry_kind)) continue;
        if (!f.flight_date || f.flight_date <= end) continue;
        const dep = parseUtcMs(f.scheduled_departure);
        if (dep > 0 && (nextDutyStart === 0 || dep < nextDutyStart)) nextDutyStart = dep;
      }
      const startMs = prevFlightEnd > 0 ? prevFlightEnd : offStartMs;
      const endMs = nextDutyStart > 0 ? nextDutyStart : offEndMs;
      const durationMs =
        startMs > 0 && endMs > startMs ? endMs - startMs : days * 24 * 60 * 60 * 1000;
      windows.push({ start, end, days, ids, dayCodes, durationMs });
    }
    i = j;
  }
  return windows;
}

const rows: Row[] = [
  {
    id: '0',
    flight_date: '2026-10-09',
    flight_number: 'PC123',
    roster_entry_kind: 'flight',
    scheduled_departure: '2026-10-09T08:00:00Z',
    scheduled_arrival: '2026-10-09T12:00:00Z',
  },
  {
    id: '1',
    flight_date: '2026-10-10',
    flight_number: 'BDF',
    roster_entry_kind: 'duty_off',
    // Bilerek UTC grubu kaymış gibi saat — birleştirme flight_date kullanmalı.
    scheduled_departure: '2026-10-09T21:00:00Z',
    scheduled_arrival: '2026-10-10T20:59:00Z',
  },
  {
    id: '2',
    flight_date: '2026-10-11',
    flight_number: 'SOF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: '2026-10-10T21:00:00Z',
    scheduled_arrival: '2026-10-11T20:59:00Z',
  },
  {
    id: '3',
    flight_date: '2026-10-12',
    flight_number: 'FOF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: '2026-10-12T00:00:00Z',
    scheduled_arrival: '2026-10-12T23:59:00Z',
  },
  {
    id: '4',
    flight_date: '2026-10-13',
    flight_number: 'FSF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: null,
    scheduled_arrival: null,
  },
  {
    id: '5',
    flight_date: '2026-10-15',
    flight_number: 'HSBY',
    roster_entry_kind: 'duty_off',
    scheduled_departure: '2026-10-15T06:00:00Z',
    scheduled_arrival: '2026-10-15T18:00:00Z',
  },
  {
    id: '6',
    flight_date: '2026-10-16',
    flight_number: 'OFF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: null,
    scheduled_arrival: null,
  },
  {
    id: '7',
    flight_date: '2026-10-17',
    flight_number: 'OFF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: null,
    scheduled_arrival: null,
  },
];

const wins = computeOffDayWindows(rows);
assert.equal(wins.length, 2, 'BDF/SOF/FOF/FSF dörtlü + OFF ikili; HSBY böler');
assert.deepEqual(
  { start: wins[0]!.start, end: wins[0]!.end, days: wins[0]!.days, dayCodes: wins[0]!.dayCodes },
  { start: '2026-10-10', end: '2026-10-13', days: 4, dayCodes: ['BDF', 'SOF', 'FOF', 'FSF'] },
);
assert.equal(formatOffSpanComposition(wins[0]!.dayCodes), 'BDF · SOF · FOF · FSF');
assert.equal(formatOffSpanComposition(['OFF', 'OFF', 'SOF']), 'OFF×2 · SOF');
assert.deepEqual(
  { start: wins[1]!.start, end: wins[1]!.end, days: wins[1]!.days },
  { start: '2026-10-16', end: '2026-10-17', days: 2 },
);

// Süre: 09.10 uçuş inişi 12:00Z → 15.10 HSBY kalkış 06:00Z
const expectedMs =
  Date.parse('2026-10-15T06:00:00Z') - Date.parse('2026-10-09T12:00:00Z');
assert.equal(wins[0]!.durationMs, expectedMs, 'boş süresi önceki uçuş inişinden sonraki göreve');

console.log('test-off-day-windows: PASS');
