import type { PdfFlightRow } from './pdfRosterImport';
import { parseFlightsFromPdfText } from './pdfRosterImport';

export function mergePdfRowsPreferRicher(a: PdfFlightRow, b: PdfFlightRow): PdfFlightRow {
  return {
    ...a,
    ...b,
    roster_entry_kind: b.roster_entry_kind ?? a.roster_entry_kind,
    dep_time_local: b.dep_time_local ?? a.dep_time_local,
    arr_time_local: b.arr_time_local ?? a.arr_time_local,
    dep_schedule_utc_iso: b.dep_schedule_utc_iso ?? a.dep_schedule_utc_iso,
    arr_schedule_utc_iso: b.arr_schedule_utc_iso ?? a.arr_schedule_utc_iso,
    origin_iata: b.origin_iata ?? a.origin_iata,
    destination_iata: b.destination_iata ?? a.destination_iata,
    duty_occupation_code: b.duty_occupation_code ?? a.duty_occupation_code,
    duty_occupation_label_tr: b.duty_occupation_label_tr ?? a.duty_occupation_label_tr,
    duty_occupation_label_en: b.duty_occupation_label_en ?? a.duty_occupation_label_en,
    duty_start_time_local: b.duty_start_time_local ?? a.duty_start_time_local,
    duty_slash_start_date_iso: b.duty_slash_start_date_iso ?? a.duty_slash_start_date_iso,
    duty_slash_start_time_local: b.duty_slash_start_time_local ?? a.duty_slash_start_time_local,
    duty_end_date_iso: b.duty_end_date_iso ?? a.duty_end_date_iso,
    duty_end_time_local: b.duty_end_time_local ?? a.duty_end_time_local,
    duty_rest_end_date_iso: b.duty_rest_end_date_iso ?? a.duty_rest_end_date_iso,
    duty_rest_end_time_local: b.duty_rest_end_time_local ?? a.duty_rest_end_time_local,
    indigo_roster_detail_en: b.indigo_roster_detail_en ?? a.indigo_roster_detail_en ?? null,
  };
}

function pdfRowMergeKey(r: PdfFlightRow): string {
  return `${(r.flight_date || '').trim()}|${(r.flight_number || '').replace(/\s/g, '').toUpperCase()}|${(r.roster_entry_kind || '').trim()}|${(r.duty_occupation_code || '').trim()}|${(r.duty_start_time_local || '').trim()}`;
}

export function mergePdfRowsByKey(primary: PdfFlightRow[], extra: PdfFlightRow[]): PdfFlightRow[] {
  const map = new Map<string, PdfFlightRow>();
  for (const r of primary) map.set(pdfRowMergeKey(r), r);
  for (const r of extra) {
    const k = pdfRowMergeKey(r);
    const prev = map.get(k);
    map.set(k, prev ? mergePdfRowsPreferRicher(prev, r) : r);
  }
  return [...map.values()];
}

/** Edge / cihaz metninden eksik sim ve duty satırlarını tamamla. */
export function mergePdfRowsFromTextParse(primary: PdfFlightRow[], text: string): PdfFlightRow[] {
  const trimmed = text.trim();
  if (!trimmed) return primary;
  return mergePdfRowsByKey(primary, parseFlightsFromPdfText(trimmed));
}
