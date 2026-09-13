import type { PdfFlightRow } from './types.ts';
import { dutyClockToUtcIso } from './timeAndSchedule.ts';

/** Uçuş satırı: slash tablodan dinlenme sonu (DUTY) — basis’e göre UTC. */
export function rowFlightRestEndUtc(f: PdfFlightRow, timeZone?: string | null): string | null {
  if (!f.duty_rest_end_date_iso || !f.duty_rest_end_time_local) return null;
  return dutyClockToUtcIso(
    f.duty_rest_end_date_iso,
    f.duty_rest_end_time_local,
    f.duty_clock_basis,
    0,
    timeZone,
  );
}

/** duty_off ve sim: PDF görev penceresi → UTC (`timeZone` = home base IANA; basis=utc ise yok sayılır). */
export function rowRosterBlockDutyTimesUtc(
  f: PdfFlightRow,
  timeZone?: string | null,
): {
  dutyStartIso: string | null;
  dutyEndIso: string | null;
  restEndIso: string | null;
} {
  if (f.roster_entry_kind !== 'duty_off' && f.roster_entry_kind !== 'sim') {
    return { dutyStartIso: null, dutyEndIso: null, restEndIso: null };
  }
  const basis = f.duty_clock_basis;
  const dutyStartIso =
    f.flight_date && f.duty_start_time_local
      ? dutyClockToUtcIso(f.flight_date, f.duty_start_time_local, basis, 0, timeZone)
      : null;
  const endYmd = f.duty_end_date_iso ?? f.flight_date;
  const dutyEndIso =
    f.duty_end_time_local && endYmd
      ? dutyClockToUtcIso(endYmd, f.duty_end_time_local, basis, 0, timeZone)
      : null;
  let restEndIso: string | null = null;
  if (f.roster_entry_kind === 'duty_off' && f.duty_rest_end_date_iso && f.duty_rest_end_time_local) {
    restEndIso = dutyClockToUtcIso(
      f.duty_rest_end_date_iso,
      f.duty_rest_end_time_local,
      basis,
      0,
      timeZone,
    );
  }
  return { dutyStartIso, dutyEndIso, restEndIso };
}

/** @deprecated Aynı mantık için rowRosterBlockDutyTimesUtc kullanın */
export function rowDutyOffTimesUtc(
  f: PdfFlightRow,
  timeZone?: string | null,
): {
  dutyStartIso: string | null;
  dutyEndIso: string | null;
  restEndIso: string | null;
} {
  if (f.roster_entry_kind !== 'duty_off') {
    return { dutyStartIso: null, dutyEndIso: null, restEndIso: null };
  }
  return rowRosterBlockDutyTimesUtc(f, timeZone);
}
