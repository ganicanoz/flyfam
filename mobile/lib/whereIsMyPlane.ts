const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Crew flight cards: show from 12h before scheduled dep until landed,
 * and hide once own-flight Live Track is active.
 */
export function shouldShowWhereIsMyPlane(opts: {
  isCrew: boolean;
  isFlightRow: boolean;
  scheduledDepMs: number;
  nowMs: number;
  isLanded: boolean;
  liveTrackActive?: boolean;
}): boolean {
  if (!opts.isCrew || !opts.isFlightRow || opts.isLanded) return false;
  if (opts.liveTrackActive) return false;
  if (!(opts.scheduledDepMs > 0)) return false;
  const msToDep = opts.scheduledDepMs - opts.nowMs;
  return msToDep <= TWELVE_HOURS_MS;
}

export function fr24AircraftUrlFromRegistration(registration: string | null | undefined): string | null {
  const reg = String(registration ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!reg) return null;
  return `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(reg)}`;
}

/** Only aircraft page — no flight-number fallback (crew must enter reg if missing). */
export function resolveWhereIsMyPlaneUrl(opts: {
  aircraftRegistration?: string | null;
}): { kind: 'registration'; url: string } | null {
  const url = fr24AircraftUrlFromRegistration(opts.aircraftRegistration);
  if (!url) return null;
  return { kind: 'registration', url };
}
