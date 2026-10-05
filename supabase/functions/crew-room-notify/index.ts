/**
 * Ekip Odası: aynı istasyonda yatı bildirimi (saatlik cron, yalnız bildirimi açan kullanıcılara).
 * Eşleşmeler SQL'de (crew_room_pending_layovers) hesaplanır; burada kişi başı tek özet push gider.
 * Yetki: x-cron-secret == CREW_ROOM_CRON_SECRET (değer repoda yok).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendExpoPush } from '../_shared/expoPush.ts';

const HORIZON_DAYS = 14;
const QUIET_START_H = 21;
const QUIET_END_H = 9;
const MAX_LINES = 4;

type Pending = {
  viewer_crew_id: string;
  other_crew_id: string;
  other_name: string | null;
  day: string;
  stations: string[] | null;
};

type Stay = { other: string; name: string | null; station: string; from: string; to: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  return utcYmd(new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000));
}

function localParts(tz: string, at: Date): { ymd: string; hour: number } {
  try {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)) {
      p[x.type] = x.value;
    }
    return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
  } catch {
    return localParts('Europe/Istanbul', at);
  }
}

function dayLabel(ymd: string, tr: boolean): string {
  return new Date(ymd + 'T12:00:00Z').toLocaleDateString(tr ? 'tr-TR' : 'en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

function firstName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Consecutive days with the same person at the same station become one stay. */
function toStays(items: Pending[]): Stay[] {
  const flat = items
    .flatMap((p) => (p.stations ?? []).map((station) => ({ other: p.other_crew_id, name: p.other_name, station, day: p.day })))
    .sort((a, b) => a.other.localeCompare(b.other) || a.station.localeCompare(b.station) || a.day.localeCompare(b.day));
  const stays: Stay[] = [];
  for (const x of flat) {
    const last = stays[stays.length - 1];
    if (last && last.other === x.other && last.station === x.station && addDays(last.to, 1) === x.day) {
      last.to = x.day;
    } else {
      stays.push({ other: x.other, name: x.name, station: x.station, from: x.day, to: x.day });
    }
  }
  return stays.sort((a, b) => a.from.localeCompare(b.from));
}

function composeLine(s: Stay, tr: boolean): string {
  const who = firstName(s.name);
  const when = s.from === s.to ? dayLabel(s.from, tr) : `${dayLabel(s.from, tr)} – ${dayLabel(s.to, tr)}`;
  if (tr) return `${when} · ${who ? `${who} ile` : 'Ekip arkadaşınla'} yatı · ${s.station}`;
  return `${when} · Layover with ${who || 'a crew friend'} · ${s.station}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const expected = Deno.env.get('CREW_ROOM_CRON_SECRET') ?? '';
  if (!expected || !timingSafeEqual(req.headers.get('x-cron-secret') ?? '', expected)) {
    return json({ error: 'Forbidden' }, 403);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const client = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const dryRun = body.dry_run === true;
  const now = new Date();
  const from = addDays(utcYmd(now), -1);
  const to = addDays(utcYmd(now), HORIZON_DAYS);

  const { data, error } = await client.rpc('crew_room_pending_layovers', { p_from: from, p_to: to });
  if (error) return json({ error: 'pending_failed', detail: error.message }, 500);
  const pending = (data ?? []) as Pending[];

  const byViewer = new Map<string, Pending[]>();
  for (const p of pending) {
    const list = byViewer.get(p.viewer_crew_id) ?? [];
    list.push(p);
    byViewer.set(p.viewer_crew_id, list);
  }
  const report = { pending: pending.length, viewers: byViewer.size, sent: 0, quiet: 0, no_token: 0, errors: [] as string[] };
  if (byViewer.size === 0) return json({ ok: true, dry_run: dryRun, ...report });

  const viewerIds = [...byViewer.keys()];
  const { data: crewRows } = await client.from('crew_profiles').select('id, user_id').in('id', viewerIds);
  const userByCrew = new Map<string, string>();
  for (const r of (crewRows ?? []) as { id: string; user_id: string }[]) userByCrew.set(r.id, r.user_id);
  const userIds = [...new Set(userByCrew.values())];
  const [{ data: profRows }, { data: tokenRows }] = await Promise.all([
    client.from('profiles').select('id, locale, timezone_iana').in('id', userIds),
    client.from('device_tokens').select('user_id, token').in('user_id', userIds),
  ]);
  const profByUser = new Map<string, { locale: string | null; timezone_iana: string | null }>();
  for (const r of (profRows ?? []) as { id: string; locale: string | null; timezone_iana: string | null }[]) {
    profByUser.set(r.id, r);
  }
  const tokensByUser = new Map<string, string[]>();
  for (const r of (tokenRows ?? []) as { user_id: string; token: string }[]) {
    const t = r.token?.trim();
    if (!t) continue;
    const list = tokensByUser.get(r.user_id) ?? [];
    list.push(t);
    tokensByUser.set(r.user_id, list);
  }

  const toMark: { viewer_crew_id: string; other_crew_id: string; day: string }[] = [];
  for (const [viewer, items] of byViewer) {
    const userId = userByCrew.get(viewer);
    if (!userId) continue;
    const prof = profByUser.get(userId);
    const tr = String(prof?.locale ?? 'tr').toLowerCase().startsWith('tr');
    const local = localParts(prof?.timezone_iana || 'Europe/Istanbul', now);
    const upcoming = items.filter((p) => p.day >= local.ymd);
    const stale = items.filter((p) => p.day < local.ymd);
    for (const p of stale) toMark.push({ viewer_crew_id: viewer, other_crew_id: p.other_crew_id, day: p.day });
    if (upcoming.length === 0) continue;
    if (local.hour >= QUIET_START_H || local.hour < QUIET_END_H) {
      report.quiet += 1;
      continue;
    }
    for (const p of upcoming) toMark.push({ viewer_crew_id: viewer, other_crew_id: p.other_crew_id, day: p.day });
    const tokens = tokensByUser.get(userId) ?? [];
    if (tokens.length === 0) {
      report.no_token += 1;
      continue;
    }
    const stays = toStays(upcoming);
    const title = tr ? '🛏️ Ekip Odası · yatıda denk geldiniz' : '🛏️ Crew Room · shared layover';
    const lines = stays.slice(0, MAX_LINES).map((s) => composeLine(s, tr));
    if (stays.length > MAX_LINES) lines.push(tr ? `+${stays.length - MAX_LINES} daha` : `+${stays.length - MAX_LINES} more`);
    if (dryRun) continue;
    const res = await sendExpoPush(tokens, title, lines.join('\n'), { type: 'crew_room' }, {
      channelId: 'default',
      icon: 'notification_icon',
    });
    report.sent += res.sent;
    report.errors.push(...res.errors.slice(0, 3));
  }

  if (!dryRun && toMark.length > 0) {
    const { error: markErr } = await client
      .from('crew_room_notified')
      .upsert(toMark, { onConflict: 'viewer_crew_id,other_crew_id,day', ignoreDuplicates: true });
    if (markErr) report.errors.push('mark: ' + markErr.message);
    await client.from('crew_room_notified').delete().lt('day', addDays(utcYmd(now), -7));
  }

  return json({ ok: true, dry_run: dryRun, marked: dryRun ? 0 : toMark.length, ...report });
});
