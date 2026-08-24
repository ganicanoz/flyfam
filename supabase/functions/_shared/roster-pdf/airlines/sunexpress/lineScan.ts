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
import { rosterOccupationLabelEn, rosterOccupationLabelTr } from '../../occupationLabels.ts';

type DayBlock = {
  off: boolean;
  dutyCode: string | null;
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
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
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
  const mm = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i.exec(compact);
  const m = mm ? parseMonthName(mm[1] ?? '') : null;
  const y = mm ? Number(mm[2]) : null;
  // Takvim görünümü Pazar başlangıçlı; ayın 1'inin denk geldiği haftanın Pazar'ına geri sar.
  if (m && y) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const weekday = first.getUTCDay(); // 0=Sun
    const gridStart = new Date(first);
    gridStart.setUTCDate(first.getUTCDate() - weekday);
    return toYmd(gridStart.getUTCFullYear(), gridStart.getUTCMonth() + 1, gridStart.getUTCDate());
  }
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
  return new Date().toISOString().slice(0, 10);
}

function detectRosterMonthYear(text: string): { year: number; month: number } | null {
  const compact = text.replace(/\s+/g, ' ');
  const mm = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i.exec(compact);
  if (!mm) return null;
  const month = parseMonthName(mm[1] ?? '');
  const year = Number(mm[2] ?? '');
  if (!month || !Number.isFinite(year)) return null;
  return { year, month };
}

function detectGridSpanDays(text: string): number {
  const compact = text.replace(/\s+/g, ' ');
  if (/\bMay\.\s*1\s*2\b/i.test(compact) || /\b2627282930May\.\s*12\b/i.test(compact)) return 35;
  return 42;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function scoreShift(
  rows: PdfFlightRow[],
  shift: number,
  targetYear: number,
  targetMonth: number
): number {
  const daySet = new Set<number>();
  let inMonthRows = 0;
  for (const r of rows) {
    const shifted = addDays(r.flight_date, shift);
    const y = Number(shifted.slice(0, 4));
    const m = Number(shifted.slice(5, 7));
    const d = Number(shifted.slice(8, 10));
    if (y === targetYear && m === targetMonth) {
      inMonthRows += 1;
      daySet.add(d);
    }
  }
  if (daySet.size === 0) return -1e9;
  const monthLen = daysInMonth(targetYear, targetMonth);
  const minDay = Math.min(...daySet);
  const maxDay = Math.max(...daySet);
  const edgePenalty = Math.abs(minDay - 1) + Math.abs(monthLen - maxDay);
  return daySet.size * 10 + inMonthRows - edgePenalty * 2;
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

function parseNonFlightDutyCode(line: string): string | null {
  const u = line.replace(/\s+/g, '').toUpperCase();
  if (u === 'AVAC' || u === 'RSV') return u;
  if (/^SB[A-Z0-9]*$/.test(u)) return u;
  return null;
}

export function parseFlightsFromPdfText_SunExpress(text: string): PdfFlightRow[] {
  const startDate = detectStartDate(text);
  const monthInfo = detectRosterMonthYear(text);
  const gridDays = detectGridSpanDays(text);
  const rawLines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  const lines = joinWrappedFlightLines(rawLines);

  const blocks: DayBlock[] = Array.from({ length: gridDays }, () => ({
    off: false,
    dutyCode: null,
    flights: [],
  }));
  let dayIdx = -1;
  let current: DayBlock | null = null;
  let skipNextPureOff = false;

  const startNewDay = (): DayBlock | null => {
    if (dayIdx + 1 >= blocks.length) return null;
    dayIdx += 1;
    return blocks[dayIdx] ?? null;
  };

  for (const line of lines) {
    if (/ReportOFF/i.test(line)) {
      current = startNewDay();
      if (!current) break;
      current.off = true;
      skipNextPureOff = true;
      continue;
    }
    if (/^OFF$/i.test(line)) {
      if (skipNextPureOff) {
        skipNextPureOff = false;
        continue;
      }
      current = startNewDay();
      if (!current) break;
      current.off = true;
      continue;
    }
    if (/^MEDGR$/i.test(line)) {
      current = startNewDay();
      if (!current) break;
      continue;
    }
    const dutyCode = parseNonFlightDutyCode(line);
    if (dutyCode) {
      if (!current) {
        current = startNewDay();
        if (!current) break;
      }
      current.dutyCode = dutyCode;
      continue;
    }
    skipNextPureOff = false;
    if (/Report/i.test(line) && !/Release/i.test(line)) {
      current = startNewDay();
      if (!current) break;
      continue;
    }
    const f = parseFlightLine(line);
    if (f) {
      if (!current) {
        current = startNewDay();
        if (!current) break;
      }
      current.flights.push(f);
      continue;
    }
  }

  const out: PdfFlightRow[] = [];
  for (let idx = 0; idx < blocks.length; idx += 1) {
    const day = addDays(startDate, idx);
    const b = blocks[idx]!;
    if ((b.off || b.dutyCode) && b.flights.length === 0) {
      const code = b.dutyCode || 'FOF';
      out.push({
        flight_number: code,
        flight_date: day,
        roster_entry_kind: 'duty_off',
        duty_occupation_code: code,
        duty_occupation_label_tr: rosterOccupationLabelTr(code) ?? 'Boş Gün',
        duty_occupation_label_en: rosterOccupationLabelEn(code) ?? 'Off day',
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

  // Ay başlığına göre otomatik kaydırma:
  // Aynı parser farklı aylarda çalışsın diye sabit uçuş kodu anchor'ı yerine,
  // hedef ay kapsamasını en iyi yapan shift'i seçiyoruz.
  if (monthInfo && out.length > 0) {
    let bestShift = 0;
    let bestScore = -1e9;
    for (let shift = -20; shift <= 20; shift += 1) {
      const s = scoreShift(out, shift, monthInfo.year, monthInfo.month);
      if (s > bestScore) {
        bestScore = s;
        bestShift = shift;
      }
    }
    if (bestShift !== 0) {
      for (const r of out) r.flight_date = addDays(r.flight_date, bestShift);
    }

    // Hedef ayda satırı olmayan günleri OFF ile doldur.
    const dayHasEntry = new Set<number>();
    for (const r of out) {
      const y = Number(r.flight_date.slice(0, 4));
      const m = Number(r.flight_date.slice(5, 7));
      const d = Number(r.flight_date.slice(8, 10));
      if (y === monthInfo.year && m === monthInfo.month) dayHasEntry.add(d);
    }
    const monthLen = daysInMonth(monthInfo.year, monthInfo.month);
    for (let d = 1; d <= monthLen; d += 1) {
      if (dayHasEntry.has(d)) continue;
      out.push({
        flight_number: 'FOF',
        flight_date: toYmd(monthInfo.year, monthInfo.month, d),
        roster_entry_kind: 'duty_off',
        duty_occupation_code: 'FOF',
        duty_occupation_label_tr: 'Boş Gün',
        duty_occupation_label_en: 'Off day',
      });
    }
  }

  return out;
}

