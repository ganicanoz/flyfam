import type { PdfFlightRow } from './types.ts';
import { trLocalDateTimeToUtcIso } from './timeAndSchedule.ts';

/** Uçuş satırı: slash tablodan dinlenme sonu (DUTY) — TR yerel → UTC. */
export function rowFlightRestEndUtc(f: PdfFlightRow): string | null {
  if (!f.duty_rest_end_date_iso || !f.duty_rest_end_time_local) return null;
  return trLocalDateTimeToUtcIso(f.duty_rest_end_date_iso, f.duty_rest_end_time_local);
}

/** duty_off ve sim: PDF görev penceresi → UTC (TR+3). Dinlenme sonu yalnızca duty_off. */
export function rowRosterBlockDutyTimesUtc(f: PdfFlightRow): {
  dutyStartIso: string | null;
  dutyEndIso: string | null;
  restEndIso: string | null;
} {
  if (f.roster_entry_kind !== 'duty_off' && f.roster_entry_kind !== 'sim') {
    return { dutyStartIso: null, dutyEndIso: null, restEndIso: null };
  }
  const dutyStartIso =
    f.flight_date && f.duty_start_time_local
      ? trLocalDateTimeToUtcIso(f.flight_date, f.duty_start_time_local)
      : null;
  const endYmd = f.duty_end_date_iso ?? f.flight_date;
  const dutyEndIso =
    f.duty_end_time_local && endYmd ? trLocalDateTimeToUtcIso(endYmd, f.duty_end_time_local) : null;
  let restEndIso: string | null = null;
  if (f.roster_entry_kind === 'duty_off' && f.duty_rest_end_date_iso && f.duty_rest_end_time_local) {
    restEndIso = trLocalDateTimeToUtcIso(f.duty_rest_end_date_iso, f.duty_rest_end_time_local);
  }
  return { dutyStartIso, dutyEndIso, restEndIso };
}

/** @deprecated Aynı mantık için rowRosterBlockDutyTimesUtc kullanın */
export function rowDutyOffTimesUtc(f: PdfFlightRow): {
  dutyStartIso: string | null;
  dutyEndIso: string | null;
  restEndIso: string | null;
} {
  if (f.roster_entry_kind !== 'duty_off') {
    return { dutyStartIso: null, dutyEndIso: null, restEndIso: null };
  }
  return rowRosterBlockDutyTimesUtc(f);
}
