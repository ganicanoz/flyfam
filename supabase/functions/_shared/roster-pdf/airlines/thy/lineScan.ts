/**
 * THY ekip PDF — “Kalkış/GMT · İniş/GMT” tablosu.
 * Varış sütunundaki tarih varışın GMT günüdür; kalkış saati 24s döngüde varıştan ilerideyse kalkış günü −1.
 *
 * `pdf-parse` çıktısı çoğu zaman tek satır yerine şu blokları üretir:
 *   TK661 → IST/6:00 → TUN/10MAR202609:00
 * Positioning: TK2170 → P → IST/15:00 → ESB/10MAR202616:10
 */

import type { PdfFlightRow } from '../../types.ts';
import { addCalendarDays, utcIsoToLocalYmd } from '../../timeAndSchedule.ts';
import { rosterOccupationLabelEn, rosterOccupationLabelTr } from '../../occupationLabels.ts';
import { airportIanaForCode } from '../../../airportIanaByCode.ts';

const MONTH_THY: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

function pad2(n: string | number): string {
  const x = typeof n === 'string' ? parseInt(n, 10) : n;
  if (!Number.isFinite(x)) return '00';
  return String(x).padStart(2, '0');
}

function thyDdMmmYyyyToIso(dayStr: string, monToken: string, yearStr: string): string | null {
  const mon = (monToken || '').toUpperCase();
  const mm = MONTH_THY[mon];
  if (!mm) return null;
  const y = parseInt(yearStr, 10);
  const d = parseInt(dayStr, 10);
  if (y < 2000 || y > 2100 || d < 1 || d > 31) return null;
  return `${y}-${mm}-${pad2(d)}`;
}

function minutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

function utcIsoFromGmtDateAndClock(dateYmd: string, hh: string, mm: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  return `${dateYmd}T${pad2(hh)}:${pad2(mm)}:00.000Z`;
}

/** Eski deneme / script uyumluluğu. */
export function tryThyLineAnchorDate(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  const m = /^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})\b/i.exec(t);
  if (!m) return null;
  return thyDdMmmYyyyToIso(m[1]!, m[2]!, m[3]!);
}

/** Tek satır (temiz metin / bazı çıkarıcılar): TK661 IST/6:00 TUN/10MAR2026 09:00 */
const THY_GMT_ONE_LINE =
  /^TK(\d{2,4})\s+(?:P\s+)?([A-Z]{3})\/(\d{1,2}):(\d{2})\s+([A-Z]{3})\/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i;

/** Varış: TUN/10MAR202609:00 veya TUN/10MAR2026 09:00 */
const THY_ARR_GLUED =
  /^([A-Z]{3})\/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})(\d{1,2}):(\d{2})$/i;
const THY_ARR_SPACE =
  /^([A-Z]{3})\/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})\s+(\d{1,2}):(\d{2})/i;

/** THY aylık gridde şimdilik ürün kapsamı: sadece bu duty kodları. */
const THY_DUTY_CODES = new Set([
  'CFR',
  'IBB',
  'IBE',
  'IBX',
  'IOZ',
  'IBC',
  'IBY',
  'HSBY',
  'HSYB',
  'ASYB',
  'III',
]);

const MONTH_TR_THY: Record<string, string> = {
  OCA: '01',
  SUB: '02',
  MAR: '03',
  NIS: '04',
  MAY: '05',
  HAZ: '06',
  TEM: '07',
  AGU: '08',
  EYL: '09',
  EKI: '10',
  KAS: '11',
  ARA: '12',
};

function skipEmpty(from: number, lines: string[]): number {
  let j = from;
  while (j < lines.length && !lines[j]!.trim()) j += 1;
  return j;
}

function pushRow(
  out: PdfFlightRow[],
  fn: string,
  depAp: string,
  depH: string,
  depMin: string,
  arrAp: string,
  arrDay: string,
  arrMon: string,
  arrYear: string,
  arrH: string,
  arrMin: string,
): void {
  const arrDateIso = thyDdMmmYyyyToIso(arrDay, arrMon, arrYear);
  if (!arrDateIso) return;

  const depHm = `${pad2(depH)}:${pad2(depMin)}`;
  const arrHm = `${pad2(arrH)}:${pad2(arrMin)}`;
  const dm = minutes(depHm);
  const am = minutes(arrHm);
  if (!Number.isFinite(dm) || !Number.isFinite(am)) return;

  const depDateIso = dm > am ? addCalendarDays(arrDateIso, -1) : arrDateIso;

  const depUtc = utcIsoFromGmtDateAndClock(depDateIso, depH, depMin);
  const arrUtc = utcIsoFromGmtDateAndClock(arrDateIso, arrH, arrMin);
  if (!depUtc || !arrUtc) return;

  const originTz = airportIanaForCode(depAp.toUpperCase());
  const flightDate =
    originTz != null ? utcIsoToLocalYmd(depUtc, originTz) ?? depDateIso : depDateIso;

  out.push({
    roster_entry_kind: 'flight',
    flight_number: fn,
    flight_date: flightDate,
    origin_iata: depAp.toUpperCase(),
    destination_iata: arrAp.toUpperCase(),
    dep_time_local: depHm,
    arr_time_local: arrHm,
    dep_schedule_utc_iso: depUtc,
    arr_schedule_utc_iso: arrUtc,
  });
}

function parseArrLine(arrLine: string): {
  arrAp: string;
  arrDay: string;
  arrMon: string;
  arrYear: string;
  arrH: string;
  arrMin: string;
} | null {
  const g = THY_ARR_GLUED.exec(arrLine.trim());
  if (g) {
    return {
      arrAp: g[1]!,
      arrDay: g[2]!,
      arrMon: g[3]!,
      arrYear: g[4]!,
      arrH: g[5]!,
      arrMin: g[6]!,
    };
  }
  const s = THY_ARR_SPACE.exec(arrLine.trim());
  if (s) {
    return {
      arrAp: s[1]!,
      arrDay: s[2]!,
      arrMon: s[3]!,
      arrYear: s[4]!,
      arrH: s[5]!,
      arrMin: s[6]!,
    };
  }
  return null;
}

export function parseFlightsFromPdfText_THY(text: string): PdfFlightRow[] {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim());
  const out: PdfFlightRow[] = [];
  const seen = new Set<string>();

  const addDedup = (r: PdfFlightRow) => {
    const k = `${r.flight_date}|${r.flight_number}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    const one = THY_GMT_ONE_LINE.exec(line);
    if (one) {
      const fn = `TK${one[1]}`;
      const depAp = one[2]!;
      const depH = one[3]!;
      const depMin = one[4]!;
      const arrAp = one[5]!;
      const arrDay = one[6]!;
      const arrMon = one[7]!;
      const arrYear = one[8]!;
      let arrH: string;
      let arrMin: string;
      if (one[9] != null && one[10] != null) {
        arrH = one[9]!;
        arrMin = one[10]!;
      } else {
        const j = skipEmpty(i + 1, lines);
        const tm = /^(\d{1,2}):(\d{2})\b/.exec(lines[j] ?? '');
        if (!tm) continue;
        arrH = tm[1]!;
        arrMin = tm[2]!;
      }
      const row: PdfFlightRow[] = [];
      pushRow(row, fn, depAp, depH, depMin, arrAp, arrDay, arrMon, arrYear, arrH, arrMin);
      row.forEach(addDedup);
      continue;
    }

    const tkOnly = /^TK(\d{2,4})$/i.exec(line);
    if (!tkOnly) continue;

    const fn = `TK${tkOnly[1]}`;
    let j = skipEmpty(i + 1, lines);
    if ((lines[j] ?? '').trim().toUpperCase() === 'P') {
      j = skipEmpty(j + 1, lines);
    }

    const depM = /^([A-Z]{3})\/(\d{1,2}):(\d{2})$/i.exec(lines[j] ?? '');
    if (!depM) continue;
    const depAp = depM[1]!;
    const depH = depM[2]!;
    const depMin = depM[3]!;
    j = skipEmpty(j + 1, lines);

    const parsedArr = parseArrLine(lines[j] ?? '');
    if (!parsedArr) continue;
    const row: PdfFlightRow[] = [];
    pushRow(
      row,
      fn,
      depAp,
      depH,
      depMin,
      parsedArr.arrAp,
      parsedArr.arrDay,
      parsedArr.arrMon,
      parsedArr.arrYear,
      parsedArr.arrH,
      parsedArr.arrMin,
    );
    row.forEach(addDedup);
  }

  return out;
}

/** `pdf-parse` çıktısında aylık grid: DDdow satırları, sonra her sütunda genelde `kod` + boş satır (AG/IG yer tutucu ile hizalı). */
function thyFindLongestDowDayRun(lines: string[]): { start: number; days: number[] } | null {
  const re = /^(\d{2})(Pt|Sa|Ca|Pe|Cu|Ct|Pa)$/i;
  const idx: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i] ?? '')) idx.push(i);
  }
  let bestStart = -1;
  let bestLen = 0;
  for (let k = 0; k < idx.length; k += 1) {
    let len = 1;
    for (let j = k + 1; j < idx.length && idx[j] === idx[j - 1]! + 1; j += 1) len += 1;
    if (len > bestLen) {
      bestLen = len;
      bestStart = idx[k]!;
    }
  }
  if (bestStart < 0 || bestLen < 25) return null;
  const days: number[] = [];
  for (let i = bestStart; i < lines.length; i += 1) {
    const m = re.exec(lines[i] ?? '');
    if (!m) break;
    days.push(parseInt(m[1]!, 10));
  }
  if (days.length < 25) return null;
  return { start: bestStart, days };
}

/** İlk görev hücresinden sonra boş satır varsa sütunlar `base + 2*k` ile hizalı (AG/IG vb. yer tutucu korunur). */
function thyMonthlyGridDutyToken(
  lines: string[],
  base: number,
  colIndex: number,
  interleavedBlank: boolean,
): string {
  const idx = interleavedBlank ? base + colIndex * 2 : base + colIndex;
  const t = (lines[idx] ?? '').trim().toUpperCase();
  if (/^[A-Z]{2,6}$/.test(t)) return t;
  return '';
}

export function parseDutyFromPdfText_THY(text: string): PdfFlightRow[] {
  const lines = (text || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  const out: PdfFlightRow[] = [];

  const periodLine = lines.find((l) => /Period:/i.test(l));
  const p = /Period:\s*(\d{2})([A-ZÇĞİÖŞÜ]{3})\s*-\s*(\d{2})([A-ZÇĞİÖŞÜ]{3})/i.exec(periodLine ?? '');
  const periodMonthToken = (p?.[2] ?? '').toUpperCase();
  const mm = MONTH_TR_THY[periodMonthToken];
  if (!mm) return out;

  const yMatch = /(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(20\d{2})/.exec(text || '');
  const yyyy = yMatch?.[1] ?? String(new Date().getFullYear());
  if (!/^\d{4}$/.test(yyyy)) return out;

  const run = thyFindLongestDowDayRun(lines);
  if (!run) return out;
  const { start: first, days } = run;

  const base = first + days.length;
  const interleaved = (lines[base + 1] ?? '').trim() === '';
  const lastIdx = interleaved ? base + (days.length - 1) * 2 : base + days.length - 1;
  if (lastIdx >= lines.length) return out;

  for (let i = 0; i < days.length; i += 1) {
    const day = days[i]!;
    const code = thyMonthlyGridDutyToken(lines, base, i, interleaved);
    if (!code || !THY_DUTY_CODES.has(code)) continue;
    const flightDate = `${yyyy}-${mm}-${pad2(day)}`;
    out.push({
      roster_entry_kind: 'duty_off',
      flight_number: code,
      flight_date: flightDate,
      duty_occupation_code: code,
      duty_occupation_label_tr: rosterOccupationLabelTr(code),
      duty_occupation_label_en: rosterOccupationLabelEn(code),
      duty_start_time_local: '00:00',
      duty_end_date_iso: flightDate,
      duty_end_time_local: '23:59',
    });
  }
  return out;
}
