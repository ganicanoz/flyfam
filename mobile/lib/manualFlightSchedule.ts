/**
 * Manuel uçuş ekleme: havalimanı yerel HH:MM → planlı UTC ISO (kalkış/varış çifti).
 */
import { airportLocalDateTimeToUtcIso } from './airportUtcOffset';

const HHMM = /^\d{1,2}:\d{2}$/;

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Yerel saat (önizlemede düzenlenen) önceliklidir; API `scheduled_*_utc` yalnız yerel saat boşsa kullanılır.
 * Havalimanı saat dilimi bilinmiyorsa saat UTC kabul edilir.
 */
export function resolveManualScheduledUtcIso(
  dateYmd: string,
  hhmm: string | null | undefined,
  airportCode: string | null | undefined,
  apiUtc: string | null | undefined,
): string | null {
  const time = (hhmm ?? '').trim();
  if (time && HHMM.test(time)) {
    return airportLocalDateTimeToUtcIso(dateYmd, time, airportCode) ?? null;
  }
  const api = apiUtc ? String(apiUtc).trim() : '';
  return api || null;
}

/** Varış kalkıştan önce/aynı anda çıkarsa varış yerel saati ertesi güne aittir (gece yarısını geçen uçuş). */
export function resolveManualSchedulePair(input: {
  dateYmd: string;
  depHhmm: string | null | undefined;
  arrHhmm: string | null | undefined;
  originCode: string | null | undefined;
  destCode: string | null | undefined;
  apiDepUtc?: string | null;
  apiArrUtc?: string | null;
}): { dep: string | null; arr: string | null } {
  const dep = resolveManualScheduledUtcIso(input.dateYmd, input.depHhmm, input.originCode, input.apiDepUtc);
  let arr = resolveManualScheduledUtcIso(input.dateYmd, input.arrHhmm, input.destCode, input.apiArrUtc);
  const depMs = dep ? Date.parse(dep) : NaN;
  const arrMs = arr ? Date.parse(arr) : NaN;
  if (Number.isFinite(depMs) && Number.isFinite(arrMs) && arrMs <= depMs) {
    const nextDay = HHMM.test((input.arrHhmm ?? '').trim())
      ? resolveManualScheduledUtcIso(addDaysYmd(input.dateYmd, 1), input.arrHhmm, input.destCode, null)
      : null;
    arr = nextDay && Date.parse(nextDay) > depMs ? nextDay : new Date(arrMs + 24 * 60 * 60 * 1000).toISOString();
  }
  return { dep, arr };
}
