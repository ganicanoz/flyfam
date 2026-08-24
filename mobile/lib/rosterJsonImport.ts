/**
 * `npm run pdf:roster -- file.pdf` çıktısındaki JSON dizisini parse eder — uygulama PDF’den farklı metin üretse bile script ile bire bir aynı satırlar.
 * Tek `{ ... }` nesnesi de kabul edilir (script’ten tek satır kopyala-yapıştır).
 */
import type { PdfFlightRow } from './pdfRosterImport';

function normalizeScriptRow(o: Record<string, unknown>): PdfFlightRow | null {
  const fn = o.flight_number;
  const fd = o.flight_date;
  if (typeof fn !== 'string' || typeof fd !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : v != null ? String(v) : undefined);
  return {
    roster_entry_kind:
      o.roster_entry_kind === 'flight' || o.roster_entry_kind === 'sim' || o.roster_entry_kind === 'duty_off'
        ? o.roster_entry_kind
        : undefined,
    flight_number: fn.trim(),
    flight_date: fd.trim(),
    dep_time_local: str(o.dep_time_local) ?? null,
    arr_time_local: str(o.arr_time_local) ?? null,
    origin_iata: str(o.origin_iata) ?? null,
    destination_iata: str(o.destination_iata) ?? null,
    duty_occupation_code: str(o.duty_occupation_code) ?? null,
    duty_occupation_label_tr: str(o.duty_occupation_label_tr) ?? null,
    duty_occupation_label_en: str(o.duty_occupation_label_en) ?? null,
    duty_start_time_local: str(o.duty_start_time_local) ?? null,
    duty_slash_start_date_iso: str(o.duty_slash_start_date_iso) ?? null,
    duty_slash_start_time_local: str(o.duty_slash_start_time_local) ?? null,
    duty_end_date_iso: str(o.duty_end_date_iso) ?? null,
    duty_end_time_local: str(o.duty_end_time_local) ?? null,
    duty_rest_end_date_iso: str(o.duty_rest_end_date_iso) ?? null,
    duty_rest_end_time_local: str(o.duty_rest_end_time_local) ?? null,
  };
}

export function parseRosterRowsFromScriptJson(raw: string): { rows: PdfFlightRow[]; error: string | null } {
  let s = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
  if (fenced) s = fenced[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { rows: [], error: 'JSON ayrıştırılamadı. Diziyi veya tek nesneyi kontrol et.' };
  }

  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (typeof o.flight_number === 'string' && typeof o.flight_date === 'string') {
      items = [parsed];
    } else {
      return { rows: [], error: 'Kök bir dizi ([...]) veya flight_number + flight_date içeren tek nesne olmalı.' };
    }
  } else {
    return { rows: [], error: 'Geçersiz JSON kökü.' };
  }

  const rows: PdfFlightRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = normalizeScriptRow(item as Record<string, unknown>);
    if (row) rows.push(row);
  }
  if (rows.length === 0) {
    return { rows: [], error: 'flight_number + flight_date olan satır yok.' };
  }
  return { rows, error: null };
}
