/**
 * THY ekip PDF.
 *
 * Birincil kaynak: “LOKAL SAATLI UCUS PROGRAMI” (Kalkış/LT · İniş/LT) günlük bloklar.
 * Uçuş saatleri istasyon lokalidir (kalkış=origin, iniş=destination); görevler home base lokal.
 * UTC dönüşümü import’ta (`rowToScheduleIso` / home base TZ) yapılır — burada UTC yazılmaz.
 * Yedek (lokal bölüm yoksa): “Kalkış/GMT · İniş/GMT” uçuş tablosu (saatler UTC).
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

/** Lokal tablo satır etiketleri / limit anahtarları — görev kodu değil. */
const THY_LOCAL_META = new Set([
  'MB',
  'MS',
  'US',
  'DSB',
  'GMB',
  'GMS',
  'UID',
  'INT',
  'AUT',
  'UGS',
  'T',
  'SEFER',
  'GOREV',
  'UCUS',
  'KOKPIT',
  'GS',
  'MDS',
  'YI',
  'YDS',
]);

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

function skipEmpty(from: number, lines: string[]): number {
  let j = from;
  while (j < lines.length && !lines[j]!.trim()) j += 1;
  return j;
}

function pushGmtRow(
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

function parseGmtFlightsFromPdfText_THY(text: string): PdfFlightRow[] {
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
      pushGmtRow(row, fn, depAp, depH, depMin, arrAp, arrDay, arrMon, arrYear, arrH, arrMin);
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
    pushGmtRow(
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

/** Gerçek lokal bölüm (dipnottaki “LOKAL SAATLI …” cümlesini değil). */
function extractThyLocalTimeSection(text: string): string | null {
  const m = /^LOKAL\s+SAATLI\s+UCUS\s+PROGRAMI\s*$/im.exec(text || '');
  if (!m || m.index == null) return null;
  const rest = (text || '').slice(m.index);
  const end = /\nACIKLAMALAR\b/.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

function thyPrintedYear(text: string): number {
  const m = /Printed\s+\d{1,2}[A-Z]{3}(20\d{2})/i.exec(text || '');
  if (m?.[1]) return parseInt(m[1], 10);
  const m2 = /(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(20\d{2})/i.exec(text || '');
  if (m2?.[1]) return parseInt(m2[1], 10);
  return new Date().getFullYear();
}

type ThyDateCursor = { year: number; lastMm: number };

function parseThyTrDateTime(
  line: string,
  cursor: ThyDateCursor,
): { ymd: string; hm: string; mm: number } | null {
  const m = /^(\d{1,2})([A-ZÇĞİÖŞÜ]{3})\s+(\d{1,2}):(\d{2})$/i.exec((line || '').trim());
  if (!m) return null;
  const mon = (m[2] || '').toUpperCase();
  const mmStr = MONTH_TR_THY[mon];
  if (!mmStr) return null;
  const mm = parseInt(mmStr, 10);
  if (cursor.lastMm >= 11 && mm <= 2) cursor.year += 1;
  cursor.lastMm = mm;
  return {
    ymd: `${cursor.year}-${mmStr}-${pad2(m[1]!)}`,
    hm: `${pad2(m[3]!)}:${pad2(m[4]!)}`,
    mm,
  };
}

function parseThyLocalTimeLine(line: string): { hm: string; airport?: string } | null {
  const t = (line || '').trim();
  const ap = /^([A-Z]{3})\/(\d{1,2}):(\d{2})$/i.exec(t);
  if (ap) return { airport: ap[1]!.toUpperCase(), hm: `${pad2(ap[2]!)}:${pad2(ap[3]!)}` };
  const bare = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (bare) return { hm: `${pad2(bare[1]!)}:${pad2(bare[2]!)}` };
  return null;
}

function isThyLocalDutyCodeToken(code: string): boolean {
  const u = (code || '').trim().toUpperCase();
  if (!u) return false;
  if (THY_LOCAL_META.has(u)) return false;
  if (/^D\d+$/.test(u) || /^B\d+$/.test(u)) return false;
  // RC1, EMM, HSBY, CFR, III, …
  if (!/^[A-Z]{2,6}\d{0,2}$/.test(u)) return false;
  return true;
}

function pushThyDutyRow(
  out: PdfFlightRow[],
  code: string,
  flightDate: string,
  startHm: string,
  endHm: string,
  endDate: string,
): void {
  out.push({
    roster_entry_kind: 'duty_off',
    flight_number: code,
    flight_date: flightDate,
    duty_occupation_code: code,
    duty_occupation_label_tr: rosterOccupationLabelTr(code),
    duty_occupation_label_en: rosterOccupationLabelEn(code),
    duty_start_time_local: startHm,
    duty_end_date_iso: endDate,
    duty_end_time_local: endHm,
    duty_clock_basis: 'local',
  });
}

/**
 * Lokal saatli günlük program → tanınan her uçuş ve görev satırı
 * (TK…, RC1/EMM/HSBY/CFR, IBB/IBI boş günler, vb.).
 */
export function parseLocalTimeProgramFromPdfText_THY(text: string): PdfFlightRow[] {
  const section = extractThyLocalTimeSection(text);
  if (!section) return [];

  const lines = section.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const cursor: ThyDateCursor = { year: thyPrintedYear(text), lastMm: 0 };
  const out: PdfFlightRow[] = [];
  const seen = new Set<string>();

  const addDedup = (r: PdfFlightRow) => {
    const k = `${r.roster_entry_kind ?? 'flight'}|${r.flight_date}|${r.flight_number}|${r.dep_time_local ?? r.duty_start_time_local ?? ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };

  const mbIdx: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? '') === 'MB:') mbIdx.push(i);
  }

  for (let b = 0; b < mbIdx.length; b += 1) {
    const from = mbIdx[b]!;
    const to = b + 1 < mbIdx.length ? mbIdx[b + 1]! : lines.length;
    const chunk = lines.slice(from, to);
    const mb = parseThyTrDateTime(chunk[1] ?? '', cursor);
    if (!mb) continue;

    let ms: { ymd: string; hm: string } | null = null;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] === 'MS:') {
        ms = parseThyTrDateTime(chunk[i + 1] ?? '', cursor);
        break;
      }
    }

    const gmbs: { ymd: string; hm: string }[] = [];
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] === 'GMB:') {
        const g = parseThyTrDateTime(chunk[i + 1] ?? '', cursor);
        if (g) gmbs.push(g);
      }
    }

    type TkLeg = { fn: string; from: string; to: string; dep: string; arr: string };
    const tks: TkLeg[] = [];
    for (let i = 0; i < chunk.length; i += 1) {
      const tk = /^TK(\d{2,4})$/i.exec(chunk[i] ?? '');
      if (!tk) continue;
      let j = skipEmpty(i + 1, chunk);
      const dep = parseThyLocalTimeLine(chunk[j] ?? '');
      if (!dep?.airport) continue;
      j = skipEmpty(j + 1, chunk);
      const arr = parseThyLocalTimeLine(chunk[j] ?? '');
      if (!arr?.airport) continue;
      tks.push({
        fn: `TK${tk[1]}`,
        from: dep.airport,
        to: arr.airport,
        dep: dep.hm,
        arr: arr.hm,
      });
    }

    if (tks.length > 0) {
      tks.forEach((leg, idx) => {
        const d = gmbs[idx] ?? gmbs[0] ?? mb;
        addDedup({
          roster_entry_kind: 'flight',
          flight_number: leg.fn,
          flight_date: d.ymd,
          origin_iata: leg.from,
          destination_iata: leg.to,
          dep_time_local: leg.dep,
          arr_time_local: leg.arr,
          duty_clock_basis: 'local',
        });
      });
      continue;
    }

    // Görev: blok sonundaki kod + saat çifti (IST/8:30 veya 3:00).
    let duty: { code: string; start: string; end: string } | null = null;
    for (let i = chunk.length - 1; i >= 1; i -= 1) {
      const t2 = parseThyLocalTimeLine(chunk[i] ?? '');
      if (!t2) continue;
      let j = i - 1;
      while (j >= 0 && !(chunk[j] ?? '').trim()) j -= 1;
      const t1 = j >= 0 ? parseThyLocalTimeLine(chunk[j] ?? '') : null;
      if (!t1) continue;
      let k = j - 1;
      while (k >= 0 && !(chunk[k] ?? '').trim()) k -= 1;
      const code = ((chunk[k] ?? '') as string).trim().toUpperCase();
      if (!isThyLocalDutyCodeToken(code)) continue;
      duty = { code, start: t1.hm, end: t2.hm };
      break;
    }

    if (!duty) continue;

    const endDate =
      ms && minutes(duty.end) < minutes(duty.start) ? ms.ymd : mb.ymd;
    const rows: PdfFlightRow[] = [];
    pushThyDutyRow(rows, duty.code, mb.ymd, duty.start, duty.end, endDate);
    rows.forEach(addDedup);
  }

  return out;
}

export function parseFlightsFromPdfText_THY(text: string): PdfFlightRow[] {
  const local = parseLocalTimeProgramFromPdfText_THY(text);
  if (local.length > 0) {
    return local.filter((r) => r.roster_entry_kind === 'flight' || r.roster_entry_kind == null);
  }
  return parseGmtFlightsFromPdfText_THY(text);
}

export function parseDutyFromPdfText_THY(text: string): PdfFlightRow[] {
  const local = parseLocalTimeProgramFromPdfText_THY(text);
  if (local.length > 0) {
    return local.filter((r) => r.roster_entry_kind === 'duty_off');
  }
  // Lokal bölüm yoksa eski aylık grid’e düşme — tarih kayması riski yüksek.
  return [];
}
