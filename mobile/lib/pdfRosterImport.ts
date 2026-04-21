/**
 * Re-export paylaşılan parser (`supabase/functions/_shared/roster-pdf/`, barrel: `pdfRosterImport.ts`).
 * Şu an PDF: Pegasus roster (`airlines/pegasus/`). RPC içe aktarma bu dosyada kalır (SupabaseClient).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PdfFlightRow } from '../../supabase/functions/_shared/pdfRosterImport';
import {
  rowFlightRestEndUtc,
  rowToScheduleIso,
} from '../../supabase/functions/_shared/pdfRosterImport';

export * from '../../supabase/functions/_shared/pdfRosterImport';

/**
 * Roster PDF içe aktarma — ürün kilidi.
 *
 * - **PGT (Pegasus):** Satır kuralları kasıtlı olarak “dünkü” davranışta dondurulmuştur: `filterPdfRowsForCrewAirline` içinde
 *   **hiç süzgeç yok** (parser çıktısı olduğu gibi `prepareImportRows` → RPC). Buraya yeni havayolu kuralı eklenmez.
 * - **THY:** Yalnızca `TK…` uçuş satırları (`filterPdfRowsForCrewAirline`).
 * - **Diğer ICAO:** PDF içe aktarma kapalı — uygulama pop-up gösterir; RPC’ye gelirse satırlar alınmaz.
 */
export const ROSTER_PDF_IMPORT_SUPPORTED_AIRLINE_ICAOS = ['PGT', 'THY', 'SXS'] as const;

export function isRosterPdfImportSupportedForCrewAirline(icao: string | null | undefined): boolean {
  if (!icao?.trim()) return false;
  const u = icao.replace(/\s/g, '').toUpperCase();
  return (ROSTER_PDF_IMPORT_SUPPORTED_AIRLINE_ICAOS as readonly string[]).includes(u);
}

export type PdfImportRpcResult = {
  ok: number;
  failed: Array<{ flight_number: string; flight_date: string; message: string }>;
  /** Geçersiz satır (kod/tarih yok) nedeniyle atlananlar */
  skippedNonFlights: number;
  skippedIncompleteFlights: number;
  importedFlights: number;
  importedNonFlights: number;
  /** THY’de TK dışı satırlar; desteklenmeyen havayolunda tüm satırlar (PGT’de 0) */
  skippedWrongAirline: number;
};

/** `public.airports` (FR24 sync) — IATA → IANA timezone. */
export async function fetchAirportTimezonesByIata(
  supabase: SupabaseClient,
  iatas: string[]
): Promise<Map<string, string>> {
  const uniq = [
    ...new Set(
      iatas
        .map((x) => x.replace(/\s/g, '').toUpperCase())
        .filter((x) => x.length >= 3)
        .map((x) => x.slice(0, 3))
    ),
  ];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;
  const { data, error } = await supabase.from('airports').select('iata,timezone_iana').in('iata', uniq);
  if (error || !data) return out;
  for (const r of data as { iata: string | null; timezone_iana: string | null }[]) {
    const i = r.iata?.trim().toUpperCase();
    const tz = r.timezone_iana?.trim();
    if (i && tz) out.set(i, tz);
  }
  return out;
}

function normalizeCode(code: string | null | undefined): string {
  const normalized = (code || '').replace(/\s/g, '').toUpperCase();
  // OCR gürültüsü: bazı PDF'lerde "FSF12"/"FOF7" gibi artıklar gelebiliyor.
  // Bunlar yeni bir görev kodu değil; off-day koduna geri katla.
  if (/^FSF\d{1,3}$/.test(normalized)) return 'FSF';
  if (/^FOF\d{1,3}$/.test(normalized)) return 'FOF';
  return normalized;
}

function isPcFlightCode(code: string): boolean {
  return /^PC\d{2,4}$/.test(code);
}

function isTkFlightCode(code: string): boolean {
  return /^TK\d{3,4}$/.test(code);
}

function isXqFlightCode(code: string): boolean {
  return /^XQ\d{2,4}$/.test(code);
}

/**
 * Yalnızca `isRosterPdfImportSupportedForCrewAirline` true iken çağrılmalı (PGT veya THY).
 * **PGT:** Tüm satırlar aynen kalır (Pegasus import kilidi — değiştirme).
 * **THY:** `TK…` uçuşları + THY duty kodları (CFR/IBB/IBE/HSBY/III vb. non-flight satırlar).
 */
export function filterPdfRowsForCrewAirline(
  rows: PdfFlightRow[],
  crewAirlineIcao: string,
  _crewAirlineIata: string | null | undefined
): { kept: PdfFlightRow[]; skippedWrongAirline: number } {
  const icao = crewAirlineIcao.replace(/\s/g, '').toUpperCase();
  const kept: PdfFlightRow[] = [];
  let skippedWrongAirline = 0;
  for (const r of rows) {
    const code = normalizeCode(r.flight_number);
    if (icao === 'PGT') {
      kept.push(r);
      continue;
    }
    if (icao === 'THY') {
      if (isTkFlightCode(code) || r.roster_entry_kind === 'duty_off' || r.roster_entry_kind === 'sim') kept.push(r);
      else skippedWrongAirline += 1;
      continue;
    }
    if (icao === 'SXS') {
      if (isXqFlightCode(code) || code === 'DH' || r.roster_entry_kind === 'duty_off' || r.roster_entry_kind === 'sim') {
        kept.push(r);
      } else {
        skippedWrongAirline += 1;
      }
      continue;
    }
    skippedWrongAirline += 1;
  }
  return { kept, skippedWrongAirline };
}

function pcNumber(code: string): number | null {
  const m = /^PC(\d{2,4})$/.exec(code);
  return m ? Number(m[1]) : null;
}

function timeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = hhmm.trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarDaysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function utcIsoAddCalendarDays(utcIso: string, deltaDays: number): string | null {
  if (deltaDays === 0) return utcIso;
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString();
}

function rowHasUtcSchedulePair(row: PdfFlightRow): boolean {
  return !!(row.dep_schedule_utc_iso?.trim() && row.arr_schedule_utc_iso?.trim());
}

/** PC ardışık uçuş gecesi: yerel saat yoksa kalkışı UTC ISO’dan dakikaya çevir. */
function depMinutesForPcOvernightHeuristic(row: PdfFlightRow): number | null {
  const u = row.dep_schedule_utc_iso?.trim();
  if (u) {
    const ms = Date.parse(u);
    if (!Number.isNaN(ms)) {
      const d = new Date(ms);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
  }
  return timeToMinutes(row.dep_time_local);
}

function slashDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function localIstanbulToUtcIso(dateIso: string | null | undefined, hhmm: string | null | undefined): string | null {
  if (!dateIso || !hhmm || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const d = new Date(`${dateIso}T${hhmm}:00+03:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function utcDayBoundaryIso(dateIso: string, hhmm: '00:00' | '23:59'): string {
  if (hhmm === '00:00') return `${dateIso}T00:00:00.000Z`;
  return `${dateIso}T23:59:00.000Z`;
}

/** THY GMT `…T06:00:00.000Z` → `06:00` (PDF satırındaki saatle aynı duvar saati). */
function utcClockHhMmFromIso(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.trim().match(/T(\d{2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

/**
 * Edge JSON / eski yanıtlar: UTC plan dolu iken `dep_time_local` boş gelebilir.
 * İsteğe bağlı camelCase yedek (ileride veya araçlar).
 */
function coercePdfFlightRowForImport(raw: PdfFlightRow): PdfFlightRow {
  const x = raw as Record<string, unknown>;
  const depUtcRaw =
    (typeof raw.dep_schedule_utc_iso === 'string' ? raw.dep_schedule_utc_iso : null) ??
    (typeof x.depScheduleUtcIso === 'string' ? (x.depScheduleUtcIso as string) : null);
  const arrUtcRaw =
    (typeof raw.arr_schedule_utc_iso === 'string' ? raw.arr_schedule_utc_iso : null) ??
    (typeof x.arrScheduleUtcIso === 'string' ? (x.arrScheduleUtcIso as string) : null);
  const depUtc = depUtcRaw?.trim() || null;
  const arrUtc = arrUtcRaw?.trim() || null;

  let depL =
    (typeof raw.dep_time_local === 'string' && raw.dep_time_local.trim() ? raw.dep_time_local.trim() : null) ??
    (typeof x.depTimeLocal === 'string' ? x.depTimeLocal.trim() : null);
  let arrL =
    (typeof raw.arr_time_local === 'string' && raw.arr_time_local.trim() ? raw.arr_time_local.trim() : null) ??
    (typeof x.arrTimeLocal === 'string' ? x.arrTimeLocal.trim() : null);

  if (!depL && depUtc) depL = utcClockHhMmFromIso(depUtc);
  if (!arrL && arrUtc) arrL = utcClockHhMmFromIso(arrUtc);

  return {
    ...raw,
    dep_schedule_utc_iso: depUtc ?? raw.dep_schedule_utc_iso ?? null,
    arr_schedule_utc_iso: arrUtc ?? raw.arr_schedule_utc_iso ?? null,
    dep_time_local: depL,
    arr_time_local: arrL,
  };
}

function extractStandbyRowsFromRawText(text: string): PdfFlightRow[] {
  const out: PdfFlightRow[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').replace(/\s/g, '');
    const m =
      line.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})(\d{1,2}:\d{2})(STBY[A-Z0-9]*)$/i) ??
      line.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(\d{1,2}:\d{2})(STBY[A-Z0-9]*)$/i);
    if (!m) continue;
    const dd = m[1]!.padStart(2, '0');
    const mm = m[2]!.padStart(2, '0');
    const yPart = m[3]!;
    const tm = /^(\d{1,2}):(\d{2})$/.exec(m[4]!);
    const start = tm ? `${tm[1]!.padStart(2, '0')}:${tm[2]}` : m[4]!;
    const code = m[5]!.toUpperCase();
    const year =
      yPart.length === 4 ? yPart : Number(yPart) >= 70 ? `19${yPart}` : `20${yPart}`;
    const flightDate = `${year}-${mm}-${dd}`;

    let dutyEndDateIso: string | null = null;
    let dutyEndTime: string | null = null;
    for (let j = i + 1; j <= Math.min(i + 8, lines.length - 1); j += 1) {
      const d = (lines[j] ?? '').trim();
      const t = (lines[j + 1] ?? '').trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(d) && /^\d{2}:\d{2}(:\d{2})?$/.test(t)) {
        dutyEndDateIso = slashDateToIso(d);
        dutyEndTime = t.slice(0, 5);
        break;
      }
    }
    out.push({
      roster_entry_kind: undefined,
      flight_number: code,
      flight_date: flightDate,
      duty_occupation_code: code,
      duty_occupation_label_tr: 'Nöbet',
      duty_occupation_label_en: 'Standby',
      duty_start_time_local: start,
      duty_end_date_iso: dutyEndDateIso,
      duty_end_time_local: dutyEndTime,
    });
  }
  return out;
}

type PreparedImportRow = {
  row: PdfFlightRow;
  code: string;
  effectiveDate: string;
  rosterKind: 'flight' | 'duty_off' | 'sim';
};

function prepareImportRows(
  rows: PdfFlightRow[],
  rawText?: string | null,
  opts?: { injectPegasusStandbyFromRawText?: boolean }
): { prepared: PreparedImportRow[]; skippedInvalid: number } {
  const merged = [...rows];
  if (opts?.injectPegasusStandbyFromRawText && rawText && rawText.trim().length > 0) {
    const stby = extractStandbyRowsFromRawText(rawText);
    const keys = new Set(merged.map((r) => `${r.flight_date}|${normalizeCode(r.flight_number)}`));
    for (const r of stby) {
      const k = `${r.flight_date}|${normalizeCode(r.flight_number)}`;
      if (!keys.has(k)) merged.push(r);
    }
  }

  const pcEntries: Array<{ idx: number; row: PdfFlightRow; code: string }> = [];
  merged.forEach((r, idx) => {
    const code = normalizeCode(r.flight_number);
    if (isPcFlightCode(code)) pcEntries.push({ idx, row: r, code });
  });

  const dutyFixByIdx = new Map<number, boolean>();
  for (const e of pcEntries) {
    if (rowHasUtcSchedulePair(e.row)) {
      dutyFixByIdx.set(e.idx, false);
      continue;
    }
    const dep = timeToMinutes(e.row.dep_time_local);
    const dutyStart = timeToMinutes(e.row.duty_start_time_local);
    dutyFixByIdx.set(e.idx, dep != null && dutyStart != null && dutyStart > dep);
  }

  const baseDateByIdx = new Map<number, string>();
  for (const e of pcEntries) {
    baseDateByIdx.set(e.idx, dutyFixByIdx.get(e.idx) ? addDaysIso(e.row.flight_date, 1) : e.row.flight_date);
  }

  const overnightByIdx = new Map<number, boolean>();
  for (let i = 0; i < pcEntries.length - 1; i += 1) {
    const a = pcEntries[i];
    const b = pcEntries[i + 1];
    if (baseDateByIdx.get(a.idx) !== baseDateByIdx.get(b.idx)) continue;
    const an = pcNumber(a.code);
    const bn = pcNumber(b.code);
    if (an == null || bn == null || bn !== an + 1) continue;
    const aDep = timeToMinutes(a.row.dep_time_local);
    const bDep = timeToMinutes(b.row.dep_time_local);
    if (aDep == null || bDep == null) continue;
    if (bDep < aDep) overnightByIdx.set(b.idx, true);
  }

  const finalDateByIdx = new Map<number, string>();
  for (const e of pcEntries) {
    const base = baseDateByIdx.get(e.idx) ?? e.row.flight_date;
    finalDateByIdx.set(e.idx, overnightByIdx.get(e.idx) ? addDaysIso(base, 1) : base);
  }

  const prepared: PreparedImportRow[] = [];
  let skippedInvalid = 0;
  for (let idx = 0; idx < merged.length; idx += 1) {
    const r = merged[idx];
    const code = normalizeCode(r.flight_number);
    if (!code || !r.flight_date) {
      skippedInvalid += 1;
      continue;
    }
    const isFlight = isPcFlightCode(code) || isTkFlightCode(code);
    const effectiveDate = isPcFlightCode(code) ? finalDateByIdx.get(idx) ?? r.flight_date : r.flight_date;
    const rosterKind: 'flight' | 'duty_off' | 'sim' =
      code === 'SIM' || r.roster_entry_kind === 'sim' ? 'sim' : isFlight ? 'flight' : 'duty_off';
    prepared.push({ row: r, code, effectiveDate, rosterKind });
  }
  return { prepared, skippedInvalid };
}

function isIsoYmd(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function timeToMinutesLoose(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = hhmm.trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Çok günlü duty_off görevleri (FOF/ROF/RSF/III/VAC/UPV vb.) roster'da her takvim günü görünsün.
 * - Başlangıç: `effectiveDate`
 * - Bitiş: `duty_rest_end_date_iso` veya `duty_end_date_iso` içindeki en ileri tarih
 *   (`02:59` gibi erken-sabah bitişlerde son gün EXCLUSIVE kabul edilir)
 * - Fallback: FOF için en az +1 gün (eski davranış korunur)
 */
function expandMultiDayDutyRows(prepared: PreparedImportRow[]): PreparedImportRow[] {
  const anchoredByCodeDate = new Set<string>();
  for (const p of prepared) {
    if (p.rosterKind !== 'duty_off') continue;
    anchoredByCodeDate.add(`${normalizeCode(p.code)}|${p.effectiveDate}`);
  }

  const syntheticByCodeDate = new Set<string>();
  const out: PreparedImportRow[] = [];

  for (const p of prepared) {
    out.push(p);
    if (p.rosterKind !== 'duty_off') continue;

    const code = normalizeCode(p.code);
    const start = p.effectiveDate;
    const endCandidates = [p.row.duty_end_date_iso?.trim(), p.row.duty_rest_end_date_iso?.trim()].filter(isIsoYmd);
    let end = endCandidates.reduce((mx, x) => (x > mx ? x : mx), start);
    const endClockMin =
      timeToMinutesLoose(p.row.duty_rest_end_time_local ?? null) ??
      timeToMinutesLoose(p.row.duty_end_time_local ?? null);
    // 00:00-03:59 bitişleri, bir önceki günün off bloğunu kapatır (örn. 30/04 02:59 -> son tam gün 29/04).
    if (endClockMin != null && endClockMin < 4 * 60 && end > start) {
      end = addDaysIso(end, -1);
    }

    // Eski FOF kuralı: tek satır geldiyse en az iki güne yay.
    if (code === 'FOF' && end <= start) end = addDaysIso(start, 1);

    if (end <= start) continue;

    const spanDays = calendarDaysBetweenYmd(start, end);
    // Güvenlik: parse hatalarında sınırsız genişlemeyi önle.
    const boundedSpan = Math.min(Math.max(spanDays, 0), 45);
    for (let d = 1; d <= boundedSpan; d += 1) {
      const day = addDaysIso(start, d);
      const key = `${code}|${day}`;
      if (anchoredByCodeDate.has(key) || syntheticByCodeDate.has(key)) continue;
      syntheticByCodeDate.add(key);
      out.push({
        row: {
          ...p.row,
          flight_date: day,
          duty_slash_start_date_iso: undefined,
          duty_slash_start_time_local: undefined,
          duty_start_time_local: '00:00',
          duty_end_date_iso: day,
          duty_end_time_local: '23:59',
          // Aynı görevin kutuları aynı "görev bitişi" altında gruplanabilsin.
          duty_rest_end_date_iso: p.row.duty_rest_end_date_iso,
          duty_rest_end_time_local: p.row.duty_rest_end_time_local,
        },
        code,
        effectiveDate: day,
        rosterKind: 'duty_off',
      });
    }
  }

  return out;
}

/**
 * Uçuş satırları + SIM / duty_off (FSF/FOF/DUTY/STBY…). Kalkış/iniş TZ: `airports.timezone_iana`.
 */
export async function importPdfFlightsViaRpc(
  supabase: SupabaseClient,
  rows: PdfFlightRow[],
  options?: {
    rawText?: string | null;
    /** Zorunlu: profil `airline_icao`. Yalnızca PGT/THY desteklenir; aksi veya boşsa içe aktarılmaz. */
    crewAirlineIcao?: string | null;
    crewAirlineIata?: string | null;
  }
): Promise<PdfImportRpcResult> {
  const failed: PdfImportRpcResult['failed'] = [];
  const icaoOpt = options?.crewAirlineIcao?.trim();
  let skippedWrongAirline = 0;
  let rowsForPrepare = rows;
  if (!icaoOpt) {
    rowsForPrepare = [];
    skippedWrongAirline = rows.length;
  } else if (!isRosterPdfImportSupportedForCrewAirline(icaoOpt)) {
    rowsForPrepare = [];
    skippedWrongAirline = rows.length;
  } else {
    const { kept, skippedWrongAirline: sw } = filterPdfRowsForCrewAirline(
      rows,
      icaoOpt,
      options?.crewAirlineIata ?? null
    );
    rowsForPrepare = kept;
    skippedWrongAirline = sw;
  }

  const injectStandby = icaoOpt?.toUpperCase() === 'PGT';
  const { prepared, skippedInvalid } = prepareImportRows(rowsForPrepare, options?.rawText ?? null, {
    injectPegasusStandbyFromRawText: injectStandby,
  });
  const preparedExpanded = expandMultiDayDutyRows(prepared);

  let tzMap = new Map<string, string>();
  try {
    const iatas: string[] = [];
    for (const p of preparedExpanded) {
      if (p.rosterKind !== 'flight') continue;
      if (p.row.origin_iata) iatas.push(p.row.origin_iata);
      if (p.row.destination_iata) iatas.push(p.row.destination_iata);
    }
    tzMap = await fetchAirportTimezonesByIata(supabase, iatas);
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[importPdfFlightsViaRpc] airport TZ fetch failed, Istanbul fallback', e);
    }
  }

  let ok = 0;
  let importedFlights = 0;
  let importedNonFlights = 0;
  let skippedIncompleteFlights = 0;

  type RowOutcome =
    | { kind: 'success'; rosterKind: 'flight' | 'duty_off' | 'sim' }
    | {
        kind: 'skip_incomplete';
        entry: { flight_number: string; flight_date: string; message: string };
      }
    | { kind: 'fail'; entry: { flight_number: string; flight_date: string; message: string } };

  const importOnePreparedRow = async (p: PreparedImportRow): Promise<RowOutcome> => {
    const f = coercePdfFlightRowForImport(p.row);
    const hasRoute = !!(f.origin_iata?.trim() && f.destination_iata?.trim());
    const hasUtcPair = !!(f.dep_schedule_utc_iso?.trim() && f.arr_schedule_utc_iso?.trim());
    const hasLocalPair = !!(f.dep_time_local && f.arr_time_local);
    if (p.rosterKind === 'flight' && (!hasRoute || (!hasLocalPair && !hasUtcPair))) {
      return {
        kind: 'skip_incomplete',
        entry: {
          flight_number: p.code,
          flight_date: p.effectiveDate,
          message: 'Incomplete flight row (origin/destination/dep/arr missing)',
        },
      };
    }
    const rowForDate: PdfFlightRow = { ...f, flight_date: p.effectiveDate };
    const oi = f.origin_iata?.trim().toUpperCase() ?? '';
    const di = f.destination_iata?.trim().toUpperCase() ?? '';

    let depIso: string | null = null;
    let arrIso: string | null = null;
    if (p.rosterKind === 'flight') {
      const utcDep = f.dep_schedule_utc_iso?.trim();
      const utcArr = f.arr_schedule_utc_iso?.trim();
      if (utcDep && utcArr) {
        const delta = calendarDaysBetweenYmd(f.flight_date, p.effectiveDate);
        depIso = utcIsoAddCalendarDays(utcDep, delta) ?? utcDep;
        arrIso = utcIsoAddCalendarDays(utcArr, delta) ?? utcArr;
      } else {
        const originTz = oi.length === 3 ? tzMap.get(oi) : undefined;
        const destTz = di.length === 3 ? tzMap.get(di) : undefined;
        const iso = rowToScheduleIso(rowForDate, { originTz: originTz ?? null, destTz: destTz ?? null });
        depIso = iso.depIso;
        arrIso = iso.arrIso;
      }
    } else {
      const startDate = rowForDate.duty_slash_start_date_iso ?? rowForDate.flight_date;
      const startTime = rowForDate.duty_slash_start_time_local ?? rowForDate.duty_start_time_local ?? null;
      // duty_off/sim bloklarında ürün kararı: bitiş = DUTY END (rest end değil).
      const endDate = rowForDate.duty_end_date_iso ?? startDate;
      const endTime = rowForDate.duty_end_time_local ?? null;
      const isSyntheticAllDayDutyOff =
        p.rosterKind === 'duty_off' &&
        !rowForDate.duty_slash_start_date_iso &&
        !rowForDate.duty_slash_start_time_local &&
        startTime === '00:00' &&
        endTime === '23:59' &&
        startDate === endDate;

      if (isSyntheticAllDayDutyOff) {
        // Çok günlü off expand satırları UTC gün sınırında saklansın (00:00Z-23:59Z).
        depIso = utcDayBoundaryIso(startDate, '00:00');
        arrIso = utcDayBoundaryIso(endDate, '23:59');
      } else {
        depIso = localIstanbulToUtcIso(startDate, startTime);
        arrIso = localIstanbulToUtcIso(endDate, endTime);
      }
    }

    const dutyRestEndIso = rowFlightRestEndUtc(rowForDate) ??
      localIstanbulToUtcIso(rowForDate.duty_rest_end_date_iso ?? null, rowForDate.duty_rest_end_time_local ?? null);
    const { data: flightId, error } = await supabase.rpc('add_me_to_flight', {
      p_flight_number: p.code,
      p_flight_date: p.effectiveDate,
      p_origin_airport: p.rosterKind === 'flight' ? f.origin_iata?.trim() || null : null,
      p_destination_airport: p.rosterKind === 'flight' ? f.destination_iata?.trim() || null : null,
      p_scheduled_departure: depIso,
      p_scheduled_arrival: arrIso,
      p_roster_entry_kind: p.rosterKind,
      p_duty_rest_end: dutyRestEndIso,
    });
    if (error) {
      return {
        kind: 'fail',
        entry: { flight_number: p.code, flight_date: p.effectiveDate, message: error.message },
      };
    }
    if (!flightId) {
      return {
        kind: 'fail',
        entry: {
          flight_number: p.code,
          flight_date: p.effectiveDate,
          message: 'Crew profile not found',
        },
      };
    }
    return { kind: 'success', rosterKind: p.rosterKind };
  };

  const outcomes = await Promise.all(preparedExpanded.map((p) => importOnePreparedRow(p)));
  for (const o of outcomes) {
    if (o.kind === 'success') {
      ok += 1;
      if (o.rosterKind === 'flight') importedFlights += 1;
      else importedNonFlights += 1;
    } else if (o.kind === 'skip_incomplete') {
      skippedIncompleteFlights += 1;
      failed.push(o.entry);
    } else {
      failed.push(o.entry);
    }
  }

  // Keep roster window clean: remove memberships older than yesterday.
  try {
    const { data: me } = await supabase.from('crew_profiles').select('id').single();
    const crewId = (me as { id?: string } | null)?.id ?? null;
    if (crewId) {
      const now = new Date();
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yyyy = String(y.getFullYear());
      const mm = String(y.getMonth() + 1).padStart(2, '0');
      const dd = String(y.getDate()).padStart(2, '0');
      const minDate = `${yyyy}-${mm}-${dd}`;
      const { data: fcRows } = await supabase.from('flight_crew').select('flight_id').eq('crew_id', crewId);
      if (fcRows?.length) {
        const ids = fcRows.map((r: { flight_id: string }) => r.flight_id);
        const { data: oldFlights } = await supabase.from('flights').select('id').in('id', ids).lt('flight_date', minDate);
        await Promise.all(
          (oldFlights ?? []).map((f) =>
            supabase.rpc('remove_me_from_flight', { p_flight_id: (f as { id: string }).id }),
          ),
        );
      }
    }
  } catch {
    // Non-fatal cleanup best-effort.
  }

  return {
    ok,
    failed,
    skippedNonFlights: skippedInvalid,
    skippedIncompleteFlights,
    importedFlights,
    importedNonFlights,
    skippedWrongAirline,
  };
}
