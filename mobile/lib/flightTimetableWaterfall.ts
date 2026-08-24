/**
 * Roster poll timetable: öncelik ADB → AirLabs → FlightAPI (AeroAPI).
 * İlk kaynak “sağlıklı” yanıt verirse sonrakiler çağrılmaz.
 */

export type TimetablePollRowLike = {
  scheduledDep: string | null;
  scheduledArr: string | null;
  status: string | null;
  divertedTo: string | null;
  delayDepMin: number | null;
  delayArrMin: number | null;
  progressPercent: number | null;
  actualOut?: string | null;
  actualIn?: string | null;
};

export function timetableRowIsSufficient(row: TimetablePollRowLike | null): boolean {
  if (!row) return false;
  const st = (row.status ?? '').toLowerCase();
  if (st === 'cancelled' || st === 'canceled' || st === 'diverted') return true;
  return Boolean(row.scheduledDep && row.scheduledArr);
}

export function mergeTimetableRowsPreferFirst(
  a: TimetablePollRowLike | null,
  b: TimetablePollRowLike | null,
): TimetablePollRowLike | null {
  if (!a && !b) return null;
  if (!b) return a;
  if (!a) return { ...b };
  return {
    scheduledDep: a.scheduledDep ?? b.scheduledDep,
    scheduledArr: a.scheduledArr ?? b.scheduledArr,
    status: a.status ?? b.status,
    divertedTo: a.divertedTo ?? b.divertedTo,
    delayDepMin: b.delayDepMin ?? a.delayDepMin,
    delayArrMin: b.delayArrMin ?? a.delayArrMin,
    progressPercent: b.progressPercent ?? a.progressPercent,
    actualOut: (a.actualOut ?? b.actualOut) ?? null,
    actualIn: (a.actualIn ?? b.actualIn) ?? null,
  };
}
