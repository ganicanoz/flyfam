/**
 * Apple Takvim aboneliği. Uçuş yok; onaylanmış sabit iş ve fixlenmiş çalışma günleri.
 * verify_jwt kapalı: Takvim uygulaması Authorization göndermez. Sorgu jetonu gizlidir.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildWorkIcs } from '../_shared/workCalendar.mjs';

const EMPTY = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//FlyFam//Calisma//TR',
  'X-WR-CALNAME:Çalışma',
  'END:VCALENDAR',
  '',
].join('\r\n');

const calHeaders = {
  'Content-Type': 'text/calendar; charset=utf-8',
  'Content-Disposition': 'inline; filename="calisma.ics"',
  'Cache-Control': 'private, max-age=300',
  'Access-Control-Allow-Origin': '*',
};

function tokenOk(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...calHeaders, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('GET', { status: 405 });
  const token = new URL(req.url).searchParams.get('t')?.trim() || '';
  if (!/^[a-f0-9]{32}$/.test(token)) return new Response('Not found', { status: 404, headers: calHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return new Response('Calendar unavailable', { status: 500 });
  const client = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.from('admin_planner_state').select('config');
  if (error) return new Response('Calendar unavailable', { status: 500 });

  const rows = (data ?? []) as { config?: { calendarToken?: string; calendarOk?: boolean } }[];
  const hit = rows.filter((row) => row?.config?.calendarOk === true && tokenOk(String(row?.config?.calendarToken || ''), token));
  if (hit.length !== 1) return new Response('Not found', { status: 404, headers: calHeaders });

  let body = '';
  try {
    body = buildWorkIcs(hit[0].config || {});
  } catch {
    body = EMPTY;
  }
  if (!body.startsWith('BEGIN:VCALENDAR') || body.includes(token)) body = EMPTY;
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers: calHeaders });
  return new Response(body, { status: 200, headers: calHeaders });
});
