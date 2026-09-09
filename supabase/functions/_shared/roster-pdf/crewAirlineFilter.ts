/**
 * Crew profil ICAO’suna göre PDF satır filtresi (uygulama import ile aynı).
 */
import {
  looksLikeFreebirdRosterPdf,
  looksLikeIndigoCrewSchedulePdf,
  looksLikePegasusDutyStylePdf,
  looksLikeSunExpressSchedulePdf,
  looksLikeThyCrewRosterPdf,
  normalizePdfTextForRosterParse,
} from './normalize.ts';
import type { PdfFlightRow } from './types.ts';

export const ROSTER_PDF_IMPORT_SUPPORTED_AIRLINE_ICAOS = ['PGT', 'THY', 'SXS', 'FHY', 'IGO'] as const;

/** Pegasus resmi ICAO: `PGT`. Profilde sık yazılan `PGS` → `PGT`. */
export function normalizeCrewAirlineIcaoTypo(icao: string | null | undefined): string {
  if (!icao?.trim()) return '';
  const u = icao.replace(/\s/g, '').toUpperCase();
  if (u === 'PGS') return 'PGT';
  return u;
}

export function isRosterPdfImportSupportedForCrewAirline(icao: string | null | undefined): boolean {
  const u = normalizeCrewAirlineIcaoTypo(icao);
  if (!u) return false;
  return (ROSTER_PDF_IMPORT_SUPPORTED_AIRLINE_ICAOS as readonly string[]).includes(u);
}

function normalizeCode(code: string | null | undefined): string {
  const normalized = (code || '').replace(/\s/g, '').toUpperCase();
  if (/^FSF\d{1,3}$/.test(normalized)) return 'FSF';
  if (/^FOF\d{1,3}$/.test(normalized)) return 'FOF';
  if (/^MSF\d{1,3}$/.test(normalized)) return 'MSF';
  if (/^VAV\d{1,3}$/.test(normalized)) return 'VAV';
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
function isFhFlightCode(code: string): boolean {
  return /^FH\d{2,4}$/.test(code);
}
function is6eFlightCode(code: string): boolean {
  return /^6E\d{3,4}$/i.test(code);
}

/**
 * Yalnızca desteklenen ICAO için çağrılmalı.
 * PGT: PC… + DH + duty_off/sim · THY: TK… + duty · SXS: XQ… · FHY: FH… · IGO: 6E…
 */
export function filterPdfRowsForCrewAirline(
  rows: PdfFlightRow[],
  crewAirlineIcao: string,
  _crewAirlineIata?: string | null,
): { kept: PdfFlightRow[]; skippedWrongAirline: number } {
  const icao = normalizeCrewAirlineIcaoTypo(crewAirlineIcao);
  const kept: PdfFlightRow[] = [];
  let skippedWrongAirline = 0;
  for (const r of rows) {
    const code = normalizeCode(r.flight_number);
    if (icao === 'PGT') {
      if (isPcFlightCode(code) || code === 'DH' || r.roster_entry_kind === 'duty_off' || r.roster_entry_kind === 'sim') {
        kept.push(r);
      } else skippedWrongAirline += 1;
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
      } else skippedWrongAirline += 1;
      continue;
    }
    if (icao === 'FHY') {
      if (isFhFlightCode(code) || code === 'DH' || r.roster_entry_kind === 'duty_off' || r.roster_entry_kind === 'sim') {
        kept.push(r);
      } else skippedWrongAirline += 1;
      continue;
    }
    if (icao === 'IGO') {
      if (is6eFlightCode(code) || code === 'DH' || r.roster_entry_kind === 'duty_off' || r.roster_entry_kind === 'sim') {
        kept.push(r);
      } else skippedWrongAirline += 1;
      continue;
    }
    skippedWrongAirline += 1;
  }
  return { kept, skippedWrongAirline };
}

export type DetectedRosterLayout =
  | 'indigo'
  | 'thy'
  | 'sunexpress'
  | 'freebird'
  | 'pegasus'
  | 'unknown';

/** Uygulama `parseFlightsFromPdfText` ile aynı heuristic sırası. */
export function detectRosterPdfLayout(text: string): DetectedRosterLayout {
  const raw = (text || '').replace(/\r\n/g, '\n');
  if (looksLikeIndigoCrewSchedulePdf(raw)) return 'indigo';
  const normalized = normalizePdfTextForRosterParse(text);
  if (looksLikeThyCrewRosterPdf(normalized)) return 'thy';
  if (looksLikeSunExpressSchedulePdf(normalized)) return 'sunexpress';
  if (looksLikeFreebirdRosterPdf(normalized)) return 'freebird';
  if (looksLikePegasusDutyStylePdf(normalized)) return 'pegasus';
  return 'unknown';
}
