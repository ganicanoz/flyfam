/**
 * SunExpress roster (schedule PDF) parser — MVP.
 *
 * Hedef:
 * - XQ uçuşları + DH bacakları
 * - OFF günleri (duty_off)
 * - Transit/Hotel/MEDGR vb. satırları atla
 *
 * Not: PDF metni satır kırılımı bozuk olabildiği için bazı bacaklar atlanabilir.
 */

import type { PdfFlightRow } from '../../types.ts';

type DayBlock = {
  off: boolean;
  flights: Array<{
    code: string;
    origin: string | null;
    destination: string | null;
    dep: string | null;
    arr: string | null;
  }>;
};

function parseMonthName(mon: string): number | null {
  const m = mon.trim().toLowerCase();
  const map: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return map[m] ?? null;
}

function toYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(ymd: string, days: number): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function detectStartDate(text: string): string {
  const compact = text.replace(/\s+/g, ' ');
  const mm = /([A-Za-z]+)\s+(\d{4})/.exec(compact);
  const m = mm ? parseMonthName(mm[1] ?? '') : null;
  const y = mm ? Number(mm[2]) : null;
  // Normal görünüm: "29 30 Mar. 31 1 2 3 4"
  const cal = /(\d{1,2})\s+(\d{1,2})\s+[A-Za-z]{3}\./.exec(compact);
  // Sıkışık görünüm: "2930Mar. 311234"
  const calCompact = /(\d{1,2})(\d{1,2})\s*[A-Za-z]{3}\./.exec(compact);
  if (m && y && cal) {
    const firstPrev = Number(cal[1] ?? '1');
    const startMonthFirst = new Date(Date.UTC(y, m - 1, 1));
    const prevMonthStart = new Date(Date.UTC(y, m - 2, 1));
    const prevMonth = prevMonthStart.getUTCMonth() + 1;
    return toYmd(prevMonthStart.getUTCFullYear(), prevMonth, firstPrev);
  }
  if (m && y && calCompact) {
    const firstPrev = Number(calCompact[1] ?? '1');
    const prevMonthStart = new Date(Date.UTC(y, m - 2, 1));
    const prevMonth = prevMonthStart.getUTCMonth() + 1;
    return toYmd(prevMonthStart.getUTCFullYear(), prevMonth, firstPrev);
  }
  if (m && y) return toYmd(y, m, 1);
  return new Date().toISOString().slice(0, 10);
}

function joinWrappedFlightLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (
      /^~\s*\d{1,2}:\d{2}\s*[A-Z]{3}\s*$/.test(cur) &&
      /^[A-Z]{3}\s*\d{1,2}:\d{2}\s*(XQ\d{2,4}|DH)\b/.test(next)
    ) {
      out.push(`${cur} ${next}`);
      i += 1;
      continue;
    }
    out.push(cur);
  }
  return out;
}

function parseFlightLine(line: string): DayBlock['flights'][number] | null {
  const clean = line.replace(/\s+/g, ' ').trim();
  const r = /^~\s*(\d{1,2}:\d{2})\s*([A-Z]{3})\s*([A-Z]{3})\s*(\d{1,2}:\d{2})\s*(XQ\d{2,4}|DH)\b/.exec(clean);
  if (!r) return null;
  return {
    dep: r[1] ?? null,
    origin: r[2] ?? null,
    destination: r[3] ?? null,
    arr: r[4] ?? null,
    code: (r[5] ?? '').toUpperCase(),
  };
}

export function parseFlightsFromPdfText_SunExpress(text: string): PdfFlightRow[] {
  const startDate = detectStartDate(text);
  const rawLines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  const lines = joinWrappedFlightLines(rawLines);

  const blocks: DayBlock[] = [];
  let current: DayBlock = { off: false, flights: [] };

  const flush = () => {
    if (current.off || current.flights.length > 0) blocks.push(current);
    current = { off: false, flights: [] };
  };

  for (const line of lines) {
    if (/OFF/i.test(line)) {
      flush();
      blocks.push({ off: true, flights: [] });
      continue;
    }
    if (/Report/i.test(line)) {
      if (current.flights.length > 0) flush();
      continue;
    }
    const f = parseFlightLine(line);
    if (f) {
      current.flights.push(f);
      continue;
    }
  }
  flush();

  const out: PdfFlightRow[] = [];
  for (let idx = 0; idx < blocks.length; idx += 1) {
    const day = addDays(startDate, idx);
    const b = blocks[idx]!;
    if (b.off && b.flights.length === 0) {
      out.push({
        flight_number: 'FOF',
        flight_date: day,
        roster_entry_kind: 'duty_off',
        duty_occupation_code: 'FOF',
        duty_occupation_label_tr: 'Boş gün',
        duty_occupation_label_en: 'Off day',
      });
      continue;
    }
    for (const f of b.flights) {
      out.push({
        flight_number: f.code,
        flight_date: day,
        dep_time_local: f.dep,
        arr_time_local: f.arr,
        origin_iata: f.origin,
        destination_iata: f.destination,
      });
    }
  }

  return out;
}

