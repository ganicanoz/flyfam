import {
  buildRosterImportPlan,
  findSuspectRosterLegs,
  normalizeRosterCode,
  type ChainLeg,
  type RosterImportRpcArgs,
  type RosterSuspectLeg,
} from '../_shared/roster-import/plan.ts';
import { mergePdfRowsFromTextParse } from '../_shared/roster-import/merge.ts';
import type { PdfFlightRow } from '../_shared/roster-pdf/types.ts';

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type RosterReportCtx = {
  adminClient: AdminClient;
  supabaseUrl: string;
  anonKey: string;
  /** Admin oturum JWT'si; `parse-roster-pdf` gateway JWT doğrulaması için iletilir. */
  jwt: string;
  requesterEmail: string;
  corsHeaders: Record<string, string>;
};

export const ROSTER_REPORT_ACTIONS = new Set([
  'list_roster_pdf_reports',
  'get_roster_pdf_report_url',
  'preview_roster_pdf_report',
  'apply_roster_pdf_report_fix',
  'update_roster_pdf_report',
]);

const BUCKET = 'roster-pdf-reports';
const REPORT_COLS =
  'id, user_id, storage_path, reason, airline_icao, parse_source, app_version, platform, size_bytes, meta, status, created_at, expires_at, admin_note, reviewed_at, reviewed_by, last_action';
const FLIGHT_COLS =
  'id, flight_number, flight_date, origin_airport, destination_airport, scheduled_departure, scheduled_arrival, roster_entry_kind';
const STATUSES = new Set(['new', 'reviewed', 'fixed', 'dismissed']);

type ReportRow = {
  id: string;
  user_id: string;
  storage_path: string;
  status: string;
  [k: string]: unknown;
};

type DbFlight = {
  id: string;
  flight_number: string;
  flight_date: string;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  roster_entry_kind: string | null;
};

export type PreviewRow = {
  key: string;
  status: 'add' | 'update' | 'same';
  roster_kind: 'flight' | 'duty_off' | 'sim';
  flight_number: string;
  flight_date: string;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  existing_flight_id: string | null;
  changes: Array<{ field: string; from: string | null; to: string | null }>;
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  return Date.parse(a) === Date.parse(b);
}

function itemKey(a: RosterImportRpcArgs): string {
  return `${a.p_flight_number}|${a.p_flight_date}|${a.p_roster_entry_kind}`;
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
}

/** `add_me_to_flight` güncellemesi yalnız dolu parametreleri yazar; fark da yalnız onlar için hesaplanır. */
function diffAgainst(args: RosterImportRpcArgs, f: DbFlight): PreviewRow['changes'] {
  const out: PreviewRow['changes'] = [];
  const o = args.p_origin_airport?.trim() || null;
  const d = args.p_destination_airport?.trim() || null;
  if (o && o !== f.origin_airport) out.push({ field: 'origin_airport', from: f.origin_airport, to: o });
  if (d && d !== f.destination_airport) out.push({ field: 'destination_airport', from: f.destination_airport, to: d });
  if (args.p_scheduled_departure && !sameInstant(args.p_scheduled_departure, f.scheduled_departure)) {
    out.push({ field: 'scheduled_departure', from: f.scheduled_departure, to: args.p_scheduled_departure });
  }
  if (args.p_scheduled_arrival && !sameInstant(args.p_scheduled_arrival, f.scheduled_arrival)) {
    out.push({ field: 'scheduled_arrival', from: f.scheduled_arrival, to: args.p_scheduled_arrival });
  }
  if (args.p_roster_entry_kind !== 'flight' && args.p_roster_entry_kind !== (f.roster_entry_kind ?? 'flight')) {
    out.push({ field: 'roster_entry_kind', from: f.roster_entry_kind, to: args.p_roster_entry_kind });
  }
  return out;
}

async function loadReport(ctx: RosterReportCtx, id: string): Promise<ReportRow> {
  if (!id) throw new HttpError(400, 'id is required');
  const { data, error } = await ctx.adminClient.from('roster_pdf_reports').select(REPORT_COLS).eq('id', id).maybeSingle();
  if (error) throw new HttpError(400, error.message || 'Report lookup failed');
  if (!data) throw new HttpError(404, 'Report not found');
  return data as ReportRow;
}

async function loadCrew(ctx: RosterReportCtx, userId: string) {
  const { data } = await ctx.adminClient
    .from('crew_profiles')
    .select('id, airline_icao, home_base_iata')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.id) throw new HttpError(404, 'Crew profile not found for report user');
  return data as { id: string; airline_icao: string | null; home_base_iata: string | null };
}

async function crewFlightsInRange(ctx: RosterReportCtx, crewId: string, floor: string, ceil: string): Promise<DbFlight[]> {
  const { data: fc, error } = await ctx.adminClient.from('flight_crew').select('flight_id').eq('crew_id', crewId);
  if (error) throw new HttpError(400, error.message || 'flight_crew lookup failed');
  const ids = [...new Set((fc ?? []).map((r: { flight_id: string }) => String(r.flight_id)).filter(Boolean))];
  const out: DbFlight[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: fErr } = await ctx.adminClient
      .from('flights')
      .select(FLIGHT_COLS)
      .in('id', ids.slice(i, i + 100))
      .gte('flight_date', floor)
      .lte('flight_date', ceil);
    if (fErr) throw new HttpError(400, fErr.message || 'flights lookup failed');
    out.push(...((data ?? []) as DbFlight[]));
  }
  return out.sort((a, b) => (a.scheduled_departure ?? a.flight_date).localeCompare(b.scheduled_departure ?? b.flight_date));
}

async function parseStoredPdf(ctx: RosterReportCtx, report: ReportRow, crewIcao: string | null) {
  const { data: blob, error } = await ctx.adminClient.storage.from(BUCKET).download(report.storage_path);
  if (error || !blob) throw new HttpError(404, 'PDF not found in storage (expired?)');
  const b64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  const res = await fetch(`${ctx.supabaseUrl.replace(/\/$/, '')}/functions/v1/parse-roster-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.jwt}`,
      apikey: ctx.anonKey,
    },
    body: JSON.stringify({ pdf_base64: b64, ...(crewIcao ? { crew_airline_icao: crewIcao } : {}) }),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: string;
    text?: string;
    flights?: PdfFlightRow[];
    parser_debug_source?: string;
    detected_layout?: string;
    counts?: Record<string, number>;
  } | null;
  if (!res.ok || !json || json.error) {
    throw new HttpError(502, `parse-roster-pdf failed: ${json?.error ?? res.status}`);
  }
  return json;
}

async function computePreview(ctx: RosterReportCtx, report: ReportRow) {
  const crew = await loadCrew(ctx, report.user_id);
  const icao = (crew.airline_icao ?? '').trim().toUpperCase() || null;
  const parsed = await parseStoredPdf(ctx, report, icao);
  const text = String(parsed.text ?? '');
  const edgeFlights = Array.isArray(parsed.flights) ? parsed.flights : [];
  // Mobil `parseRosterPdfFromDevice` ile aynı: SXS'te Edge layout'a güvenilir, diğerlerinde metin parse'ı eksikleri tamamlar.
  const rows = icao === 'SXS' || !text.trim() ? edgeFlights : mergePdfRowsFromTextParse(edgeFlights, text);
  const plan = await buildRosterImportPlan(ctx.adminClient, rows, {
    rawText: text || null,
    crewAirlineIcao: icao,
    crewAirlineIata: null,
    crewHomeBaseIata: crew.home_base_iata,
  });

  let floor: string | null = null;
  let ceil: string | null = null;
  for (const it of plan.items) {
    const d = (it.effectiveDate || '').trim();
    if (d && (!floor || d < floor)) floor = d;
    if (d && (!ceil || d > ceil)) ceil = d;
  }
  const db = floor && ceil ? await crewFlightsInRange(ctx, crew.id, floor, ceil) : [];
  const dbByKey = new Map<string, DbFlight>();
  for (const f of db) dbByKey.set(`${f.flight_number}|${f.flight_date}`, f);

  const preview: PreviewRow[] = [];
  const matchedIds = new Set<string>();
  const incomplete: Array<{ flight_number: string; flight_date: string; message: string }> = [];
  for (const it of plan.items) {
    if (it.kind === 'incomplete') {
      incomplete.push(it.entry);
      continue;
    }
    const a = it.args;
    const existing = dbByKey.get(`${a.p_flight_number}|${a.p_flight_date}`) ?? null;
    if (existing) matchedIds.add(existing.id);
    const changes = existing ? diffAgainst(a, existing) : [];
    preview.push({
      key: itemKey(a),
      status: !existing ? 'add' : changes.length ? 'update' : 'same',
      roster_kind: a.p_roster_entry_kind,
      flight_number: a.p_flight_number,
      flight_date: a.p_flight_date,
      origin_airport: a.p_origin_airport,
      destination_airport: a.p_destination_airport,
      scheduled_departure: a.p_scheduled_departure,
      scheduled_arrival: a.p_scheduled_arrival,
      existing_flight_id: existing?.id ?? null,
      changes,
    });
  }

  // Mobil import ile aynı kural: aynı uçuş numarası ±3 gün içinde eksik kaldıysa o satır «PDF'te yok» sayılmaz.
  const notImported = incomplete.map((e) => ({ fn: normalizeRosterCode(e.flight_number), d: e.flight_date }));
  const stale = db
    .filter((f) => !matchedIds.has(f.id) && (f.roster_entry_kind ?? 'flight') === 'flight')
    .filter((f) => !notImported.some((n) => n.fn === normalizeRosterCode(f.flight_number) && dayDiff(n.d, f.flight_date) <= 3));

  const dbFlightLegs = db.filter((f) => (f.roster_entry_kind ?? 'flight') === 'flight') as ChainLeg[];
  const planFlightLegs: ChainLeg[] = preview
    .filter((p) => p.roster_kind === 'flight')
    .map((p) => ({
      flight_number: p.flight_number,
      flight_date: p.flight_date,
      origin_airport: p.origin_airport,
      destination_airport: p.destination_airport,
      scheduled_departure: p.scheduled_departure,
      scheduled_arrival: p.scheduled_arrival,
    }));
  const suspectBefore: RosterSuspectLeg[] = findSuspectRosterLegs(dbFlightLegs);
  const suspectAfter: RosterSuspectLeg[] = findSuspectRosterLegs(planFlightLegs);

  const planHash = fnv1a(
    JSON.stringify({
      p: plan.items.filter((i) => i.kind === 'ready').map((i) => (i.kind === 'ready' ? i.args : null)),
      s: stale.map((f) => f.id).sort(),
    }),
  );

  return {
    crew,
    plan,
    preview,
    stale,
    incomplete,
    planHash,
    body: {
      crew: { crew_id: crew.id, airline_icao: icao, home_base_iata: crew.home_base_iata },
      parse: {
        source: parsed.parser_debug_source ?? null,
        detected_layout: parsed.detected_layout ?? null,
        counts: parsed.counts ?? null,
        merged_rows: rows.length,
        skipped_invalid: plan.skippedInvalid,
        skipped_wrong_airline: plan.skippedWrongAirline,
      },
      range: { floor, ceil },
      plan_hash: planHash,
      rows: preview,
      stale,
      incomplete,
      suspect_before: suspectBefore,
      suspect_after: suspectAfter,
      summary: {
        add: preview.filter((p) => p.status === 'add').length,
        update: preview.filter((p) => p.status === 'update').length,
        same: preview.filter((p) => p.status === 'same').length,
        stale: stale.length,
        incomplete: incomplete.length,
      },
    },
  };
}

async function listReports(ctx: RosterReportCtx, body: Record<string, unknown> | null) {
  const filter = str(body?.status, 20) || 'open';
  const limitRaw = Number(body?.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 100;
  let q = ctx.adminClient.from('roster_pdf_reports').select(REPORT_COLS).order('created_at', { ascending: false }).limit(limit);
  if (filter === 'open') q = q.in('status', ['new', 'reviewed']);
  else if (STATUSES.has(filter)) q = q.eq('status', filter);
  const { data, error } = await q;
  if (error) throw new HttpError(400, error.message || 'Report list failed');
  const rows = (data ?? []) as ReportRow[];

  const { count: newCount } = await ctx.adminClient
    .from('roster_pdf_reports')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profs } = await ctx.adminClient.from('profiles').select('id, full_name').in('id', userIds);
    for (const p of profs ?? []) names.set(String(p.id), p.full_name ?? null);
  }
  const emails = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (uid) => {
      const { data: u } = await ctx.adminClient.auth.admin.getUserById(uid);
      emails.set(uid, u?.user?.email ?? null);
    }),
  );

  return {
    ok: true,
    new_count: newCount ?? 0,
    reports: rows.map((r) => ({
      ...r,
      full_name: names.get(r.user_id) ?? null,
      email: emails.get(r.user_id) ?? null,
    })),
  };
}

async function applyFix(ctx: RosterReportCtx, report: ReportRow, body: Record<string, unknown> | null) {
  const wantHash = str(body?.plan_hash, 16);
  const addKeys = new Set(Array.isArray(body?.add_keys) ? (body!.add_keys as unknown[]).map((k) => String(k)) : []);
  const removeIds = new Set(
    Array.isArray(body?.remove_flight_ids) ? (body!.remove_flight_ids as unknown[]).map((k) => String(k)) : [],
  );
  if (!addKeys.size && !removeIds.size) throw new HttpError(400, 'Nothing selected');

  const pv = await computePreview(ctx, report);
  if (!wantHash || wantHash !== pv.planHash) {
    throw new HttpError(409, 'Preview is out of date (parser or roster changed). Reload the preview.');
  }

  const added: Array<{ flight_number: string; flight_date: string; status: string; flight_id: string | null }> = [];
  const removed: Array<{ flight_id: string; flight_number: string; flight_date: string }> = [];
  const errors: string[] = [];

  for (const it of pv.plan.items) {
    if (it.kind !== 'ready' || !addKeys.has(itemKey(it.args))) continue;
    const row = pv.preview.find((p) => p.key === itemKey(it.args));
    const { data: flightId, error } = await ctx.adminClient.rpc('admin_add_crew_to_flight', {
      p_crew_id: pv.crew.id,
      ...it.args,
    });
    if (error || !flightId) {
      errors.push(`${it.args.p_flight_number} ${it.args.p_flight_date}: ${error?.message ?? 'no flight id'}`);
      continue;
    }
    added.push({
      flight_number: it.args.p_flight_number,
      flight_date: it.args.p_flight_date,
      status: row?.status ?? 'add',
      flight_id: String(flightId),
    });
  }

  const staleById = new Map(pv.stale.map((f) => [f.id, f]));
  for (const id of removeIds) {
    const f = staleById.get(id);
    if (!f) {
      errors.push(`${id}: not in stale list`);
      continue;
    }
    const { error } = await ctx.adminClient.rpc('admin_remove_crew_from_flight', { p_crew_id: pv.crew.id, p_flight_id: id });
    if (error) {
      errors.push(`${f.flight_number} ${f.flight_date}: ${error.message}`);
      continue;
    }
    removed.push({ flight_id: id, flight_number: f.flight_number, flight_date: f.flight_date });
  }

  const now = new Date().toISOString();
  const lastAction = { at: now, by: ctx.requesterEmail, plan_hash: pv.planHash, added, removed, errors };
  const note = str(body?.admin_note, 2000);
  const patch: Record<string, unknown> = {
    last_action: lastAction,
    reviewed_at: now,
    reviewed_by: ctx.requesterEmail.slice(0, 120),
  };
  if (added.length || removed.length) patch.status = 'fixed';
  if (note) patch.admin_note = note;
  await ctx.adminClient.from('roster_pdf_reports').update(patch).eq('id', report.id);
  console.log('[admin-dashboard] apply_roster_pdf_report_fix', {
    report_id: report.id,
    requester: ctx.requesterEmail,
    added: added.length,
    removed: removed.length,
    errors: errors.length,
  });
  return { ok: errors.length === 0, user_id: report.user_id, added, removed, errors, status: patch.status ?? report.status };
}

export async function handleRosterReportAction(
  action: string,
  body: Record<string, unknown> | null,
  ctx: RosterReportCtx,
): Promise<Response> {
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...ctx.corsHeaders, 'Content-Type': 'application/json' } });
  try {
    if (action === 'list_roster_pdf_reports') {
      return json({ action, ...(await listReports(ctx, body)) });
    }
    const report = await loadReport(ctx, str(body?.id, 64));
    if (action === 'get_roster_pdf_report_url') {
      const { data, error } = await ctx.adminClient.storage.from(BUCKET).createSignedUrl(report.storage_path, 300);
      if (error || !data?.signedUrl) throw new HttpError(404, 'PDF not found in storage (expired?)');
      return json({ ok: true, action, id: report.id, url: data.signedUrl, expires_in: 300 });
    }
    if (action === 'preview_roster_pdf_report') {
      const pv = await computePreview(ctx, report);
      if (report.status === 'new') {
        await ctx.adminClient
          .from('roster_pdf_reports')
          .update({ status: 'reviewed', reviewed_at: new Date().toISOString(), reviewed_by: ctx.requesterEmail.slice(0, 120) })
          .eq('id', report.id);
      }
      return json({ ok: true, action, id: report.id, user_id: report.user_id, ...pv.body });
    }
    if (action === 'apply_roster_pdf_report_fix') {
      return json({ action, id: report.id, ...(await applyFix(ctx, report, body)) });
    }
    if (action === 'update_roster_pdf_report') {
      const patch: Record<string, unknown> = {};
      const status = str(body?.status, 20);
      if (status) {
        if (!STATUSES.has(status)) throw new HttpError(400, 'invalid status');
        patch.status = status;
      }
      if (typeof body?.admin_note === 'string') patch.admin_note = str(body.admin_note, 2000) || null;
      if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
      patch.reviewed_at = new Date().toISOString();
      patch.reviewed_by = ctx.requesterEmail.slice(0, 120);
      const { error } = await ctx.adminClient.from('roster_pdf_reports').update(patch).eq('id', report.id);
      if (error) throw new HttpError(400, error.message || 'Update failed');
      return json({ ok: true, action, id: report.id, ...patch });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[admin-dashboard] roster report action failed', action, e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
