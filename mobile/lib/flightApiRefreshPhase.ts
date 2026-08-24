/**
 * Uçuş API yenileme fazı — DB `compute_flight_api_phase_state` / tetikleyici ile aynı kurallar
 * (docs/flyfam_flight_status_detailed_spec.pdf).
 */

export type ApiRefreshPhase =
  | 'passive_future'
  | 'semi_active'
  | 'active'
  | 'passive_past'
  // Backward compatibility for rows not migrated yet.
  | 'passive_upcoming'
  | 'passive_complete';

const MS_3H = 3 * 60 * 60 * 1000;
const MS_4H = 4 * 60 * 60 * 1000;
const MS_30M = 30 * 60 * 1000;

function parseUtcMs(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return 0;
  let s = iso.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return 0;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? `${s}:00.000Z` : `${s}Z`;
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function landedFromRow(args: {
  flight_status?: string | null;
  internal_status?: string | null;
  actual_arrival?: string | null | undefined;
  fr24_datetime_landed_utc?: string | null | undefined;
  /** Ignore: iniş sinyali sayılmaz. */
  last_seen_utc?: string | null | undefined;
}): boolean {
  const st = (args.flight_status ?? '').toLowerCase();
  const internal = (args.internal_status ?? '').toLowerCase();
  if (st === 'landed' || st === 'arrived' || internal === 'landed' || internal === 'arrived') return true;

  const fr24LandedMs = parseUtcMs(args.fr24_datetime_landed_utc);
  const hasFr24Landed = fr24LandedMs > 0;

  // Kaynak bazen havadayken bile actual_arrival doldurur / yanlış yazar; uçuş+internal hâlâ
  // taxi_out / departed / en_route iken sadece actual_arrival'a güvenme (roster "İndi" göstermesin).
  if (airborneFromLiveFields(args.flight_status, args.internal_status) && !hasFr24Landed) {
    return false;
  }

  if (parseUtcMs(args.actual_arrival) > 0) return true;
  if (hasFr24Landed) return true;
  return false;
}

/** DB ile aynı: hareket başladıysa ETD kayması / zaman penceresi fazı düşürmesin. */
export function airborneFromLiveFields(
  flight_status: string | null | undefined,
  internal_status?: string | null,
): boolean {
  const ok = (s: string | null | undefined) => {
    const x = (s ?? '').toLowerCase();
    return x === 'taxi_out' || x === 'departed' || x === 'en_route';
  };
  return ok(flight_status) || ok(internal_status);
}

/**
 * PDF: PASSIVE_FUTURE (now < STD−3h), SEMI_ACTIVE (STD−3h .. ETD−30m),
 * ACTIVE (≥ ETD−30m, histerezis `phase_active_locked`), PASSIVE_PAST (iniş sinyali veya STA+4h safety net).
 * ETD = estimated_departure | STD + delay_dep_min.
 */
export function computeApiRefreshPhase(args: {
  roster_entry_kind?: string | null;
  scheduled_departure: string | null | undefined;
  scheduled_arrival: string | null | undefined;
  estimated_departure?: string | null | undefined;
  nowMs: number;
  /** Roster satır tarihi; faz hesabında kullanılmıyor (geriye dönük argüman). */
  roster_flight_date?: string | null;
  /** Kalkış meydanı; faz hesabında kullanılmıyor (geriye dönük argüman). */
  origin_airport?: string | null;
  delay_dep_min?: number | null;
  flight_status?: string | null;
  /** Cron FR24 ara durumu; flight_status gecikmeli olabilir. */
  internal_status?: string | null;
  actual_arrival?: string | null | undefined;
  fr24_datetime_landed_utc?: string | null | undefined;
  /** Geriye dönük; faz/iniş hesabında kullanılmıyor (last_seen sürekli geçmişte). */
  last_seen_utc?: string | null | undefined;
  /** DB: ACTIVE girdikten sonra ETD oynasa da faz düşmesin. */
  phase_active_locked?: boolean | null;
}): ApiRefreshPhase | null {
  if (args.roster_entry_kind != null && args.roster_entry_kind !== 'flight') return null;
  const stdMs = parseUtcMs(args.scheduled_departure);
  if (stdMs <= 0) return 'semi_active';

  const etdFromEst = parseUtcMs(args.estimated_departure);
  const delayMin = Number.isFinite(Number(args.delay_dep_min)) ? Number(args.delay_dep_min) : 0;
  const etdMs = etdFromEst > 0 ? etdFromEst : stdMs + Math.round(delayMin * 60 * 1000);

  const arrMsRaw = parseUtcMs(args.scheduled_arrival);
  const endMs = arrMsRaw > 0 ? arrMsRaw : stdMs + MS_4H;
  const nowMs = args.nowMs;
  const lockedIn = args.phase_active_locked === true;

  let phase: ApiRefreshPhase;

  if (landedFromRow(args)) {
    phase = 'passive_past';
  } else if (airborneFromLiveFields(args.flight_status, args.internal_status)) {
    phase = 'active';
  } else if (lockedIn) {
    phase = 'active';
  } else if (nowMs < stdMs - MS_3H) {
    phase = 'passive_future';
  } else if (nowMs < etdMs - MS_30M) {
    phase = 'semi_active';
  } else {
    phase = 'active';
  }

  return phase;
}

export function isApiRefreshPhasePolling(p: ApiRefreshPhase | null | undefined): boolean {
  return p === 'semi_active' || p === 'active';
}

/** Tanılama: `computeApiRefreshPhase` ile aynı dallar, Türkçe adım metinleri. */
export function explainComputeApiRefreshPhase(
  args: Parameters<typeof computeApiRefreshPhase>[0],
): { phase: ApiRefreshPhase | null; steps: string[] } {
  const steps: string[] = [];
  const line = (s: string) => steps.push(s);

  if (args.roster_entry_kind != null && args.roster_entry_kind !== 'flight') {
    line(`1) roster_entry_kind="${args.roster_entry_kind}" → uçuş satırı değil, faz null.`);
    return { phase: null, steps };
  }

  const stdMs = parseUtcMs(args.scheduled_departure);
  line(
    `1) STD: scheduled_departure=${args.scheduled_departure ?? 'null'} → ms=${stdMs}${stdMs ? ` (${new Date(stdMs).toISOString()} UTC)` : ''}`,
  );
  if (stdMs <= 0) {
    line(`2) STD yok/parse yok → semi_active (roster’da saat yok / dash).`);
    return { phase: 'semi_active', steps };
  }

  const etdFromEst = parseUtcMs(args.estimated_departure);
  const delayMin = Number.isFinite(Number(args.delay_dep_min)) ? Number(args.delay_dep_min) : 0;
  const etdMs = etdFromEst > 0 ? etdFromEst : stdMs + Math.round(delayMin * 60 * 1000);
  line(
    `2) ETD: estimated_departure=${args.estimated_departure ?? 'null'}, delay_dep_min=${args.delay_dep_min ?? 'null'} → ETD ms=${etdMs} (${new Date(etdMs).toISOString()} UTC)`,
  );

  const arrMsRaw = parseUtcMs(args.scheduled_arrival);
  const endMs = arrMsRaw > 0 ? arrMsRaw : stdMs + MS_4H;
  line(
    `3) Bitiş ucu (safety net): STA ms=${arrMsRaw || 'yok'} → endMs=${endMs} (${new Date(endMs).toISOString()} UTC); eşik = endMs+4h + arrived`,
  );

  const nowMs = args.nowMs;
  line(`4) Şimdi: nowMs=${nowMs} (${new Date(nowMs).toISOString()} UTC)`);

  const lockedIn = args.phase_active_locked === true;
  line(`5) phase_active_locked (DB)=${lockedIn}`);

  if (landedFromRow(args)) {
    line(
      `6) İniş sinyali: flight_status=landed/arrived veya actual_arrival/fr24_datetime_landed → passive_past`,
    );
    return { phase: 'passive_past', steps };
  }
  line(`6) İniş sinyali yok.`);

  if (airborneFromLiveFields(args.flight_status, args.internal_status)) {
    line(
      `7) Havada/taksi: flight_status=${args.flight_status ?? 'null'}, internal_status=${args.internal_status ?? 'null'} → active.`,
    );
    return { phase: 'active', steps };
  }
  line(`7) Havada/taksi sinyali yok (taxi_out/departed/en_route değil).`);

  line(`8) landed sinyali yoksa passive_past'a düşürme yapılmaz.`);

  if (lockedIn) {
    line(`9) phase_active_locked=true → active (ETD oynasa da).`);
    return { phase: 'active', steps };
  }

  if (nowMs < stdMs - MS_3H) {
    line(`10) now < STD−3h → passive_future`);
    return { phase: 'passive_future', steps };
  }
  line(`10) STD−3h penceresinde veya geçildi (now ≥ STD−3h).`);

  if (nowMs < etdMs - MS_30M) {
    line(`11) now < ETD−30dk → semi_active`);
    return { phase: 'semi_active', steps };
  }

  line(`12) now ≥ ETD−30dk → active`);
  return { phase: 'active', steps };
}
