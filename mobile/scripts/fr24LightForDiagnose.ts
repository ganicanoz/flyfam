/**
 * FR24 flight-summary/light — CLI tanı için (Expo yok).
 * Seçim mantığı: mobile/lib/flightStatusPoll.ts selectFr24Flight ile uyumlu.
 */
import { utcIsoToLocalDateAtAirport } from '../lib/airportUtcOffset';
import { fr24ScheduledFieldToUtcIso } from '../lib/flightApi';

const FR24_URL = 'https://fr24api.flightradar24.com/api/flight-summary/light';

const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

function flightNumberVariants(flightNumber: string): string[] {
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const variants = [raw];
  const match = raw.match(/^([A-Z]{2})(\d+)$/);
  if (match) {
    const code = match[1]!;
    const num = match[2]!;
    if (num.length === 3) variants.push(`${code}0${num}`);
    if (num.length === 4 && num.startsWith('0')) variants.push(`${code}${num.slice(1)}`);
    const icao = IATA_TO_ICAO[code];
    if (icao) {
      variants.push(`${icao}${num}`);
      if (num.length === 3) variants.push(`${icao}0${num}`);
    }
  }
  return [...new Set(variants)];
}

function toUtcIsoAssumeUtc(dt: string | null | undefined): string | undefined {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? `${s}:00.000Z` : `${s}Z`;
  }
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

type Fr24Leg = Record<string, unknown>;

function fr24LegMatchesRosterDate(f: Fr24Leg, rosterYmd: string): boolean {
  const origin = String(
    (f.orig_icao ?? f.origin_icao ?? f.orig_iata ?? f.origin_iata ?? '') as string,
  ).toUpperCase();
  const depIso =
    toUtcIsoAssumeUtc((f.scheduled_departure_utc ?? f.scheduled_departure) as string | undefined) ??
    toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined) ??
    toUtcIsoAssumeUtc((f.first_seen ?? f.firstSeen) as string | undefined);
  const localDay =
    utcIsoToLocalDateAtAirport(depIso, origin) ?? (depIso ? depIso.slice(0, 10) : '');
  return localDay === rosterYmd;
}

function selectFr24LegLikeApp(list: Fr24Leg[], rosterDate: string): Fr24Leg | null {
  const candidates = list.filter((f) => fr24LegMatchesRosterDate(f, rosterDate));
  if (candidates.length === 0) return null;
  const live = candidates.find((x) => x.flight_ended === false || x.flightEnded === false);
  return (
    live ??
    candidates.sort((a, b) => {
      const oa = String((a.orig_icao ?? a.origin_icao ?? '') as string).toUpperCase();
      const ob = String((b.orig_icao ?? b.origin_icao ?? '') as string).toUpperCase();
      const da = a.scheduled_departure_utc ?? a.scheduled_departure;
      const db = b.scheduled_departure_utc ?? b.scheduled_departure;
      const ia =
        typeof da === 'string' && da.trim()
          ? fr24ScheduledFieldToUtcIso(da, oa, rosterDate)
          : toUtcIsoAssumeUtc(
              (a.datetime_landed ??
                a.datetimeLanded ??
                a.last_seen ??
                a.lastSeen ??
                a.first_seen ??
                a.firstSeen) as string | undefined,
            );
      const ib =
        typeof db === 'string' && db.trim()
          ? fr24ScheduledFieldToUtcIso(db, ob, rosterDate)
          : toUtcIsoAssumeUtc(
              (b.datetime_landed ??
                b.datetimeLanded ??
                b.last_seen ??
                b.lastSeen ??
                b.first_seen ??
                b.firstSeen) as string | undefined,
            );
      const ta = ia ?? '';
      const tb = ib ?? '';
      return tb.localeCompare(ta);
    })[0] ??
    null
  );
}

export type Fr24LightDiagnostic = {
  requestUrl: string;
  httpStatus: number;
  rawJson: unknown;
  dataLegs: Fr24Leg[];
  legsMatchingRosterDate: Fr24Leg[];
  selectedLeg: Fr24Leg | null;
};

export async function fetchFr24LightDiagnostic(
  flightNumber: string,
  rosterYmd: string,
  token: string,
): Promise<Fr24LightDiagnostic> {
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(',');
  const [y, m, d] = rosterYmd.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m! - 1, d! - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m! - 1, d! + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);
  const requestUrl = `${FR24_URL}?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;

  const res = await fetch(requestUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Version': 'v1',
    },
  });
  const httpStatus = res.status;
  const bodyText = await res.text();
  let rawJson: unknown;
  try {
    rawJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    rawJson = { _parseError: true, bodyPreview: bodyText.slice(0, 2000) };
  }

  const data = (rawJson as { data?: unknown })?.data;
  const dataLegs = Array.isArray(data) ? (data as Fr24Leg[]) : [];
  const legsMatchingRosterDate = dataLegs.filter((f) => fr24LegMatchesRosterDate(f, rosterYmd));
  const selectedLeg = selectFr24LegLikeApp(dataLegs, rosterYmd);

  return {
    requestUrl,
    httpStatus,
    rawJson,
    dataLegs,
    legsMatchingRosterDate,
    selectedLeg,
  };
}
