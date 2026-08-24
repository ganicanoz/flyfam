/** Hub tahta önbelleği: gün/slot Europe/Istanbul — Edge sync-hub-airport-boards ile aynı. */

export function istanbulCalendarDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}

export function istanbulHour0to23(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')?.value;
  const n = h != null ? Number(h) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function istanbulHalfDaySlot(now: Date = new Date()): number {
  return Math.floor(istanbulHour0to23(now) / 12);
}

export function istanbulSlotKey(now: Date = new Date()): string {
  return `${istanbulCalendarDate(now)}_h${istanbulHalfDaySlot(now)}`;
}

export function nextCalendarDayYmd(ymd: string): string {
  const [yy, mm, dd] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(yy, (mm ?? 1) - 1, dd ?? 1, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
