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

const OFF_CODES = new Set(['FOF', 'OFF', 'FSF', 'MSF', 'IBB', 'IBI', 'AVAC']);

function isMergeableOff(code: string, kind: string): boolean {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (['STBY', 'HSBY', 'CFR', 'RSV', 'SIM', 'COTD', 'YERDR'].includes(u)) return false;
  if (OFF_CODES.has(u)) return true;
  return kind === 'duty_off';
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
  const windows: { start: string; end: string; days: number; ids: string[] }[] = [];
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
      let cur = start;
      while (cur <= end) {
        for (const r of offsBy.get(cur) ?? []) ids.push(r.id);
        cur = addUtcDaysToYmd(cur, 1);
      }
      windows.push({ start, end, days, ids });
    }
    i = j;
  }
  return windows;
}

const rows: Row[] = [
  {
    id: '1',
    flight_date: '2026-10-10',
    flight_number: 'FOF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: '2026-10-10T00:00:00Z',
    scheduled_arrival: '2026-10-10T23:59:00Z',
  },
  {
    id: '2',
    flight_date: '2026-10-11',
    flight_number: 'FOF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: '2026-10-11T00:00:00Z',
    scheduled_arrival: '2026-10-11T23:59:00Z',
  },
  {
    id: '3',
    flight_date: '2026-10-12',
    flight_number: 'OFF',
    roster_entry_kind: 'duty_off',
    scheduled_departure: '2026-10-12T00:00:00Z',
    scheduled_arrival: '2026-10-12T23:59:00Z',
  },
  {
    id: '4',
    flight_date: '2026-10-14',
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
    scheduled_departure: null,
    scheduled_arrival: null,
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
assert.equal(wins.length, 2, 'FOF/OFF üçlü + OFF ikili; FSF tek + HSBY ayırır');
assert.deepEqual(
  { start: wins[0]!.start, end: wins[0]!.end, days: wins[0]!.days },
  { start: '2026-10-10', end: '2026-10-12', days: 3 },
);
assert.deepEqual(
  { start: wins[1]!.start, end: wins[1]!.end, days: wins[1]!.days },
  { start: '2026-10-16', end: '2026-10-17', days: 2 },
);
assert.deepEqual(wins[0]!.ids, ['1', '2', '3']);
assert.equal(inclusiveYmdDayCount('2026-10-10', '2026-10-10'), 1);

console.log('test-off-day-windows: PASS');
