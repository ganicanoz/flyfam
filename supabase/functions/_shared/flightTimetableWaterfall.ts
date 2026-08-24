/**
 * Roster / cron timetable: öncelik ADB → AirLabs → FlightAPI (AeroAPI).
 * İlk kaynak “sağlıklı” yanıt verirse sonrakiler çağrılmaz (maliyet).
 * Hiçbiri tek başına yeterli değilse mevcut yanıtlar ADB öncelikli birleştirilir.
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
  source?: 'airlabs' | 'aerodatabox' | 'aeroapi' | 'aviationstack' | 'merged';
};

/** Tam plan (kalkış+varış) veya iptal/divert terminal durumu → sonraki API’ye gerek yok. */
export function timetableRowIsSufficient(row: TimetablePollRowLike | null): boolean {
  if (!row) return false;
  const st = (row.status ?? '').toLowerCase();
  if (st === 'cancelled' || st === 'canceled' || st === 'diverted') return true;
  return Boolean(row.scheduledDep && row.scheduledArr);
}

/** Birinci argüman daha yüksek öncelik (ADB > AL > AeroAPI zincirinde soldaki). */
export function mergeTimetableRowsPreferFirst(
  a: TimetablePollRowLike | null,
  b: TimetablePollRowLike | null,
): TimetablePollRowLike | null {
  if (!a && !b) return null;
  if (!b) return a;
  if (!a) return { ...b, source: b.source ?? 'merged' };
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
    source: 'merged',
  };
}
