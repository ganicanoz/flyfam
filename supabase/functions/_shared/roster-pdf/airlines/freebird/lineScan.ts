import { rosterOccupationLabelEn, rosterOccupationLabelTr } from '../../occupationLabels.ts';
import type { PdfFlightRow } from '../../types.ts';

type FlightLeg = { code: string; origin: string | null; destination: string | null; ordinalForCode: number };
type PendingLeg = {
  dateIso: string;
  code: string;
  origin: string | null;
  destination: string | null;
  depUtc: string;
  depLocal: string | null;
};
type TimeCandidate = {
  utc: string;
  local: string | null;
  markerBefore: '>>>' | '==>' | null;
};
type TimePair = { depUtc: string | null; arrUtc: string | null; arrMarker: '>>>' | '==>' | null };

const DAY_HEADER_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/i;
const FLIGHT_CODE_RE = /\b(FH\d{2,4}|TK\d{2,4}|PC\d{2,4}|XQ\d{2,4}|DH)\b/gi;
const ROUTE_RE = /\b([A-Z]{3})-([A-Z]{3})\b/g;
const DUTY_CODE_RE = /\b(VAC|FREE|DOFF|STB[A-Z0-9]{1,3}|OFF)\b/gi;

function toIsoDate(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function collectDayBlocks(lines: string[]): Array<{ dateIso: string; text: string }> {
  const out: Array<{ dateIso: string; text: string }> = [];
  let currentDate: string | null = null;
  let acc: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const h = DAY_HEADER_RE.exec(line);
    if (h) {
      if (currentDate && acc.length > 0) out.push({ dateIso: currentDate, text: acc.join('\n') });
      currentDate = toIsoDate(h[2]!, h[3]!, h[4]!);
      acc = [];
      continue;
    }
    if (!currentDate) continue;
    acc.push(line);
  }
  if (currentDate && acc.length > 0) out.push({ dateIso: currentDate, text: acc.join('\n') });
  return out;
}

function collectFlightLegs(blockText: string): FlightLeg[] {
  const codes: Array<{ code: string; ordinalForCode: number }> = [];
  const seen = new Map<string, number>();
  for (const m of blockText.matchAll(FLIGHT_CODE_RE)) {
    const code = (m[1] ?? '').toUpperCase();
    const n = (seen.get(code) ?? 0) + 1;
    seen.set(code, n);
    codes.push({ code, ordinalForCode: n });
  }

  const routes: Array<{ origin: string; destination: string }> = [];
  for (const m of blockText.matchAll(ROUTE_RE)) {
    routes.push({ origin: (m[1] ?? '').toUpperCase(), destination: (m[2] ?? '').toUpperCase() });
  }

  return codes.map((x, idx) => ({
    code: x.code,
    origin: routes[idx]?.origin ?? null,
    destination: routes[idx]?.destination ?? null,
    ordinalForCode: x.ordinalForCode,
  }));
}

function hhmmList(re: RegExp, input: string): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(re)) {
    out.push(`${(m[1] ?? '').padStart(2, '0')}:${m[2] ?? ''}`);
  }
  return out;
}

function normalizeDutyCode(code: string): string {
  const u = code.replace(/\s/g, '').toUpperCase();
  return u;
}

function collectDutyCode(blockText: string): string | null {
  const all = [...blockText.matchAll(DUTY_CODE_RE)].map((m) => normalizeDutyCode(m[1] ?? ''));
  if (all.length === 0) return null;
  if (all.includes('VAC')) return 'VAC';
  if (all.includes('FREE')) return 'FREE';
  // If standby and DOFF coexist in same block, standby is the active duty for that day.
  if (all.some((x) => x.startsWith('STB'))) return all.find((x) => x.startsWith('STB')) ?? null;
  if (all.includes('DOFF')) return 'DOFF';
  if (all.includes('OFF')) return 'OFF';
  return all[0]!;
}

function utcIsoFor(dateIso: string, hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  return `${dateIso}T${hhmm}:00.000Z`;
}

function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function extractFlightTimeCandidates(blockText: string): TimeCandidate[] {
  const window = blockText
    // Page header noise; not a duty/flight time.
    .replace(/Printed\s+on\s+\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2}/gi, ' ')
    .replace(/Crew\s+Roster\s+by\s+Period[\s\S]*?Page\s+\d+/gi, ' ');

  const out: TimeCandidate[] = [];
  const tokenRe = /(>>>|==>|\[([01]?\d|2[0-3]):([0-5]\d)\]|\b([01]?\d|2[0-3]):([0-5]\d)\b)/g;
  let marker: '>>>' | '==>' | null = null;
  for (const m of window.matchAll(tokenRe)) {
    const tok = m[1] ?? '';
    if (tok === '>>>' || tok === '==>') {
      marker = tok;
      continue;
    }
    const localH = m[2] ? String(m[2]).replace(/^\[/, '').slice(0, 2) : null;
    const localM = m[2] ? String(m[2]).replace(/^\[/, '').slice(3, 5) : null;
    if (localH && localM) continue; // bracketed times are local-only hints.
    const hh = (m[4] ?? '').padStart(2, '0');
    const mm = m[5] ?? '';
    const utc = `${hh}:${mm}`;
    if (utc === '05:06') continue; // print timestamp artifact seen in sample.
    out.push({ utc, local: null, markerBefore: marker });
    marker = null;
  }
  return out;
}

function arrivalDayOffset(depUtc: string | null, arrUtc: string | null, marker: '>>>' | '==>' | null): number {
  if (marker === '>>>') return 1;
  // Product rule: "==>" has no semantic meaning for day shift in our app.
  if (!depUtc || !arrUtc) return 0;
  return arrUtc < depUtc ? 1 : 0;
}

function utcDurationMinutes(depUtc: string | null, arrUtc: string | null, marker: '>>>' | '==>' | null): number | null {
  const dep = hhmmToMinutes(depUtc);
  const arr = hhmmToMinutes(arrUtc);
  if (dep == null || arr == null) return null;
  const dayShift = arrivalDayOffset(depUtc, arrUtc, marker);
  return arr + dayShift * 24 * 60 - dep;
}

function scorePairs(pairs: TimePair[]): number {
  let score = 0;
  for (const p of pairs) {
    if (p.depUtc) score += 2;
    if (p.arrUtc) score += 3;
    if (!p.depUtc && p.arrUtc) score -= 2;
    const dur = utcDurationMinutes(p.depUtc, p.arrUtc, p.arrMarker);
    if (dur != null) {
      if (dur <= 0) score -= 4;
      else if (dur > 16 * 60) score -= 3;
      else if (dur > 0 && dur <= 9 * 60) score += 1;
    }
  }
  return score;
}

function buildTimePairsForLegs(tokens: TimeCandidate[], legCount: number): TimePair[] {
  if (legCount <= 0) return [];
  const source = tokens;
  const modes: TimePair[][] = [];

  // Mode A: sequential dep/arr in stream.
  {
    const pairs: TimePair[] = [];
    for (let i = 0; i < legCount; i += 1) {
      const dep = source[i * 2] ?? null;
      const arr = source[i * 2 + 1] ?? null;
      pairs.push({ depUtc: dep?.utc ?? null, arrUtc: arr?.utc ?? null, arrMarker: arr?.markerBefore ?? null });
    }
    modes.push(pairs);
  }

  // Mode B: first N tokens departure column, next N tokens arrival column.
  if (source.length >= legCount * 2) {
    const pairs: TimePair[] = [];
    for (let i = 0; i < legCount; i += 1) {
      const dep = source[i] ?? null;
      const arr = source[legCount + i] ?? null;
      pairs.push({ depUtc: dep?.utc ?? null, arrUtc: arr?.utc ?? null, arrMarker: arr?.markerBefore ?? null });
    }
    modes.push(pairs);
  }

  // Mode C: split at first marker token (arrivals often start with >>>/==>).
  {
    const splitIdx = source.findIndex((t) => t.markerBefore !== null);
    if (splitIdx > 0 && splitIdx >= legCount && source.length - splitIdx >= legCount) {
      const pairs: TimePair[] = [];
      for (let i = 0; i < legCount; i += 1) {
        const dep = source[i] ?? null;
        const arr = source[splitIdx + i] ?? null;
        pairs.push({ depUtc: dep?.utc ?? null, arrUtc: arr?.utc ?? null, arrMarker: arr?.markerBefore ?? null });
      }
      modes.push(pairs);
    }
  }

  // Mode D: departure-only fallback.
  {
    const pairs: TimePair[] = [];
    for (let i = 0; i < legCount; i += 1) {
      const dep = source[i] ?? null;
      pairs.push({ depUtc: dep?.utc ?? null, arrUtc: null, arrMarker: null });
    }
    modes.push(pairs);
  }

  let best = modes[0] ?? [];
  let bestScore = scorePairs(best);
  for (let i = 1; i < modes.length; i += 1) {
    const s = scorePairs(modes[i]!);
    if (s > bestScore) {
      best = modes[i]!;
      bestScore = s;
    }
  }
  return best;
}

function extractLocalBracketTimes(blockText: string): string[] {
  return hhmmList(/\[([01]?\d|2[0-3]):([0-5]\d)\]/g, blockText);
}

function addMinutesToHhmm(hhmm: string | null | undefined, deltaMin: number): string | null {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  let total = (h * 60 + m + deltaMin) % (24 * 60);
  if (total < 0) total += 24 * 60;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function parseFlightsFromPdfText_Freebird(text: string): PdfFlightRow[] {
  const lines = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const out: PdfFlightRow[] = [];
  const blocks = collectDayBlocks(lines);
  let pending: PendingLeg | null = null;

  for (const b of blocks) {
    const legs = collectFlightLegs(b.text);
    const timeCandidates = extractFlightTimeCandidates(b.text);

    if (legs.length > 0) {
      let startLegIdx = 0;

      // Continuation from previous day (arrival shown today, previous page had >>>).
      if (pending && legs[0]?.code === pending.code && timeCandidates.length > 0) {
        const depMin = hhmmToMinutes(pending.depUtc);
        let arrIdx = 0;
        if (depMin != null) {
          const idx = timeCandidates.findIndex((t) => {
            const m = hhmmToMinutes(t.utc);
            return m != null && m < depMin;
          });
          if (idx >= 0) arrIdx = idx;
        }
        const arrUtc = timeCandidates[arrIdx]?.utc ?? null;
        const arrMarker = timeCandidates[arrIdx]?.markerBefore ?? null;
        if (arrUtc) {
          timeCandidates.splice(arrIdx, 1);
          const arrDate = addDaysIso(pending.dateIso, arrivalDayOffset(pending.depUtc, arrUtc, arrMarker));
          out.push({
            flight_number: pending.code,
            flight_date: pending.dateIso,
            origin_iata: pending.origin,
            destination_iata: pending.destination,
            dep_time_local: pending.depLocal,
            arr_time_local: null,
            dep_schedule_utc_iso: utcIsoFor(pending.dateIso, pending.depUtc),
            arr_schedule_utc_iso: utcIsoFor(arrDate, arrUtc),
          });
          startLegIdx = 1;
          pending = null;
        }
      }

      const legPairs = buildTimePairsForLegs(timeCandidates, Math.max(0, legs.length - startLegIdx));
      for (let i = startLegIdx; i < legs.length; i += 1) {
        const rel = i - startLegIdx;
        let depUtc = legPairs[rel]?.depUtc ?? null;
        let arrUtc = legPairs[rel]?.arrUtc ?? null;
        let arrMarker = legPairs[rel]?.arrMarker ?? null;

        // Single-leg begin-duty rows often carry only departure UTC; keep as pending.
        if (!arrUtc && i === legs.length - 1 && /\bBegin\s+Duty\b/i.test(b.text)) {
          pending = {
            dateIso: b.dateIso,
            code: legs[i]!.code,
            origin: legs[i]!.origin,
            destination: legs[i]!.destination,
            depUtc: depUtc ?? '00:00',
            depLocal: null,
          };
          break;
        }
        if (!depUtc) continue;
        if (!arrUtc) arrUtc = depUtc;
        const arrDate = addDaysIso(b.dateIso, arrivalDayOffset(depUtc, arrUtc, arrMarker));
        out.push({
          flight_number: legs[i]!.code,
          flight_date: b.dateIso,
          origin_iata: legs[i]!.origin,
          destination_iata: legs[i]!.destination,
          dep_time_local: null,
          arr_time_local: null,
          dep_schedule_utc_iso: utcIsoFor(b.dateIso, depUtc),
          arr_schedule_utc_iso: utcIsoFor(arrDate, arrUtc),
        });
      }
      continue;
    }

    const dutyCode = collectDutyCode(b.text);
    if (dutyCode) {
      const localTimes = extractLocalBracketTimes(b.text);
      const utcTimes = extractFlightTimeCandidates(b.text).map((t) => t.utc);
      let dutyStart = localTimes[0] ?? null;
      let dutyEnd = localTimes[1] ?? null;
      if (dutyCode.startsWith('STB')) {
        // Prefer non-midnight bracket times for standby windows (e.g. 08:00-18:00).
        const localNonMid = localTimes.filter((x) => x !== '00:00' && x !== '23:59');
        if (localNonMid.length >= 2) {
          dutyStart = localNonMid[0] ?? dutyStart;
          dutyEnd = localNonMid[localNonMid.length - 1] ?? dutyEnd;
        }
        if (!dutyStart) dutyStart = addMinutesToHhmm(utcTimes[0] ?? null, 180);
        if (!dutyEnd) dutyEnd = addMinutesToHhmm(utcTimes[1] ?? null, 180);
      }
      if (['FREE', 'OFF', 'VAC', 'RQST', 'DOFF'].includes(dutyCode)) {
        if (!dutyStart && dutyEnd === '23:59') dutyStart = '00:00';
        if (!dutyEnd && dutyStart === '00:00') dutyEnd = '23:59';
        if (!dutyStart) dutyStart = addMinutesToHhmm(utcTimes[0] ?? null, 180);
        if (!dutyEnd) dutyEnd = addMinutesToHhmm(utcTimes[1] ?? null, 180);
      }
      if (dutyCode === 'FREE' && !dutyStart && !dutyEnd) {
        dutyStart = '00:00';
        dutyEnd = '23:59';
      }
      const dutyEndDate =
        dutyStart && dutyEnd && dutyEnd < dutyStart ? addDaysIso(b.dateIso, 1) : b.dateIso;
      const pushDuty = (dateIso: string, code: string, start: string | null, end: string | null, endDate: string) =>
        out.push({
          flight_number: code,
          flight_date: dateIso,
          roster_entry_kind: 'duty_off',
          duty_occupation_code: code,
          duty_occupation_label_tr: rosterOccupationLabelTr(code) ?? 'Boş Gün',
          duty_occupation_label_en: rosterOccupationLabelEn(code) ?? 'Off day',
          duty_start_time_local: start,
          duty_end_time_local: end,
          duty_end_date_iso: endDate,
        });

      if (dutyCode === 'DOFF') {
        pushDuty(b.dateIso, 'OFF', dutyStart, dutyEnd, dutyEndDate);
        const next = addDaysIso(b.dateIso, 1);
        pushDuty(next, 'OFF', '00:00', '23:59', next);
      } else {
        pushDuty(b.dateIso, dutyCode, dutyStart, dutyEnd, dutyEndDate);
      }
    }
  }

  if (pending) {
    out.push({
      flight_number: pending.code,
      flight_date: pending.dateIso,
      origin_iata: pending.origin,
      destination_iata: pending.destination,
      dep_time_local: pending.depLocal,
      dep_schedule_utc_iso: utcIsoFor(pending.dateIso, pending.depUtc),
      arr_schedule_utc_iso: null,
    });
  }

  return out;
}
