/**
 * Admin ekranı: Edge `check-flight-status-and-notify` ile aynı adaptive poll aralığı
 * (`getAdaptivePollIntervalMs` / `shouldRunExternalPoll` kopyası — sapma olursa edge ile hizala).
 */

export type FlightPollRowLike = {
  scheduled_departure: string | null;
  estimated_departure: string | null;
  estimated_arrival: string | null;
  scheduled_arrival: string | null;
  actual_departure: string | null;
  fr24_datetime_takeoff_utc: string | null;
  flight_status: string | null;
  internal_status: string | null;
  api_refresh_phase: string;
  last_poll_at: string | null;
};

const MIN_POLL_MS = 5 * 60 * 1000;
const POLL_SEMI_MS = 60 * 60 * 1000;
const POLL_CRITICAL_MS = 5 * 60 * 1000;
const POLL_CRUISE_MS = 25 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function parseTimeMs(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return NaN;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
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

function normalizeOvernightEta(depUtcIso: string | undefined, etaUtcIso: string | undefined): string | undefined {
  if (!depUtcIso || !etaUtcIso) return etaUtcIso;
  const depMs = new Date(depUtcIso).getTime();
  const etaMs = new Date(etaUtcIso).getTime();
  if (Number.isNaN(depMs) || Number.isNaN(etaMs)) return etaUtcIso;
  if (etaMs < depMs) return new Date(etaMs + 24 * 60 * 60 * 1000).toISOString();
  return etaUtcIso;
}

function isAirborneFlightRow(row: { flight_status: string | null; internal_status: string | null }): boolean {
  const st = (row.flight_status ?? '').toLowerCase();
  if (st === 'en_route') return true;
  const intr = (row.internal_status ?? '').toLowerCase();
  if (intr === 'en_route') return true;
  return false;
}

/** Edge ile aynı: null = STD−3h öncesi → harici API yok. */
export function getAdaptivePollIntervalMs(row: FlightPollRowLike, nowMs: number): number | null {
  const stdMs = parseTimeMs(row.scheduled_departure);
  if (Number.isFinite(stdMs) && nowMs < stdMs - 3 * MINUTE_MS) {
    return null;
  }

  const etdParsed = parseTimeMs(row.estimated_departure);
  const etdMs = Number.isFinite(etdParsed) ? etdParsed : stdMs;
  const depIsoForEta =
    toUtcIsoAssumeUtc(row.estimated_departure ?? undefined) ??
    toUtcIsoAssumeUtc(row.scheduled_departure ?? undefined);
  const etaIsoRaw = toUtcIsoAssumeUtc((row.estimated_arrival ?? row.scheduled_arrival) ?? undefined);
  const etaIso = normalizeOvernightEta(depIsoForEta ?? '', etaIsoRaw ?? '') ?? etaIsoRaw;
  const etaMs = etaIso ? new Date(etaIso).getTime() : NaN;
  const etaFallbackMs = parseTimeMs(row.scheduled_arrival);
  const etaEffectiveMs = Number.isFinite(etaMs) ? etaMs : etaFallbackMs;

  const takeoffMs = parseTimeMs(row.fr24_datetime_takeoff_utc);
  const actualDepMs = parseTimeMs(row.actual_departure);
  const depRefMs = Number.isFinite(takeoffMs)
    ? takeoffMs
    : Number.isFinite(actualDepMs)
      ? actualDepMs
      : etdMs;

  const airborne = isAirborneFlightRow(row);

  if (!airborne) {
    if (Number.isFinite(etdMs) && nowMs < etdMs - 30 * MINUTE_MS) {
      return POLL_SEMI_MS;
    }
    return POLL_CRITICAL_MS;
  }

  const candidates: number[] = [];
  const etaApproachStart = Number.isFinite(etaEffectiveMs) ? etaEffectiveMs - 30 * MINUTE_MS : NaN;

  if (Number.isFinite(depRefMs)) {
    const earlyEnd = depRefMs + 20 * MINUTE_MS;
    if (nowMs >= depRefMs && nowMs < earlyEnd) {
      candidates.push(POLL_CRITICAL_MS);
    }
    if (
      Number.isFinite(etaEffectiveMs) &&
      nowMs >= depRefMs + 20 * MINUTE_MS &&
      nowMs < etaEffectiveMs - 30 * MINUTE_MS
    ) {
      candidates.push(POLL_CRUISE_MS);
    }
  }

  if (Number.isFinite(etaApproachStart) && nowMs >= etaApproachStart) {
    candidates.push(POLL_CRITICAL_MS);
  }

  if (candidates.length === 0) {
    return POLL_CRITICAL_MS;
  }
  return Math.min(...candidates);
}

export function shouldRunExternalPoll(row: FlightPollRowLike, nowMs: number): boolean {
  const intervalMs = getAdaptivePollIntervalMs(row, nowMs);
  if (intervalMs === null) return false;
  if (intervalMs < MIN_POLL_MS) return false;
  const lastMs = parseTimeMs(row.last_poll_at);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMs;
}

function intervalLabelMs(ms: number | null, locale: 'tr' | 'en'): string {
  if (ms === null) return locale === 'tr' ? 'yok (STD−3h öncesi harici API çağrılmaz)' : 'none (no external API before STD−3h)';
  if (ms === POLL_SEMI_MS) return locale === 'tr' ? '60 dk (yerde, ETD−30dk öncesi)' : '60 min (on ground before ETD−30m)';
  if (ms === POLL_CRUISE_MS) return locale === 'tr' ? '25 dk (seyir penceresi)' : '25 min (cruise window)';
  if (ms === POLL_CRITICAL_MS) return locale === 'tr' ? '5 dk (kritik / yaklaşım)' : '5 min (critical / approach)';
  return locale === 'tr' ? `${Math.round(ms / 60000)} dk` : `${Math.round(ms / 60000)} min`;
}

function describeSubWindow(row: FlightPollRowLike, nowMs: number, intervalMs: number | null, locale: 'tr' | 'en'): string {
  if (intervalMs === null) {
    return locale === 'tr'
      ? 'Alt pencere: passive_future bandı — kalkıştan 3 saat öncesine kadar Edge harici poll yapmaz.'
      : 'Sub-window: passive_future band — Edge skips external poll until STD−3h.';
  }
  const airborne = isAirborneFlightRow(row);
  const stdMs = parseTimeMs(row.scheduled_departure);
  const etdParsed = parseTimeMs(row.estimated_departure);
  const etdMs = Number.isFinite(etdParsed) ? etdParsed : stdMs;
  const takeoffMs = parseTimeMs(row.fr24_datetime_takeoff_utc);
  const actualDepMs = parseTimeMs(row.actual_departure);
  const depRefMs = Number.isFinite(takeoffMs)
    ? takeoffMs
    : Number.isFinite(actualDepMs)
      ? actualDepMs
      : etdMs;
  const depIsoForEta =
    toUtcIsoAssumeUtc(row.estimated_departure ?? undefined) ??
    toUtcIsoAssumeUtc(row.scheduled_departure ?? undefined);
  const etaIsoRaw = toUtcIsoAssumeUtc((row.estimated_arrival ?? row.scheduled_arrival) ?? undefined);
  const etaIso = normalizeOvernightEta(depIsoForEta ?? '', etaIsoRaw ?? '') ?? etaIsoRaw;
  const etaMs = etaIso ? new Date(etaIso).getTime() : NaN;
  const etaFallbackMs = parseTimeMs(row.scheduled_arrival);
  const etaEffectiveMs = Number.isFinite(etaMs) ? etaMs : etaFallbackMs;
  const etaApproachStart = Number.isFinite(etaEffectiveMs) ? etaEffectiveMs - 30 * MINUTE_MS : NaN;

  if (!airborne) {
    if (Number.isFinite(etdMs) && nowMs < etdMs - 30 * MINUTE_MS) {
      return locale === 'tr'
        ? 'Alt pencere: yerde, ETD−30dk öncesi → semi tarzı 60 dk aralık.'
        : 'Sub-window: on ground before ETD−30m → 60 min semi-style interval.';
    }
    return locale === 'tr'
      ? 'Alt pencere: yerde, ETD−30dk sonrası → 5 dk kritik aralık.'
      : 'Sub-window: on ground after ETD−30m → 5 min critical interval.';
  }

  if (Number.isFinite(depRefMs)) {
    const earlyEnd = depRefMs + 20 * MINUTE_MS;
    if (nowMs >= depRefMs && nowMs < earlyEnd) {
      return locale === 'tr'
        ? 'Alt pencere: havada, kalkıştan sonra ilk 20 dk → 5 dk.'
        : 'Sub-window: airborne, first 20m after dep ref → 5 min.';
    }
    if (
      Number.isFinite(etaEffectiveMs) &&
      nowMs >= depRefMs + 20 * MINUTE_MS &&
      nowMs < etaEffectiveMs - 30 * MINUTE_MS
    ) {
      return locale === 'tr'
        ? 'Alt pencere: havada, kalkış+20dk … ETA−30dk → 25 dk seyir.'
        : 'Sub-window: airborne, dep+20m … ETA−30m → 25 min cruise.';
    }
  }
  if (Number.isFinite(etaApproachStart) && nowMs >= etaApproachStart) {
    return locale === 'tr'
      ? 'Alt pencere: ETA−30dk yaklaşım → 5 dk.'
      : 'Sub-window: ETA−30m approach → 5 min.';
  }
  return locale === 'tr' ? 'Alt pencere: havada (varsayılan kritik 5 dk).' : 'Sub-window: airborne (default critical 5 min).';
}

export function rowToPollRowLike(row: Record<string, unknown>): FlightPollRowLike {
  return {
    scheduled_departure: (row.scheduled_departure as string | null) ?? null,
    estimated_departure: (row.estimated_departure as string | null) ?? null,
    estimated_arrival: (row.estimated_arrival as string | null) ?? null,
    scheduled_arrival: (row.scheduled_arrival as string | null) ?? null,
    actual_departure: (row.actual_departure as string | null) ?? null,
    fr24_datetime_takeoff_utc: (row.fr24_datetime_takeoff_utc as string | null) ?? null,
    flight_status: (row.flight_status as string | null) ?? null,
    internal_status: (row.internal_status as string | null) ?? null,
    api_refresh_phase: String(row.api_refresh_phase ?? ''),
    last_poll_at: (row.last_poll_at as string | null) ?? null,
  };
}

export function buildAdminPollAndPhaseLines(
  row: Record<string, unknown>,
  nowMs: number,
  locale: 'tr' | 'en',
  clientPhase: string | null,
  screenPollMode: 'semi_active' | 'active' | null,
): string[] {
  const t = locale === 'tr';
  const dbPhase = String(row.api_refresh_phase ?? '—');
  const pollRow = rowToPollRowLike(row);
  const intervalMs = getAdaptivePollIntervalMs(pollRow, nowMs);
  const edgeWouldPollPhase = dbPhase === 'semi_active' || dbPhase === 'active';
  const wouldRun = edgeWouldPollPhase && shouldRunExternalPoll(pollRow, nowMs);
  const lastPoll = pollRow.last_poll_at?.trim() || '—';

  const lines: string[] = [
    `DB api_refresh_phase: ${dbPhase}`,
    t ? `İstemci hesap fazı: ${clientPhase ?? '—'}` : `Client computed phase: ${clientPhase ?? '—'}`,
    t
      ? `Bu ekran poll modu (flight-lookup): ${screenPollMode ?? '—'}`
      : `This screen poll mode (flight-lookup): ${screenPollMode ?? '—'}`,
    '',
    t ? '── Sunucu (Edge check-flight-status) ──' : '── Server (Edge check-flight-status) ──',
    t
      ? '• Yalnızca api_refresh_phase ∈ { semi_active, active } satırlar listelenir.'
      : '• Only rows with api_refresh_phase ∈ { semi_active, active } are processed.',
    t
      ? '• Faz alanı: pg_cron refresh_flights_api_refresh_phase (çoğu kurulumda ~2 dk).'
      : '• Phase column: pg_cron refresh_flights_api_refresh_phase (often ~2 min).',
    t
      ? '• Harici API çağrısı: ayrı cron (ör. 2–5 dk) POST check-flight-status-and-notify + CRON_SECRET.'
      : '• External API: separate cron (e.g. 2–5 min) POST check-flight-status-and-notify + CRON_SECRET.',
    '',
    t ? '── Uçuş başına adaptive aralık ──' : '── Per-flight adaptive interval ──',
    t ? `• Min harici aralık: ${intervalLabelMs(intervalMs, locale)}` : `• Min external interval: ${intervalLabelMs(intervalMs, locale)}`,
    describeSubWindow(pollRow, nowMs, intervalMs, locale),
    t ? `• last_poll_at (DB): ${lastPoll}` : `• last_poll_at (DB): ${lastPoll}`,
    t
      ? `• Sonraki cron turunda harici API koşulu: ${wouldRun ? 'evet (süre doldu / ilk poll)' : 'hayır (throttle veya faz pasif veya STD−3h öncesi)'}`
      : `• External API on next cron tick: ${wouldRun ? 'yes (interval elapsed / first poll)' : 'no (throttle, passive phase, or before STD−3h)'}`,
  ];

  if (!edgeWouldPollPhase) {
    lines.push(
      '',
      t
        ? '• Bu fazda Edge harici poll yapmaz; istemci yine de bu ekranda manuel poll çalıştırır.'
        : '• Edge does no external poll in this phase; this screen still runs a manual poll.',
    );
  }

  return lines;
}

/** Admin tablosu: Edge poll mantığı (faz satırları DB↔API tablosunda; burada tekrar etme). */
export function buildAdminPollEdgeSummaryRows(
  row: Record<string, unknown>,
  nowMs: number,
  locale: 'tr' | 'en',
): { label: string; value: string }[] {
  const pollRow = rowToPollRowLike(row);
  const intervalMs = getAdaptivePollIntervalMs(pollRow, nowMs);
  const dbPhase = String(row.api_refresh_phase ?? '—');
  const edgeWouldPollPhase = dbPhase === 'semi_active' || dbPhase === 'active';
  const wouldRun = edgeWouldPollPhase && shouldRunExternalPoll(pollRow, nowMs);
  const tr = locale === 'tr';
  return [
    {
      label: tr ? 'Birleşik kaynak sırası' : 'Merged source order',
      value: tr
        ? 'ADB RapidAPI -> ADB API Market -> AirLabs -> FlightAPI (AeroAPI)'
        : 'ADB RapidAPI -> ADB API Market -> AirLabs -> FlightAPI (AeroAPI)',
    },
    {
      label: tr ? 'Min. harici aralık' : 'Min external interval',
      value: intervalLabelMs(intervalMs, locale),
    },
    {
      label: tr ? 'Alt pencere' : 'Sub-window',
      value: describeSubWindow(pollRow, nowMs, intervalMs, locale),
    },
    { label: 'last_poll_at', value: pollRow.last_poll_at?.trim() || '—' },
    {
      label: tr ? 'Sonraki cron’da harici API' : 'External API next cron',
      value: wouldRun ? (tr ? 'evet' : 'yes') : tr ? 'hayır' : 'no',
    },
    {
      label: tr ? 'Edge notu' : 'Edge note',
      value: tr
        ? 'Yalnızca semi_active / active satırlar işlenir; faz pg_cron ile güncellenir; harici poll ayrı cron.'
        : 'Only semi_active/active rows; phase via pg_cron; external poll is a separate cron job.',
    },
  ];
}
