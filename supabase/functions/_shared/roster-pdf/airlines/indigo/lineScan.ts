/**
 * IndiGo / InterGlobe Aviation — "Personal Crew Schedule Report" PDF.
 * Saatler: "All times in Local Station" (kalkış/iniş istasyon yereli → `dep_time_local` / `arr_time_local`).
 */

import {
  indigoDutyShortLabelEn,
  indigoDutyShortLabelTr,
  parseIndigoDutyLegendFromPdf,
} from './descriptions.ts';
import { mergeIndigoTrainingNotesIntoRows } from './training.ts';
import type { PdfFlightRow } from '../../types.ts';

const SCHEDULE_END_MARKERS = ['Total Hours and Statistics', 'Training Details', 'Hotel Information'] as const;

function clipToScheduleSection(text: string): string {
  let cut = Infinity;
  for (const m of SCHEDULE_END_MARKERS) {
    const i = text.indexOf(m);
    if (i !== -1 && i < cut) cut = i;
  }
  return cut === Infinity ? text : text.slice(0, cut);
}

function splitGluedIsoTimes(s: string): string {
  let t = s;
  let prev = '';
  while (t !== prev) {
    prev = t;
    t = t.replace(/(\d{1,2}:\d{2})(?=\d{1,2}:\d{2})/g, '$1\n');
  }
  return t;
}

function preprocessIndigoText(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/⁺¹/g, '');
  s = s.replace(/Page \d+ of \d+Generated on[^\n]*/gi, '\n');
  s = splitGluedIsoTimes(s);
  s = s.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\d{3,4}\s*\[)/gi, '$1\n$2');
  s = s.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(OFG|SBYP|ASBD)/gi, '$1\n$2');
  s = s.replace(/\b(OFG)(Golden)/gi, '$1 $2');
  s = s.replace(/\b(SBYP)(Home)/gi, '$1 $2');
  s = s.replace(/\b(ASBD)(Standby)/gi, '$1 $2');
  s = s.replace(/\b(Standby)(\d{1,2}:\d{2})\b/gi, '$1 $2');
  s = s.replace(/(\s-\s)([A-Z]{3})(\d{1,2}:\d{2})(?!\d)/g, '$1$2 $3');
  s = s.replace(/\b([A-Z]{3}\s+-\s+[A-Z]{3})\s+(\d{1,2}:\d{2})\b/g, '$1\n$2');
  s = s.replace(/(\[[^\]]+\])([A-Z]{3}\s+-\s+)/g, '$1\n$2');
  return s;
}

function dmyToIso(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function padHhMm(tok: string): string {
  const m = tok.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return tok.trim();
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

/** Duty / standby — PDF "Descriptions" legend ile (yalnızca IndiGo). */
function dutyRow(
  dateIso: string,
  code: string,
  start: string | null,
  end: string | null,
  legend: Record<string, string>,
): PdfFlightRow {
  const cu = code.replace(/\s/g, '').toUpperCase();
  const legEn = legend[cu] ?? null;
  return {
    flight_number: code,
    flight_date: dateIso,
    roster_entry_kind: 'duty_off',
    duty_occupation_code: code,
    duty_occupation_label_tr: indigoDutyShortLabelTr(code, legEn),
    duty_occupation_label_en: indigoDutyShortLabelEn(code, legEn),
    duty_start_time_local: start,
    duty_end_time_local: end,
  };
}

function collectTimeRanges(text: string): Array<{ dep: string; arr: string }> {
  const out: Array<{ dep: string; arr: string }> = [];
  const re = /\b(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\b/g;
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const dep = padHhMm(m[1] ?? '');
    const arr = padHhMm(m[2] ?? '');
    const key = `${dep}|${arr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dep, arr });
  }
  return out;
}

function isCrewLine(line: string): boolean {
  return /^(CP|FO|LD|CA)\s*-/i.test(line.trim());
}

function collectFlightsRoutesAndBlob(lines: string[]): {
  flightNums: string[];
  routes: Array<{ o: string; d: string }>;
  timeBlob: string;
} {
  const beforeCrew: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (isCrewLine(t)) break;
    beforeCrew.push(t);
  }

  const flightNums: string[] = [];
  const routes: Array<{ o: string; d: string }> = [];
  const timeParts: string[] = [];

  for (const t of beforeCrew) {
    const br = /^\s*(\d{3,4})\s*\[\d+\]\s*$/.exec(t);
    if (br) {
      flightNums.push(br[1]!);
      continue;
    }
    const bare = /^\s*(\d{3,4})\s*$/.exec(t);
    if (bare) {
      flightNums.push(bare[1]!);
      continue;
    }
    const rt = /^\*?\s*([A-Z]{3})\s+-\s+([A-Z]{3})(?:\s+\d{1,2}:\d{2})?\s*$/.exec(t);
    if (rt) {
      routes.push({ o: rt[1]!.toUpperCase(), d: rt[2]!.toUpperCase() });
      continue;
    }
    if (/\d{1,2}:\d{2}/.test(t)) timeParts.push(t);
  }

  return { flightNums, routes, timeBlob: timeParts.join('\n') };
}

function parseDayBlock(dateIso: string, lines: string[], legend: Record<string, string>): PdfFlightRow[] {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return [];

  const head = trimmed.join('\n');
  if (/\bOFG\b/i.test(head) && /Golden\s+Day\s+Off/i.test(head)) {
    return [dutyRow(dateIso, 'OFG', null, null, legend)];
  }

  if (/\bSBYP\b/i.test(head) && /Home\s+Standby/i.test(head)) {
    const m = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(head);
    if (m) return [dutyRow(dateIso, 'SBYP', padHhMm(m[1]!), padHhMm(m[2]!), legend)];
    return [dutyRow(dateIso, 'SBYP', null, null, legend)];
  }

  if (/\bASBD\b/i.test(head) && /Standby\s+at\s+Domestic\s+Airport/i.test(head)) {
    const m = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(head);
    if (m) return [dutyRow(dateIso, 'ASBD', padHhMm(m[1]!), padHhMm(m[2]!), legend)];
    return [dutyRow(dateIso, 'ASBD', null, null, legend)];
  }

  const { flightNums, routes, timeBlob } = collectFlightsRoutesAndBlob(trimmed);
  const ranges = collectTimeRanges(timeBlob);
  if (flightNums.length === 0 || routes.length === 0 || ranges.length === 0) return [];

  const n = Math.min(flightNums.length, routes.length, ranges.length);
  const out: PdfFlightRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const digits = flightNums[i]!;
    const { o, d } = routes[i]!;
    const { dep, arr } = ranges[i]!;
    out.push({
      flight_number: `6E${digits}`,
      flight_date: dateIso,
      roster_entry_kind: 'flight',
      origin_iata: o,
      destination_iata: d,
      dep_time_local: dep,
      arr_time_local: arr,
    });
  }
  return out;
}

const DATE_HEADER_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?(.*)$/i;

function isSkippableGlobalLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^InterGlobe\b/i.test(t)) return true;
  if (/^Personal Crew Schedule Report/i.test(t)) return true;
  if (/^\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/.test(t)) return true;
  if (/All times in Local Station/i.test(t)) return true;
  if (/^Schedule Details/i.test(t)) return true;
  if (/^DateDutiesDetailsReport/i.test(t)) return true;
  return false;
}

export function parseFlightsFromPdfText_Indigo(text: string): PdfFlightRow[] {
  const legend = parseIndigoDutyLegendFromPdf(text);
  const clipped = clipToScheduleSection(preprocessIndigoText(text));
  const lines = clipped.split('\n');

  const rows: PdfFlightRow[] = [];
  let pendingDate: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!pendingDate || buf.length === 0) return;
    rows.push(...parseDayBlock(pendingDate, buf, legend));
    buf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const t = line.trim();
    if (isSkippableGlobalLine(line)) continue;

    const dm = DATE_HEADER_RE.exec(t);
    if (dm) {
      flush();
      pendingDate = dmyToIso(dm[1]!, dm[2]!, dm[3]!);
      const rest = (dm[4] ?? '').trim();
      buf = rest ? [rest] : [];
      continue;
    }

    if (pendingDate) buf.push(line);
  }
  flush();

  mergeIndigoTrainingNotesIntoRows(rows, text);
  return rows;
}
