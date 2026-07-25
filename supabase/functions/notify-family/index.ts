// Supabase Edge Function: send push notifications to family users via Expo Push API.
// Body: { type: 'today_flights', crewId, date } | { type: 'took_off'|'landed'|'cancelled'|'diverted'|'delayed', flightId, crewId? }
// For daily digest, caller can use header x-cron-secret to bypass auth (set CRON_SECRET in Supabase secrets).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface TodayFlightsPayload {
  type: 'today_flights';
  crewId: string;
  date: string; // YYYY-MM-DD
}

interface FlightEventPayload {
  type: 'took_off' | 'landed' | 'cancelled' | 'diverted' | 'delayed';
  flightId: string;
  crewId?: string;
  delayPhase?: 'departure' | 'arrival';
  delayMinutes?: number;
}

interface TestPayload {
  type: 'test';
}

type Payload = TodayFlightsPayload | FlightEventPayload | TestPayload;

function formatTimeLocal(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format ISO time in a given IANA timezone (e.g. Europe/Istanbul) for notification body. */
function formatTimeInTimezone(iso: string | null, timezoneIana: string | null | undefined): string {
  if (!iso) return '--:--';
  const tz =
    timezoneIana && typeof timezoneIana === 'string' && timezoneIana.trim() ? timezoneIana.trim() : 'UTC';
  try {
    const d = new Date(iso);
    const formatted = d.toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    return formatted.replace(',', '').trim();
  } catch {
    const d = new Date(iso);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

type NotifLocale = 'en' | 'tr';

function todayFlightsBody(
  locale: NotifLocale,
  crewName: string,
  legs: number,
  dutyStartLocal: string,
  dutyEndLocal: string,
  dutyDurationText: string | null,
  crossDaySuffix?: string | null
): string {
  const cross = crossDaySuffix ?? '';
  const legsPartTr = `${legs} bacak uçuşu`;
  const legsPartEn = `${legs} ${legs === 1 ? 'leg' : 'legs'}`;
  const durationLineTr = dutyDurationText ? `\nGörev süresi: ${dutyDurationText}` : '';
  const durationLineEn = dutyDurationText ? `\nDuty duration: ${dutyDurationText}` : '';

  if (locale === 'tr') {
    return `${crewName}'nin bugün ${legsPartTr} var.\nGörev saati: ${dutyStartLocal} - ${dutyEndLocal}${cross}${durationLineTr}`;
  }

  return `${crewName} has ${legsPartEn} today.\nDuty time: ${dutyStartLocal} - ${dutyEndLocal}${cross}${durationLineEn}`;
}

function sharedPlanBody(locale: NotifLocale, crewName: string): string {
  if (locale === 'tr') return `${crewName} sizinle güncel uçuş planını paylaştı.`;
  return `${crewName} shared their latest flight plan with you.`;
}

function getLocalDateKey(iso: string | null, timezoneIana: string | null | undefined): string | null {
  if (!iso) return null;
  const tz =
    timezoneIana && typeof timezoneIana === 'string' && timezoneIana.trim() ? timezoneIana.trim() : 'UTC';
  try {
    const d = new Date(iso);
    return d
      .toLocaleString('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function tookOffBody(locale: NotifLocale, crewName: string, cityFrom: string, flightNumber: string | null | undefined): string {
  const numPart = flightNumber && `${flightNumber}`.trim() ? ` (${`${flightNumber}`.trim()})` : '';
  if (locale === 'tr') return `${crewName} şu şehirden kalktı: ${cityFrom}${numPart ? ` ${numPart}` : ''}`;
  return `${crewName} has departed from ${cityFrom}${numPart}`;
}

function landedBody(locale: NotifLocale, crewName: string, cityTo: string, flightNumber: string | null | undefined): string {
  const numPart = flightNumber && `${flightNumber}`.trim() ? ` (${`${flightNumber}`.trim()})` : '';
  if (locale === 'tr') return `${crewName} şu şehre indi: ${cityTo}${numPart ? ` ${numPart}` : ''}`;
  return `${crewName} has landed in ${cityTo}${numPart}.`;
}

function cancelledBody(locale: NotifLocale, crewName: string, route: string): string {
  if (locale === 'tr') return `${crewName}'in ${route} uçuşu iptal oldu.`;
  return `${crewName}'s ${route} flight was cancelled.`;
}

function divertedBody(locale: NotifLocale, crewName: string, route: string, divertedTo: string): string {
  if (locale === 'tr') return `${crewName}'in ${route} uçuşu ${divertedTo}'a divert ediyor.`;
  return `${crewName}'s ${route} flight is diverting to ${divertedTo}.`;
}

function delayedBody(
  locale: NotifLocale,
  crewName: string,
  cityFrom: string,
  cityTo: string,
  delayPhase: 'departure' | 'arrival' | undefined,
  delayMinutes: number | undefined,
): string {
  const whenTr = delayPhase === 'arrival' ? 'inişi' : 'kalkışı';
  const whenEn = delayPhase === 'arrival' ? 'arrival' : 'departure';
  const mins = Number.isFinite(delayMinutes) ? Math.max(0, Math.round(delayMinutes as number)) : null;
  const delayTextTr = mins == null
    ? null
    : mins < 60
      ? `${mins} dk`
      : `${Math.floor(mins / 60)} sa${mins % 60 === 0 ? '' : ` ${mins % 60} dk`}`;
  const cityTag = delayPhase === 'arrival' ? cityTo : cityFrom;
  if (locale === 'tr') {
    if (delayTextTr) return `Gecikme Bildirimi: ${cityTag} ${whenTr} ${delayTextTr} gecikiyor.`;
    return `Gecikme Bildirimi: ${cityTag} ${whenTr} gecikme görünüyor, lütfen kontrol edin.`;
  }
  const cityTagEn = delayPhase === 'arrival' ? cityTo : cityFrom;
  return `Delay alert: ${cityTagEn} ${whenEn} may be delayed, please check.`;
}

function isLikelyAirportCode(v: string | null | undefined): boolean {
  const s = (v ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{3,4}$/.test(s);
}

function normalizeAirportCode(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toUpperCase();
  if (!s) return null;
  return s;
}

const AIRPORT_CITY_FALLBACK: Record<string, { city: string; city_tr?: string }> = {
  SAW: { city: 'Istanbul', city_tr: 'Istanbul' },
  IST: { city: 'Istanbul', city_tr: 'Istanbul' },
  ESB: { city: 'Ankara', city_tr: 'Ankara' },
  ADB: { city: 'Izmir', city_tr: 'Izmir' },
  AYT: { city: 'Antalya', city_tr: 'Antalya' },
  BJV: { city: 'Bodrum', city_tr: 'Bodrum' },
  DLM: { city: 'Dalaman', city_tr: 'Dalaman' },
  ADA: { city: 'Adana', city_tr: 'Adana' },
  TZX: { city: 'Trabzon', city_tr: 'Trabzon' },
  SZF: { city: 'Samsun', city_tr: 'Samsun' },
  COV: { city: 'Mersin', city_tr: 'Mersin' },
  KHI: { city: 'Karachi', city_tr: 'Karaci' },
};

function preferCityForLocale(
  locale: NotifLocale,
  cityRaw: string | null | undefined,
  airportCode: string | null,
  cityByIata: Map<string, { city: string | null; city_tr: string | null }>
): string {
  const city = (cityRaw ?? '').trim();
  if (city && !isLikelyAirportCode(city)) return city;
  if (airportCode) {
    const row = cityByIata.get(airportCode);
    const localized = locale === 'tr' ? row?.city_tr?.trim() : row?.city?.trim();
    if (localized) return localized;
    const fallback = row?.city?.trim() || row?.city_tr?.trim();
    if (fallback) return fallback;
    const staticCity = AIRPORT_CITY_FALLBACK[airportCode];
    if (staticCity) {
      if (locale === 'tr' && staticCity.city_tr?.trim()) return staticCity.city_tr.trim();
      if (staticCity.city.trim()) return staticCity.city.trim();
    }
  }
  if (city) return city;
  return airportCode || 'unknown';
}

async function sendExpoPush(tokens: string[], title: string, body: string): Promise<void> {
  if (tokens.length === 0) return;
  const messages = tokens.map((token) => ({
    to: token,
    title,
    body,
    sound: 'default' as const,
    channelId: 'default', // Android: use app-created channel for sound/importance
  }));
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[notify-family] Expo push HTTP error:', res.status, text);
    return;
  }
  try {
    const data = JSON.parse(text) as { data?: Array<{ status?: string; message?: string; details?: { error?: string } }> };
    const tickets = data?.data ?? [];
    tickets.forEach((ticket, i) => {
      if (ticket?.status === 'error') {
        const err = ticket.details?.error ?? ticket.message ?? 'unknown';
        console.error('[notify-family] Expo push ticket error:', { index: i, token: tokens[i]?.slice(0, 30) + '…', error: err, message: ticket.message });
      }
    });
  } catch {
    // ignore parse errors
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
};

async function logCrewActivity(
  admin: ReturnType<typeof createClient>,
  userId: string | null | undefined,
  eventType: 'family_push',
  meta: Record<string, unknown>,
): Promise<void> {
  if (!userId) return;
  try {
    await admin.from('user_activity_events').insert({
      user_id: userId,
      event_type: eventType,
      meta,
    });
  } catch (e) {
    console.warn('[notify-family] activity log failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_ANON_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  const cronHeader = req.headers.get('x-cron-secret');
  const isCron = !!cronSecret && cronHeader === cronSecret;

  if (!payload || typeof payload.type !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing type in body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Simple self-test: sends a push to the authenticated user's own devices.
  if (payload.type === 'test') {
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const jwt = authHeader.slice(7);
    // Use anon client + user JWT so this works even if service role secret isn't set yet.
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token', details: authError?.message ?? null }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: tokens } = await supabaseUser.from('device_tokens').select('token').eq('user_id', user.id);
    const pushTokens = (tokens ?? []).map((t) => t.token).filter(Boolean);
    const title = 'FlyFam';
    const body = `Test notification (${new Date().toISOString().slice(11, 19)}Z)`;
    await sendExpoPush(pushTokens, title, body);
    return new Response(JSON.stringify({ ok: true, sent: pushTokens.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Everything below needs service role (read other users' tokens/preferences).
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  if (payload.type === 'today_flights') {
    try {
      const body = payload as TodayFlightsPayload & { cron?: boolean };
      const today = new Date().toISOString().slice(0, 10);
      let crewIdsToProcess: { crewId: string; date: string; manualShare: boolean }[] = [];

      // Crew-initiated: Bearer JWT + crewId + date (button "Send flights to my family")
      if (body.crewId && body.date && authHeader?.startsWith('Bearer ')) {
        const jwt = authHeader.slice(7).trim();
        if (!jwt) {
          return new Response(JSON.stringify({ error: 'Missing token' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Use anon client + JWT to verify user (same pattern as Supabase docs).
        const supabaseUser = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        // Argümansız getUser() Edge'de session olmadığı için çoğu zaman başarısız; JWT ile doğrula (test yolu ile aynı).
        const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(jwt);
        if (authErr) {
          console.error('[notify-family] today_flights auth error:', authErr.message);
          return new Response(JSON.stringify({ error: 'Invalid token', details: authErr.message }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!user) {
          return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data: crewRow, error: crewErr } = await supabaseAdmin
          .from('crew_profiles')
          .select('id')
          .eq('id', body.crewId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (crewErr) {
          console.error('[notify-family] crew_profiles lookup error:', crewErr.message);
          return new Response(JSON.stringify({ error: 'Crew lookup failed', details: crewErr.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!crewRow) {
          return new Response(JSON.stringify({ error: 'Not your crew profile' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        crewIdsToProcess = [{ crewId: body.crewId, date: body.date, manualShare: true }];
      } else if (isCron && body.cron) {
      // Scheduled cron: one row per (crew_id, date) from flight_crew for today's flights
      const { data: flightsToday } = await supabaseAdmin
        .from('flights')
        .select('id')
        .eq('flight_date', today);
      const flightIdsToday = (flightsToday ?? []).map((f: { id: string }) => f.id);
      if (flightIdsToday.length > 0) {
        const { data: fcRows } = await supabaseAdmin
          .from('flight_crew')
          .select('crew_id')
          .in('flight_id', flightIdsToday);
        const seen = new Set<string>();
        for (const r of fcRows ?? []) {
          const cid = (r as { crew_id: string }).crew_id;
          if (!seen.has(cid)) {
            seen.add(cid);
            crewIdsToProcess.push({ crewId: cid, date: today, manualShare: false });
          }
        }
      }
    } else {
      return new Response(JSON.stringify({ error: 'today_flights requires Authorization + crewId + date, or x-cron-secret + cron: true' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (crewIdsToProcess.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalMembers = 0; // number of family members (users) sent to
    for (const { crewId, date, manualShare } of crewIdsToProcess) {
      const sentBeforeCrew = totalMembers;
      const { data: crew } = await supabaseAdmin
        .from('crew_profiles')
        .select('id, user_id')
        .eq('id', crewId)
        .single();
      if (!crew) continue;
      const { data: profile } = await supabaseAdmin.from('profiles').select('full_name').eq('id', crew.user_id).single();
      const crewName = (profile?.full_name || 'Crew').trim() || 'Crew';

      const { data: myFlightIds } = await supabaseAdmin
        .from('flight_crew')
        .select('flight_id')
        .eq('crew_id', crewId);
      const ids = (myFlightIds ?? []).map((r: { flight_id: string }) => r.flight_id);
      const { data: allFlights } = ids.length > 0
        ? await supabaseAdmin
            .from('flights')
            .select('id, scheduled_departure, actual_departure, scheduled_arrival, actual_arrival')
            .in('id', ids)
            .eq('flight_date', date)
        : { data: [] };
      const legs = allFlights?.length ?? 0;
      // Duty start = earliest departure (scheduled or actual) minus 70 minutes.
      const withEffectiveTimes = (allFlights ?? []).map((f) => {
        const dep = f.scheduled_departure ?? f.actual_departure ?? null;
        const arr = f.scheduled_arrival ?? f.actual_arrival ?? null;
        return { ...f, effectiveDep: dep, effectiveArr: arr };
      });
      const byDep = withEffectiveTimes
        .filter((f) => f.effectiveDep != null)
        .sort((a, b) => new Date(a.effectiveDep!).getTime() - new Date(b.effectiveDep!).getTime());
      const byArr = withEffectiveTimes
        .filter((f) => f.effectiveArr != null)
        .sort((a, b) => new Date(a.effectiveArr!).getTime() - new Date(b.effectiveArr!).getTime());
      const firstDep = byDep[0]?.effectiveDep ?? null;
      const lastArr = byArr[byArr.length - 1]?.effectiveArr ?? null;

      const { data: conns } = await supabaseAdmin
        .from('family_connections')
        .select('id, family_id')
        .eq('crew_id', crewId)
        .eq('status', 'approved');
      if (!conns?.length) continue;

      const familyIds = conns.map((c) => c.family_id);
      const connectionIds = conns.map((c) => c.id);
      const { data: prefs } = await supabaseAdmin
        .from('notification_preferences')
        .select('user_id, connection_id, today_flights')
        .in('connection_id', connectionIds);
      const disabledForConnection = new Set<string>();
      for (const p of prefs ?? []) {
        if (p.today_flights === false) disabledForConnection.add(`${p.user_id}:${p.connection_id}`);
      }
      const allowed = familyIds.filter((familyId) => {
        const conn = conns.find((c) => c.family_id === familyId);
        if (!conn) return false;
        return !disabledForConnection.has(`${familyId}:${conn.id}`);
      });
      if (allowed.length === 0) continue;

      const title = 'FlyFam';
      const { data: profilesWithTz } = await supabaseAdmin
        .from('profiles')
        .select('id, timezone_iana, locale')
        .in('id', allowed);
      const timezoneByUserId = new Map<string, string | null>();
      const localeByUserId = new Map<string, NotifLocale>();
      for (const p of profilesWithTz ?? []) {
        timezoneByUserId.set(p.id, p.timezone_iana ?? null);
        const rawLocale = (p as any).locale as string | null | undefined;
        const isTr = typeof rawLocale === 'string' && rawLocale.toLowerCase().startsWith('tr');
        localeByUserId.set(p.id, isTr ? 'tr' : 'en');
      }
      const { data: tokensRows } = await supabaseAdmin.from('device_tokens').select('user_id, token').in('user_id', allowed);
      const tokensByUserId = new Map<string, string[]>();
      for (const row of tokensRows ?? []) {
        const t = (row as { user_id: string; token: string }).token?.trim();
        if (!t) continue;
        const uid = (row as { user_id: string }).user_id;
        if (!tokensByUserId.has(uid)) tokensByUserId.set(uid, []);
        tokensByUserId.get(uid)!.push(t);
      }
      for (const familyUserId of allowed) {
        const userTokens = tokensByUserId.get(familyUserId) ?? [];
        if (userTokens.length === 0) continue;
        const tz = timezoneByUserId.get(familyUserId) ?? null;
        const locale = localeByUserId.get(familyUserId) ?? 'tr';

        // Duty start = first departure - 70 minutes (if we have a departure time).
        let dutyStartIso: string | null = null;
        if (firstDep) {
          const depMs = new Date(firstDep).getTime();
          if (Number.isFinite(depMs)) {
            dutyStartIso = new Date(depMs - 70 * 60 * 1000).toISOString();
          }
        }
        // Duty end = last arrival + 30 minutes (if we have an arrival time).
        let dutyEndIso: string | null = null;
        if (lastArr) {
          const arrMs = new Date(lastArr).getTime();
          if (Number.isFinite(arrMs)) {
            dutyEndIso = new Date(arrMs + 30 * 60 * 1000).toISOString();
          }
        }

        const startRefIso = dutyStartIso ?? firstDep;
        const endRefIso = dutyEndIso ?? lastArr ?? firstDep;

        const startTimeLocal = formatTimeInTimezone(startRefIso, tz);
        const endTimeLocal = formatTimeInTimezone(endRefIso, tz);

        // Duty duration (exact hours/minutes, no rounding).
        let dutyDurationText: string | null = null;
        if (startRefIso && endRefIso) {
          const startMs = new Date(startRefIso).getTime();
          const endMs = new Date(endRefIso).getTime();
          if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
            const totalMinutes = Math.round((endMs - startMs) / (60 * 1000));
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            if (locale === 'tr') {
              if (hours > 0 && minutes > 0) {
                dutyDurationText = `${hours} saat ${minutes} dk`;
              } else if (hours > 0) {
                dutyDurationText = `${hours} saat`;
              } else {
                dutyDurationText = `${minutes} dk`;
              }
            } else {
              if (hours > 0 && minutes > 0) {
                dutyDurationText = `${hours}h ${minutes}m`;
              } else if (hours > 0) {
                dutyDurationText = `${hours}h`;
              } else {
                dutyDurationText = `${minutes}m`;
              }
            }
          }
        }

        // Cross-day note for overnight duties.
        const startDateKey = getLocalDateKey(startRefIso, tz);
        const endDateKey = getLocalDateKey(endRefIso, tz);
        let crossDaySuffix: string | null = null;
        if (startDateKey && endDateKey && startDateKey !== endDateKey) {
          const sd = new Date(startDateKey);
          const ed = new Date(endDateKey);
          const diffDays = Math.round((ed.getTime() - sd.getTime()) / (24 * 60 * 60 * 1000));
          if (diffDays === 1) {
            crossDaySuffix = locale === 'tr' ? ' (ertesi gün bitiyor)' : ' (ends next day)';
          } else if (diffDays > 1) {
            crossDaySuffix = locale === 'tr' ? ` (+${diffDays} gün)` : ` (+${diffDays} days)`;
          }
        }

        const body = manualShare
          ? sharedPlanBody(locale, crewName)
          : todayFlightsBody(
              locale,
              crewName,
              legs,
              startTimeLocal,
              endTimeLocal,
              dutyDurationText,
              crossDaySuffix
            );
        await sendExpoPush(userTokens, title, body);
        totalMembers += 1;
      }
      if (totalMembers > sentBeforeCrew) {
        await logCrewActivity(supabaseAdmin, crew.user_id, 'family_push', {
          kind: 'today_flights',
          crew_id: crewId,
          date,
          sent: totalMembers - sentBeforeCrew,
          manual: manualShare,
          legs,
        });
      }
    }
    return new Response(JSON.stringify({ ok: true, sent: totalMembers }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[notify-family] today_flights error:', msg);
      return new Response(JSON.stringify({ error: 'today_flights failed', details: msg }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  if (payload.type === 'took_off' || payload.type === 'landed' || payload.type === 'cancelled' || payload.type === 'diverted' || payload.type === 'delayed') {
    const { flightId } = payload as FlightEventPayload;
    if (!flightId) {
      return new Response(JSON.stringify({ error: 'took_off/landed/cancelled/diverted/delayed requires flightId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Cron can call with x-cron-secret to send took_off/landed without crew JWT (for crew-offline notifications).
    const fromCron = isCron;
    if (fromCron) {
      console.log('[notify-family]', payload.type, 'from cron', { flightId });
    }
    if (!fromCron && cronHeader) {
      console.warn(
        '[notify-family] Cron request rejected: CRON_SECRET missing or mismatch. Set CRON_SECRET in notify-family secrets to the same value as check-flight-status-and-notify (and x-cron-secret header).'
      );
    }
    const { data: flight, error: flightError } = await supabaseAdmin
      .from('flights')
      .select('id, crew_id, flight_number, origin_city, origin_airport, destination_city, destination_airport, diverted_to')
      .eq('id', flightId)
      .single();
    if (flightError || !flight) {
      return new Response(JSON.stringify({ error: 'Flight not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: fcRows } = await supabaseAdmin
      .from('flight_crew')
      .select('crew_id')
      .eq('flight_id', flightId);
    const crewIdsOnFlight = (fcRows ?? []).map((r: { crew_id: string }) => r.crew_id);
    if (crewIdsOnFlight.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let targetCrewIds: string[] = [];
    if (fromCron) {
      const requestedCrewId = (payload as FlightEventPayload).crewId?.trim();
      if (requestedCrewId && crewIdsOnFlight.includes(requestedCrewId)) {
        targetCrewIds = [requestedCrewId];
      } else {
        targetCrewIds = crewIdsOnFlight;
      }
    } else {
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Authorization required' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const jwt = authHeader.slice(7).trim();
      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: { user }, error: authError } = await supabaseUser.auth.getUser(jwt);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Invalid token', details: authError?.message ?? null }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const crewUserId = user.id;
      const { data: myCrew } = await supabaseAdmin
        .from('crew_profiles')
        .select('id')
        .eq('user_id', crewUserId)
        .single();
      if (!myCrew || !crewIdsOnFlight.includes(myCrew.id)) {
        return new Response(JSON.stringify({ error: 'Not your flight' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      targetCrewIds = [myCrew.id];
    }
    if (targetCrewIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const recipientCrewNameByUser = new Map<string, string>();
    for (const crewId of targetCrewIds) {
      const { data: crewRow } = await supabaseAdmin
        .from('crew_profiles')
        .select('id, user_id')
        .eq('id', crewId)
        .maybeSingle();
      if (!crewRow?.user_id) continue;
      const { data: profileRow } = await supabaseAdmin.from('profiles').select('full_name').eq('id', crewRow.user_id).maybeSingle();
      const crewName = (profileRow?.full_name || 'Crew').trim() || 'Crew';

      const { data: conns2 } = await supabaseAdmin
        .from('family_connections')
        .select('id, family_id')
        .eq('crew_id', crewId)
        .eq('status', 'approved');
      const uniqueByFamily = (conns2 ?? []).filter((c, i, a) => a.findIndex((x) => x.family_id === c.family_id) === i);
      if (!uniqueByFamily.length) continue;

      const prefKey = payload.type;
      const connectionIds2 = uniqueByFamily.map((c) => c.id);
      const { data: prefs2 } = await supabaseAdmin
        .from('notification_preferences')
        .select('user_id, connection_id, ' + prefKey)
        .in('connection_id', connectionIds2);
      const disabled2 = new Set<string>();
      for (const p of prefs2 ?? []) {
        if ((p as Record<string, boolean>)[prefKey] === false) disabled2.add(`${p.user_id}:${p.connection_id}`);
      }
      const allowed2 = uniqueByFamily
        .filter((c) => !disabled2.has(`${c.family_id}:${c.id}`))
        .map((c) => c.family_id);
      for (const uid of allowed2) {
        if (!recipientCrewNameByUser.has(uid)) recipientCrewNameByUser.set(uid, crewName);
      }
    }

    if (recipientCrewNameByUser.size === 0) {
      console.log('[notify-family] sent=0: no approved family recipients for targeted crews', { flightId, targetCrewIds });
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const notifType = payload.type;
    const allowed2 = [...recipientCrewNameByUser.keys()];

    // Per-user idempotency: eski davranışta allowed2 içinde tek bir user_id için log varsa
    // tüm aileye push atlanıyordu (yeni üye / token’ı sonradan gelen hiç alamıyordu).
    let recipients = allowed2;
    if (notifType !== 'delayed') {
      const { data: existingRows } = await supabaseAdmin
        .from('notification_log')
        .select('user_id')
        .eq('flight_id', flightId)
        .eq('type', notifType)
        .in('user_id', allowed2);
      const already = new Set((existingRows ?? []).map((r: { user_id: string }) => r.user_id));
      recipients = allowed2.filter((uid) => !already.has(uid));
      if (recipients.length === 0) {
        console.log('[notify-family]', notifType, 'skipped duplicate (all recipients already notified)', { flightId });
        return new Response(JSON.stringify({ ok: true, sent: 0, duplicate: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { data: tokensRows2 } = await supabaseAdmin.from('device_tokens').select('user_id, token').in('user_id', recipients);
    const tokensByUser2 = new Map<string, string[]>();
    for (const row of tokensRows2 ?? []) {
      const t = (row as { token: string }).token?.trim();
      if (!t) continue;
      const uid = (row as { user_id: string }).user_id;
      if (!tokensByUser2.has(uid)) tokensByUser2.set(uid, []);
      tokensByUser2.get(uid)!.push(t);
    }

    const { data: profilesForLocale } = await supabaseAdmin.from('profiles').select('id, locale').in('id', recipients);
    const localeByUser2 = new Map<string, NotifLocale>();
    for (const p of profilesForLocale ?? []) {
      const rawLocale = (p as any).locale as string | null | undefined;
      const isTr = typeof rawLocale === 'string' && rawLocale.toLowerCase().startsWith('tr');
      localeByUser2.set(p.id, isTr ? 'tr' : 'en');
    }

    const title = 'FlyFam';
    const flightNumber = (flight.flight_number || '').toString().trim() || null;
    const originAirport = normalizeAirportCode(flight.origin_airport as string | null | undefined);
    const destinationAirport = normalizeAirportCode(flight.destination_airport as string | null | undefined);
    const divertedAirport = normalizeAirportCode(flight.diverted_to as string | null | undefined);
    const airportCodes = [originAirport, destinationAirport, divertedAirport]
      .filter((x): x is string => !!x && x.length > 0)
      .map((x) => x.toUpperCase());
    const airportCodesUnique = [...new Set(airportCodes)];
    const cityByIata = new Map<string, { city: string | null; city_tr: string | null }>();
    if (airportCodesUnique.length > 0) {
      const { data: airportRows } = await supabaseAdmin
        .from('airports')
        .select('iata, city, city_tr')
        .in('iata', airportCodesUnique);
      for (const r of airportRows ?? []) {
        const iata = ((r as { iata?: string | null }).iata ?? '').trim().toUpperCase();
        if (!iata) continue;
        cityByIata.set(iata, {
          city: ((r as { city?: string | null }).city ?? null),
          city_tr: ((r as { city_tr?: string | null }).city_tr ?? null),
        });
      }
    }

    const usersWithNoTokens = recipients.filter((uid) => !(tokensByUser2.get(uid)?.length));
    if (usersWithNoTokens.length > 0) {
      console.log('[notify-family] some family users have no device_tokens', { user_ids: usersWithNoTokens, flightId, type: notifType });
    }
    let totalSent2 = 0;
    const loggedUserIds: string[] = [];
    for (const uid of recipients) {
      const userTokens = tokensByUser2.get(uid) ?? [];
      if (userTokens.length === 0) continue;
      const locale = localeByUser2.get(uid) ?? 'tr';
      const crewName = recipientCrewNameByUser.get(uid) ?? 'Crew';
      const cityFrom = preferCityForLocale(
        locale,
        flight.origin_city as string | null | undefined,
        originAirport,
        cityByIata
      );
      const cityTo = preferCityForLocale(
        locale,
        flight.destination_city as string | null | undefined,
        destinationAirport,
        cityByIata
      );
      const route = `${cityFrom}-${cityTo}`;
      const divertedTo = preferCityForLocale(
        locale,
        null,
        divertedAirport,
        cityByIata
      );
      let body: string;
      if (payload.type === 'took_off') body = tookOffBody(locale, crewName, cityFrom, flightNumber);
      else if (payload.type === 'landed') body = landedBody(locale, crewName, cityTo, flightNumber);
      else if (payload.type === 'cancelled') body = cancelledBody(locale, crewName, route);
      else if (payload.type === 'diverted') body = divertedBody(locale, crewName, route, divertedTo);
      else {
        const p = payload as FlightEventPayload;
        body = delayedBody(locale, crewName, cityFrom, cityTo, p.delayPhase, p.delayMinutes);
      }
      await sendExpoPush(userTokens, title, body);
      totalSent2 += userTokens.length;
      loggedUserIds.push(uid);
    }

    // Sadece gerçekten push giden kullanıcıları logla; token yokken log yazmak sonraki cron’da yeniden denemeyi engelliyordu.
    for (const uid of loggedUserIds) {
      await supabaseAdmin.from('notification_log').insert({
        user_id: uid,
        flight_id: flightId,
        type: notifType,
      });
    }

    if (totalSent2 > 0) {
      for (const crewId of targetCrewIds) {
        const { data: crewRow } = await supabaseAdmin
          .from('crew_profiles')
          .select('user_id')
          .eq('id', crewId)
          .maybeSingle();
        await logCrewActivity(supabaseAdmin, crewRow?.user_id, 'family_push', {
          kind: notifType,
          crew_id: crewId,
          flight_id: flightId,
          sent: totalSent2,
          from_cron: fromCron,
        });
      }
    }

    if (totalSent2 === 0 && recipients.length > 0) {
      console.log('[notify-family] sent=0: approved family users have no device_tokens', { flightId, type: notifType, family_user_ids: recipients });
    } else if (totalSent2 > 0) {
      console.log('[notify-family]', notifType, 'sent', totalSent2, { flightId });
    }
    return new Response(JSON.stringify({ ok: true, sent: totalSent2 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown type' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
