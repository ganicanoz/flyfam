/**
 * Admin uçuş özeti: DB + birleşik API snapshot; ayrıca `formatPollTraceForAdminDisplay` ile kaynak bazlı endpoint/yanıt.
 */
import type { FlightInfo } from './flightApi';
import type { FlightPollTraceEntry } from './flightStatusPoll';

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '—' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function L(locale: 'tr' | 'en') {
  return locale === 'tr'
    ? {
        route: 'Güzergâh',
        schedDep: 'Planlı kalkış (UTC)',
        schedArr: 'Planlı varış (UTC)',
        estDep: 'Tahmini kalkış (UTC)',
        estArr: 'Tahmini varış (UTC)',
        actDep: 'Gerçek kalkış (UTC)',
        actArr: 'Gerçek iniş (UTC)',
        flightStatus: 'Uçuş statüsü',
        internalStatus: 'İç statü',
        phaseDb: 'Faz (veritabanı)',
        phaseClient: 'Faz (istemci, şimdi)',
        pollPhase: 'Son API sorgu fazı',
        delayed: 'Gecikme bayrağı',
        delayDep: 'Gecikme kalkış (dk)',
        delayArr: 'Gecikme varış (dk)',
        diverted: 'Yönlendirildi',
        fr24Takeoff: 'FR24 kalkış (UTC)',
        fr24Landed: 'FR24 iniş (UTC)',
        fr24ProgDep: 'FR24 çubuk başı (UTC)',
        fr24ProgEta: 'FR24 çubuk ETA (UTC)',
        alPct: 'AirLabs ilerleme %',
        lastSeen: 'Son track (UTC)',
        lastPoll: 'Son poll (UTC)',
        updated: 'DB güncellendi',
        apiRoute: 'Güzergâh (API)',
        apiStatus: 'Statü (API)',
        apiEnded: 'Uçuş bitti (API)',
        apiSchedDep: 'Planlı kalkış (API, UTC)',
        apiSchedArr: 'Planlı varış (API, UTC)',
        apiActDep: 'Gerçek kalkış (API, UTC)',
        apiActArr: 'Gerçek iniş (API, UTC)',
        apiDelayed: 'Gecikmeli (API)',
        apiDelayDep: 'Gecikme kalkış (API, dk)',
        apiDelayArr: 'Gecikme varış (API, dk)',
        revisedSignal: 'Revised/estimated sinyali',
        apiNextDay: 'Ertesi gün ipucu (API)',
        apiDivert: 'Yönlendirme (API)',
        apiFr24Id: 'FR24 uçuş kimliği',
        apiTakeoff: 'Kalkış zamanı (API, UTC)',
        apiLand: 'İniş zamanı (API, UTC)',
        apiAlPct: 'AirLabs % (API)',
        apiLive: 'Canlı (API)',
      }
    : {
        route: 'Route',
        schedDep: 'Scheduled dep (UTC)',
        schedArr: 'Scheduled arr (UTC)',
        estDep: 'Estimated dep (UTC)',
        estArr: 'Estimated arr (UTC)',
        actDep: 'Actual dep (UTC)',
        actArr: 'Actual arr (UTC)',
        flightStatus: 'Flight status',
        internalStatus: 'Internal status',
        phaseDb: 'Phase (DB)',
        phaseClient: 'Phase (client, now)',
        pollPhase: 'Last API poll phase',
        delayed: 'Delayed flag',
        delayDep: 'Delay dep (min)',
        delayArr: 'Delay arr (min)',
        diverted: 'Diverted to',
        fr24Takeoff: 'FR24 takeoff (UTC)',
        fr24Landed: 'FR24 landed (UTC)',
        fr24ProgDep: 'FR24 bar start (UTC)',
        fr24ProgEta: 'FR24 bar ETA (UTC)',
        alPct: 'AirLabs progress %',
        lastSeen: 'Last track (UTC)',
        lastPoll: 'Last poll (UTC)',
        updated: 'DB updated',
        apiRoute: 'Route (API)',
        apiStatus: 'Status (API)',
        apiEnded: 'Flight ended (API)',
        apiSchedDep: 'Sched dep (API, UTC)',
        apiSchedArr: 'Sched arr (API, UTC)',
        apiActDep: 'Actual dep (API, UTC)',
        apiActArr: 'Actual arr (API, UTC)',
        apiDelayed: 'Delayed (API)',
        apiDelayDep: 'Delay dep (API, min)',
        apiDelayArr: 'Delay arr (API, min)',
        revisedSignal: 'Revised/estimated signal',
        apiNextDay: 'Next-day hint (API)',
        apiDivert: 'Diverted (API)',
        apiFr24Id: 'FR24 flight id',
        apiTakeoff: 'Takeoff (API, UTC)',
        apiLand: 'Landing (API, UTC)',
        apiAlPct: 'AirLabs % (API)',
        apiLive: 'Live (API)',
      };
}

export type AdminFlightPhaseMeta = {
  dbPhase: string;
  clientPhase: string | null;
  pollPhase: string;
};

/** Veritabanı satırı — roster için anlamlı sonuç alanları. */
export function buildDbFlightSnapshotLines(
  row: Record<string, unknown>,
  locale: 'tr' | 'en',
  phase?: AdminFlightPhaseMeta,
): string[] {
  const t = L(locale);
  const o = fmtVal(row.origin_airport);
  const d = fmtVal(row.destination_airport);
  const oc = fmtVal(row.origin_city);
  const dc = fmtVal(row.destination_city);
  const route =
    o !== '—' || d !== '—'
      ? `${o} → ${d}${oc !== '—' || dc !== '—' ? ` (${oc} → ${dc})` : ''}`
      : '—';

  const lines: string[] = [
    `${t.route}: ${route}`,
    `${t.schedDep}: ${fmtVal(row.scheduled_departure)}`,
    `${t.schedArr}: ${fmtVal(row.scheduled_arrival)}`,
    `${t.estDep}: ${fmtVal(row.estimated_departure)}`,
    `${t.estArr}: ${fmtVal(row.estimated_arrival)}`,
    `${t.actDep}: ${fmtVal(row.actual_departure)}`,
    `${t.actArr}: ${fmtVal(row.actual_arrival)}`,
    `${t.flightStatus}: ${fmtVal(row.flight_status)}`,
    `${t.internalStatus}: ${fmtVal(row.internal_status)}`,
    `${t.delayed}: ${fmtVal(row.is_delayed)}`,
    `${t.delayDep}: ${fmtVal(row.delay_dep_min)}`,
    `${t.delayArr}: ${fmtVal(row.delay_arr_min)}`,
    `${t.diverted}: ${fmtVal(row.diverted_to)}`,
    `${t.fr24Takeoff}: ${fmtVal(row.fr24_datetime_takeoff_utc)}`,
    `${t.fr24Landed}: ${fmtVal(row.fr24_datetime_landed_utc)}`,
    `${t.fr24ProgDep}: ${fmtVal(row.fr24_progress_dep_utc)}`,
    `${t.fr24ProgEta}: ${fmtVal(row.fr24_progress_eta_utc)}`,
    `${t.alPct}: ${fmtVal(row.airlabs_progress_percent)}`,
    `${t.lastSeen}: ${fmtVal(row.last_seen_utc)}`,
    `${t.lastPoll}: ${fmtVal(row.last_poll_at)}`,
    `${t.updated}: ${fmtVal(row.updated_at)}`,
  ];

  if (phase) {
    lines.push(
      `${t.phaseDb}: ${phase.dbPhase}`,
      `${t.phaseClient}: ${phase.clientPhase ?? '—'}`,
      `${t.pollPhase}: ${phase.pollPhase}`,
    );
  }

  return lines;
}

/** Admin: tek tabloda DB ↔ son birleşik poll karşılaştırması (mükerrer blokları önler). */
export type AdminComparisonRow = { label: string; db: string; api: string };

export function buildAdminDbApiComparisonRows(
  row: Record<string, unknown>,
  info: FlightInfo | null,
  locale: 'tr' | 'en',
  phase?: AdminFlightPhaseMeta,
): AdminComparisonRow[] {
  const t = L(locale);
  const o = fmtVal(row.origin_airport);
  const d = fmtVal(row.destination_airport);
  const oc = fmtVal(row.origin_city);
  const dc = fmtVal(row.destination_city);
  const dbRoute =
    o !== '—' || d !== '—'
      ? `${o} → ${d}${oc !== '—' || dc !== '—' ? ` (${oc} → ${dc})` : ''}`
      : '—';

  const apiTakeoff = info ? info.fr24_datetime_takeoff_utc ?? info.datetime_takeoff_utc : undefined;
  const apiLand = info ? info.fr24_datetime_landed_utc ?? info.datetime_landed_utc : undefined;

  const liveStr = (() => {
    if (!info) return '—';
    const liveParts: string[] = [];
    if (info.altitudeFt != null && Number.isFinite(info.altitudeFt)) {
      liveParts.push(`ALT ${Math.round(info.altitudeFt)} ft`);
    }
    if (info.groundSpeedKts != null && Number.isFinite(info.groundSpeedKts)) {
      liveParts.push(`GS ${Math.round(info.groundSpeedKts)} kt`);
    }
    if (info.lastTrackUtc) liveParts.push(info.lastTrackUtc);
    return liveParts.length ? liveParts.join(' · ') : '—';
  })();

  const apiO = info?.origin?.trim() || '—';
  const apiD = info?.destination?.trim() || '—';
  const apiOc = info?.originCity?.trim();
  const apiDc = info?.destinationCity?.trim();
  const apiRoute =
    info && (apiO !== '—' || apiD !== '—')
      ? `${apiO} → ${apiD}${
          (apiOc && apiOc.length > 0) || (apiDc && apiDc.length > 0)
            ? ` (${fmtVal(apiOc)} → ${fmtVal(apiDc)})`
            : ''
        }`
      : '—';

  const trackLabel = locale === 'tr' ? 'Son track / canlı' : 'Last track / live';
  const parseMs = (v: unknown): number => {
    if (typeof v !== 'string' || !v) return NaN;
    const ms = new Date(v).getTime();
    return Number.isFinite(ms) ? ms : NaN;
  };
  const revisedSignal = (() => {
    const dbEstDep = parseMs(row.estimated_departure);
    const dbSchDep = parseMs(row.scheduled_departure);
    const dbEstArr = parseMs(row.estimated_arrival);
    const dbSchArr = parseMs(row.scheduled_arrival);
    const apiEstDep = parseMs(info?.scheduled_departure_utc);
    const apiSchDep = parseMs(row.scheduled_departure);
    const depShift =
      (Number.isFinite(dbEstDep) && Number.isFinite(dbSchDep) && Math.abs(dbEstDep - dbSchDep) >= 5 * 60_000) ||
      (Number.isFinite(apiEstDep) && Number.isFinite(apiSchDep) && Math.abs(apiEstDep - apiSchDep) >= 5 * 60_000);
    const arrShift =
      Number.isFinite(dbEstArr) && Number.isFinite(dbSchArr) && Math.abs(dbEstArr - dbSchArr) >= 5 * 60_000;
    return depShift || arrShift;
  })();

  const rows: AdminComparisonRow[] = [
    { label: t.route, db: dbRoute, api: apiRoute },
    { label: t.schedDep, db: fmtVal(row.scheduled_departure), api: info ? fmtVal(info.scheduled_departure_utc) : '—' },
    { label: t.schedArr, db: fmtVal(row.scheduled_arrival), api: info ? fmtVal(info.scheduled_arrival_utc) : '—' },
    { label: t.estDep, db: fmtVal(row.estimated_departure), api: '—' },
    { label: t.estArr, db: fmtVal(row.estimated_arrival), api: '—' },
    { label: t.actDep, db: fmtVal(row.actual_departure), api: info ? fmtVal(info.actual_departure_utc) : '—' },
    { label: t.actArr, db: fmtVal(row.actual_arrival), api: info ? fmtVal(info.actual_arrival_utc) : '—' },
    { label: t.flightStatus, db: fmtVal(row.flight_status), api: info ? fmtVal(info.flightStatus) : '—' },
    { label: t.internalStatus, db: fmtVal(row.internal_status), api: '—' },
    { label: t.delayed, db: fmtVal(row.is_delayed), api: info ? fmtVal(info.delayed) : '—' },
    { label: t.delayDep, db: fmtVal(row.delay_dep_min), api: info ? fmtVal(info.delayDepMin) : '—' },
    { label: t.delayArr, db: fmtVal(row.delay_arr_min), api: info ? fmtVal(info.delayArrMin) : '—' },
    { label: t.revisedSignal, db: revisedSignal ? 'yes' : 'no', api: '—' },
    { label: t.diverted, db: fmtVal(row.diverted_to), api: info ? fmtVal(info.divertedTo) : '—' },
    { label: t.fr24Takeoff, db: fmtVal(row.fr24_datetime_takeoff_utc), api: info ? fmtVal(apiTakeoff) : '—' },
    { label: t.fr24Landed, db: fmtVal(row.fr24_datetime_landed_utc), api: info ? fmtVal(apiLand) : '—' },
    { label: t.fr24ProgDep, db: fmtVal(row.fr24_progress_dep_utc), api: info ? fmtVal(info.fr24_progress_dep_utc) : '—' },
    { label: t.fr24ProgEta, db: fmtVal(row.fr24_progress_eta_utc), api: info ? fmtVal(info.fr24_progress_eta_utc) : '—' },
    { label: t.alPct, db: fmtVal(row.airlabs_progress_percent), api: info ? fmtVal(info.airlabsProgressPercent) : '—' },
    { label: trackLabel, db: fmtVal(row.last_seen_utc), api: liveStr },
    { label: t.apiEnded, db: '—', api: info ? fmtVal(info.flightEnded) : '—' },
    { label: t.apiNextDay, db: '—', api: info ? fmtVal(info.nextDayHint) : '—' },
    { label: t.apiFr24Id, db: '—', api: info ? fmtVal(info.fr24Id) : '—' },
    { label: t.lastPoll, db: fmtVal(row.last_poll_at), api: '—' },
    { label: t.updated, db: fmtVal(row.updated_at), api: '—' },
  ];

  if (phase) {
    rows.push(
      { label: t.phaseDb, db: phase.dbPhase, api: '—' },
      { label: t.phaseClient, db: phase.clientPhase ?? '—', api: '—' },
      { label: t.pollPhase, db: phase.pollPhase, api: '—' },
    );
  }

  return rows;
}

/** `pollFlightForRoster` / flight-lookup sonucu — özet. */
export function buildApiFlightSnapshotLines(info: FlightInfo, locale: 'tr' | 'en'): string[] {
  const t = L(locale);
  const o = info.origin || '—';
  const d = info.destination || '—';
  const route = `${o} → ${d}`;
  const takeoff = info.fr24_datetime_takeoff_utc ?? info.datetime_takeoff_utc;
  const land = info.fr24_datetime_landed_utc ?? info.datetime_landed_utc;
  const liveParts: string[] = [];
  if (info.altitudeFt != null && Number.isFinite(info.altitudeFt)) liveParts.push(`ALT ${Math.round(info.altitudeFt)} ft`);
  if (info.groundSpeedKts != null && Number.isFinite(info.groundSpeedKts)) liveParts.push(`GS ${Math.round(info.groundSpeedKts)} kt`);
  if (info.lastTrackUtc) liveParts.push(info.lastTrackUtc);
  const live = liveParts.length ? liveParts.join(' · ') : '—';

  return [
    `${t.apiRoute}: ${route}`,
    `${t.apiStatus}: ${fmtVal(info.flightStatus)}`,
    `${t.apiEnded}: ${fmtVal(info.flightEnded)}`,
    `${t.apiSchedDep}: ${fmtVal(info.scheduled_departure_utc)}`,
    `${t.apiSchedArr}: ${fmtVal(info.scheduled_arrival_utc)}`,
    `${t.apiActDep}: ${fmtVal(info.actual_departure_utc)}`,
    `${t.apiActArr}: ${fmtVal(info.actual_arrival_utc)}`,
    `${t.apiDelayed}: ${fmtVal(info.delayed)}`,
    `${t.apiDelayDep}: ${fmtVal(info.delayDepMin)}`,
    `${t.apiDelayArr}: ${fmtVal(info.delayArrMin)}`,
    `${t.apiNextDay}: ${fmtVal(info.nextDayHint)}`,
    `${t.apiDivert}: ${fmtVal(info.divertedTo)}`,
    `${t.apiFr24Id}: ${fmtVal(info.fr24Id)}`,
    `${t.apiTakeoff}: ${fmtVal(takeoff)}`,
    `${t.apiLand}: ${fmtVal(land)}`,
    `${t.apiAlPct}: ${fmtVal(info.airlabsProgressPercent)}`,
    `${t.apiLive}: ${live}`,
  ];
}

/** Kaynak adı + gerçek URL/metot + HTTP + outcome + yanıttan çıkan alanlar (admin ekranı). */
export function formatPollTraceForAdminDisplay(entries: FlightPollTraceEntry[], locale: 'tr' | 'en'): string {
  const title = locale === 'tr' ? 'Kaynak · endpoint · sonuç' : 'Source · endpoint · result';
  if (entries.length === 0) return locale === 'tr' ? '(İstek kaydı yok)' : '(No request log)';
  const blocks = entries.map((e) => {
    const http = e.httpStatus != null ? `HTTP ${e.httpStatus} · ` : '';
    const head = `▸ ${e.source}`;
    const req = e.request.trim();
    const mid = `${http}${e.outcome}`;
    const body = e.lines.length ? e.lines.map((l) => `  ${l}`).join('\n') : '  —';
    return [head, req, mid, body].join('\n');
  });
  return `── ${title} ──\n\n${blocks.join('\n\n')}`;
}
