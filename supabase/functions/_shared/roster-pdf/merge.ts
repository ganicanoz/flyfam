/**
 * Satır birleştirme ve dedupe — `parseFlightsFromPdfText` iç kullanımı.
 */

import type { PdfFlightRow } from './types.ts';
import { isLikelyFlightNumber } from './textUtils.ts';
import { isStandbyOccupationCode } from './occupationLabels.ts';

export function mergePdfRow(a: PdfFlightRow, b: PdfFlightRow): PdfFlightRow {
  return {
    flight_number: b.flight_number,
    flight_date: b.flight_date,
    roster_entry_kind: b.roster_entry_kind ?? a.roster_entry_kind,
    dep_time_local: b.dep_time_local ?? a.dep_time_local ?? null,
    arr_time_local: b.arr_time_local ?? a.arr_time_local ?? null,
    origin_iata: b.origin_iata ?? a.origin_iata ?? null,
    destination_iata: b.destination_iata ?? a.destination_iata ?? null,
    duty_occupation_code: b.duty_occupation_code ?? a.duty_occupation_code ?? null,
    duty_occupation_label_tr: b.duty_occupation_label_tr ?? a.duty_occupation_label_tr ?? null,
    duty_occupation_label_en: b.duty_occupation_label_en ?? a.duty_occupation_label_en ?? null,
    duty_start_time_local: b.duty_start_time_local ?? a.duty_start_time_local ?? null,
    duty_slash_start_date_iso: b.duty_slash_start_date_iso ?? a.duty_slash_start_date_iso ?? null,
    duty_slash_start_time_local: b.duty_slash_start_time_local ?? a.duty_slash_start_time_local ?? null,
    duty_end_date_iso: b.duty_end_date_iso ?? a.duty_end_date_iso ?? null,
    duty_end_time_local: b.duty_end_time_local ?? a.duty_end_time_local ?? null,
    duty_rest_end_date_iso: b.duty_rest_end_date_iso ?? a.duty_rest_end_date_iso ?? null,
    duty_rest_end_time_local: b.duty_rest_end_time_local ?? a.duty_rest_end_time_local ?? null,
    dep_schedule_utc_iso: b.dep_schedule_utc_iso ?? a.dep_schedule_utc_iso ?? null,
    arr_schedule_utc_iso: b.arr_schedule_utc_iso ?? a.arr_schedule_utc_iso ?? null,
    indigo_roster_detail_en: b.indigo_roster_detail_en ?? a.indigo_roster_detail_en ?? null,
  };
}

export function pdfRowDedupeKey(f: PdfFlightRow): string {
  if (f.roster_entry_kind === 'sim') {
    return `${f.flight_date}|${f.flight_number || 'SIM'}|${f.duty_occupation_code ?? ''}|${f.duty_start_time_local ?? ''}|${f.duty_end_time_local ?? ''}`;
  }
  if (f.roster_entry_kind === 'duty_off') {
    const code = (f.flight_number || f.duty_occupation_code || '').replace(/\s/g, '').toUpperCase();
    if (isStandbyOccupationCode(code)) {
      return `${f.flight_date}|standby`;
    }
    return `${f.flight_date}|${f.flight_number}|${f.duty_start_time_local ?? ''}|${f.duty_end_time_local ?? ''}|${f.duty_rest_end_time_local ?? ''}`;
  }
  return `${f.flight_date}|${f.flight_number}`;
}

export function rosterEntrySortRank(r: PdfFlightRow): number {
  if (r.roster_entry_kind === 'flight' || r.roster_entry_kind == null) return 0;
  return 1;
}

/**
 * Tek-satır duty fallback bazen aynı PCxxxx için duty çekirdeğinden **farklı** `flight_date` üretir (ör. 1259 → 20 Mart yerine başka gün).
 * Çekirdekte o no için en az bir `roster_entry_kind === 'flight'` varsa, kind’siz ve tarihi o no’nun duty tarihleriyle **örtüşmeyen** satırları at.
 */
export function dropSingleLineFlightDateGhosts(rows: PdfFlightRow[]): PdfFlightRow[] {
  const dutyDatesByFn = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.roster_entry_kind !== 'flight') continue;
    const fn = r.flight_number.replace(/\s/g, '').toUpperCase();
    if (!isLikelyFlightNumber(fn)) continue;
    if (!dutyDatesByFn.has(fn)) dutyDatesByFn.set(fn, new Set());
    dutyDatesByFn.get(fn)!.add(r.flight_date);
  }
  return rows.filter((r) => {
    if (r.roster_entry_kind === 'sim' || r.roster_entry_kind === 'duty_off') return true;
    if (r.roster_entry_kind === 'flight') return true;
    const fn = r.flight_number.replace(/\s/g, '').toUpperCase();
    if (!isLikelyFlightNumber(fn)) return true;
    const dates = dutyDatesByFn.get(fn);
    if (!dates || dates.size === 0) return true;
    return dates.has(r.flight_date);
  });
}
