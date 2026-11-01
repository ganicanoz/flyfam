/**
 * Aile planı bildirimleri: abonelere gönderim, kayıt farkı (plan / roster PDF / tatil) ve zamanlı hatırlatmalar.
 * İsimler ve klinikler config'ten gelir; burada kişisel veri yok.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPush, type VapidKeys } from './webpush.ts';

type Cfg = Record<string, any>;
export type Notice = { title: string; body: string; url?: string; tag?: string };
export type Entry = {
  flight_number: string | null;
  flight_date: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_departure: string | null;
};

const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];
const DAY_SHORT = ['', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTH_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
// Yalnız tam gün resmi tatiller (sabit işler bu günlerde yok sayılır); sayfadaki HOLIDAYS tablosuyla aynı tutulmalı.
const FULL_HOLIDAYS = new Set([
  '2026-01-01', '2026-03-20', '2026-03-21', '2026-03-22', '2026-04-23', '2026-05-01', '2026-05-19', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30',
  '2026-07-15', '2026-08-30', '2026-10-29', '2027-01-01', '2027-03-09', '2027-03-10', '2027-03-11', '2027-04-23', '2027-05-01', '2027-05-16', '2027-05-17',
  '2027-05-18', '2027-05-19', '2027-07-15', '2027-08-30', '2027-10-29',
]);

export function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

const dayIdx = (ymd: string) => Math.round(Date.parse(ymd + 'T00:00:00Z') / 86400000);
export const addDays = (ymd: string, n: number) => new Date((dayIdx(ymd) + n) * 86400000).toISOString().slice(0, 10);
const weekday = (ymd: string) => {
  const d = new Date(ymd + 'T12:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
};
const dshort = (ymd: string) => Number(ymd.slice(8, 10)) + ' ' + MONTH_SHORT[Number(ymd.slice(5, 7)) - 1] + ' ' + DAY_SHORT[weekday(ymd)];
const hm = (v: unknown) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** tz'deki yerel tarih ve dakika. */
export function localNow(tz: string, at = new Date()): { ymd: string; min: number } {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)) p[x.type] = x.value;
  return { ymd: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute) };
}
const localHm = (iso: string | null, tz: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = localNow(tz, d).min;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};

const picksOf = (v: unknown): Cfg[] => (!v ? [] : Array.isArray(v) ? v.filter(Boolean) : [v as Cfg]);
const candName = (cfg: Cfg, id: string) => {
  const c = (cfg.partnerCandidates || []).find((x: Cfg) => String(x.id) === id);
  return String((c && (c.short || c.label)) || id);
};
const crewName = (cfg: Cfg) => String(cfg.people?.crew || 'Crew');
const MONTH_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** İş yeri kısa adı: aday klinik ya da sabit iş, yoksa yer etiketi. */
const placeName = (cfg: Cfg, place: string) => {
  const c = [...(cfg.partnerCandidates || []), ...(cfg.partnerFixed || [])].find((x: Cfg) => x && String(x.place || x.id) === place);
  return String((c && (c.short || c.label)) || cfg.places?.[place]?.label || place);
};
function validVacations(cfg: Cfg): Cfg[] {
  return (Array.isArray(cfg.vacations) ? cfg.vacations : []).filter((v: Cfg) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.to))) return false;
    const span = dayIdx(v.to) - dayIdx(v.from);
    return span >= 0 && span <= 62;
  });
}
const onVacation = (cfg: Cfg, ymd: string) => validVacations(cfg).some((v) => ymd >= v.from && ymd <= v.to);

/** Günün eş işleri (fixli seçimler + sabit işler), başlangıca göre sıralı. */
export function workOf(cfg: Cfg, ymd: string): { name: string; start: string; end: string; fixed: boolean; place: string }[] {
  if (onVacation(cfg, ymd)) return [];
  const candPlace = (id: string) => {
    const c = (cfg.partnerCandidates || []).find((x: Cfg) => String(x.id) === id);
    return String((c && c.place) || id);
  };
  const out = picksOf(cfg.plans?.[ymd.slice(0, 7)]?.[ymd]).map((p) => ({
    name: String(p.short || candName(cfg, String(p.cand))), start: String(p.start || ''), end: String(p.end || ''), fixed: false, place: String(p.place || candPlace(String(p.cand))),
  }));
  const wd = weekday(ymd);
  for (const f of Array.isArray(cfg.partnerFixed) ? cfg.partnerFixed : []) {
    if (!f) continue;
    if (FULL_HOLIDAYS.has(ymd) && f.skipPublicHolidays !== false) continue;
    const nth = f.monthlyNth && Number(f.monthlyNth.weekday) === wd && Math.floor((Number(ymd.slice(8, 10)) - 1) / 7) + 1 === Number(f.monthlyNth.n);
    if (!((Array.isArray(f.dates) && f.dates.includes(ymd)) || (Array.isArray(f.weekdays) && f.weekdays.includes(wd)) || nth)) continue;
    out.push({ name: String(f.short || f.label || 'Sabit iş'), start: String(f.start || ''), end: String(f.end || ''), fixed: true, place: String(f.place || '') });
  }
  return out.sort((a, b) => hm(a.start) - hm(b.start));
}
const workText = (w: ReturnType<typeof workOf>) => w.map((x) => x.name + ' ' + x.start + '–' + x.end).join(' + ');

/** PDF'in doldurduğu günler: yalnız uygulamada (DB) kaydı olmayan günler; en yeni yükleme kazanır. */
function rosterClaims(cfg: Cfg, dbDays: Set<string>): Record<string, Cfg> {
  const claims: Record<string, Cfg> = {};
  const list = (Array.isArray(cfg.rosters) ? cfg.rosters.slice() : []).sort((a: Cfg, b: Cfg) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
  for (const imp of list) {
    if (!imp || !imp.from || !imp.to || !Array.isArray(imp.rows) || dayIdx(imp.to) - dayIdx(imp.from) > 62) continue;
    for (let d = imp.from; d <= imp.to; d = addDays(d, 1)) if (!claims[d] && !dbDays.has(d)) claims[d] = imp;
  }
  return claims;
}

/** Crew'un o günkü görevleri: PDF varsa PDF, yoksa uygulama verisi. */
function crewItems(cfg: Cfg, claims: Record<string, Cfg>, entries: Entry[], ymd: string, tz: string): string[] {
  const route = (o?: string | null, d?: string | null) => (o && d ? ' ' + o + '→' + d : '');
  if (claims[ymd]) return claims[ymd].rows.filter((r: Cfg) => r.fd === ymd).map((r: Cfg) => String(r.n) + route(r.o, r.d) + (r.dt ? ' ' + r.dt : ''));
  return entries.filter((e) => e.flight_date === ymd).map((e) => String(e.flight_number ?? '?') + route(e.origin_airport, e.destination_airport) + (e.scheduled_departure ? ' ' + localHm(e.scheduled_departure, tz) : ''));
}
function crewLine(cfg: Cfg, claims: Record<string, Cfg>, entries: Entry[], ymd: string, tz: string): string {
  const items = crewItems(cfg, claims, entries, ymd, tz);
  return crewName(cfg) + ': ' + (items.length ? items.slice(0, 3).join(', ') + (items.length > 3 ? ' +' + (items.length - 3) : '') : claims[ymd] ? 'görev yok' : 'roster kaydı yok');
}

type SubRow = { id: string; device_id: string; endpoint: string; p256dh: string; auth: string; fail_count: number };

/** Sahibin abonelerine gönderir; geçersiz abonelikleri siler. */
export async function pushToOwner(
  client: SupabaseClient,
  keys: VapidKeys,
  ownerId: string,
  n: Notice,
  opt: { excludeDevice?: string; onlyDevice?: string; onlyPerson?: string; ttl?: number; topic?: string } = {},
): Promise<{ sent: number; failed: number; statuses: number[] }> {
  let q = client.from('family_planner_push_subs').select('id, device_id, endpoint, p256dh, auth, fail_count').eq('owner_user_id', ownerId);
  if (opt.onlyDevice) q = q.eq('device_id', opt.onlyDevice);
  else if (opt.onlyPerson) q = q.eq('person', opt.onlyPerson);
  const { data } = await q;
  const subs = ((data ?? []) as SubRow[]).filter((s) => !opt.excludeDevice || s.device_id !== opt.excludeDevice);
  const payload = { title: n.title.slice(0, 120), body: n.body.slice(0, 600), url: n.url || '/aile/', tag: n.tag || 'aile' };
  const statuses = await Promise.all(
    subs.map(async (s) => {
      let status = 0;
      try {
        status = await sendPush(s, payload, keys, { ttl: opt.ttl, topic: opt.topic });
      } catch {
        status = 0;
      }
      if (status >= 200 && status < 300) await client.from('family_planner_push_subs').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', s.id);
      else if (status === 404 || status === 410 || s.fail_count >= 9) await client.from('family_planner_push_subs').delete().eq('id', s.id);
      else await client.from('family_planner_push_subs').update({ fail_count: s.fail_count + 1 }).eq('id', s.id);
      return status;
    }),
  );
  const sent = statuses.filter((x) => x >= 200 && x < 300).length;
  return { sent, failed: statuses.length - sent, statuses };
}

/** Kayıt öncesi/sonrası config farkından bildirimler (geçmiş günler hariç). */
export function changeNotices(oldCfg: Cfg | null, newCfg: Cfg, today: string): Notice[] {
  const out: Notice[] = [];
  const o = oldCfg || {};
  const lines: string[] = [];
  let firstMonth = '';
  const months = new Set([...Object.keys(o.plans || {}), ...Object.keys(newCfg.plans || {})]);
  const key = (p: Cfg) => String(p.cand) + '|' + p.start + '|' + p.end;
  for (const m of [...months].sort()) {
    const a = (o.plans || {})[m] || {}, b = (newCfg.plans || {})[m] || {};
    for (const ymd of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (ymd < today) continue;
      const pa = picksOf(a[ymd]), pb = picksOf(b[ymd]);
      const ka = new Set(pa.map(key)), kb = new Set(pb.map(key));
      for (const p of pb) {
        if (ka.has(key(p))) continue;
        const was = pa.find((x) => x.cand === p.cand);
        lines.push(dshort(ymd) + ' · ' + candName(newCfg, String(p.cand)) + ' ' + p.start + '–' + p.end + (was ? ' (saat değişti)' : ''));
        firstMonth = firstMonth || m;
      }
      for (const p of pa) {
        if (kb.has(key(p)) || pb.some((x) => x.cand === p.cand)) continue;
        lines.push(dshort(ymd) + ' · ' + candName(newCfg, String(p.cand)) + ' kaldırıldı');
        firstMonth = firstMonth || m;
      }
    }
  }
  if (lines.length) {
    out.push({
      title: '📅 Plan güncellendi',
      body: lines.slice(0, 5).join('\n') + (lines.length > 5 ? '\n+' + (lines.length - 5) + ' değişiklik' : ''),
      url: '/aile/?month=' + firstMonth,
      tag: 'plan',
    });
  }
  const oldIds = new Set((Array.isArray(o.rosters) ? o.rosters : []).map((r: Cfg) => r && r.id));
  for (const r of Array.isArray(newCfg.rosters) ? newCfg.rosters : []) {
    if (!r || oldIds.has(r.id) || !r.from) continue;
    out.push({
      title: '📄 Yeni roster yüklendi',
      body: crewName(newCfg) + ': ' + dshort(r.from) + ' → ' + dshort(r.to || r.from) + ' · ' + (Array.isArray(r.rows) ? r.rows.length : 0) + ' satır. Planı kontrol et.',
      url: '/aile/?month=' + String(r.from).slice(0, 7),
      tag: 'roster',
    });
  }
  const oldVac = new Set(validVacations(o).map((v) => v.from + '|' + v.to));
  for (const v of validVacations(newCfg)) {
    if (oldVac.has(v.from + '|' + v.to) || v.to < today) continue;
    out.push({ title: '🏖️ Tatil eklendi' + (v.label ? ': ' + v.label : ''), body: dshort(v.from) + ' → ' + dshort(v.to) + ' · okul ve iş yok.', url: '/aile/?month=' + v.from.slice(0, 7), tag: 'vac' });
  }
  return out;
}

async function once(client: SupabaseClient, ownerId: string, key: string): Promise<boolean> {
  const { error } = await client.from('family_planner_notify_log').insert({ owner_user_id: ownerId, key });
  return !error;
}

async function rainHours(ymd: string): Promise<Record<number, boolean>> {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=29.03&timezone=Europe%2FIstanbul&hourly=precipitation,precipitation_probability&start_date=' + ymd + '&end_date=' + ymd;
  const out: Record<number, boolean> = {};
  try {
    const j = await (await fetch(url)).json();
    (j.hourly?.time || []).forEach((t: string, i: number) => {
      out[Number(t.slice(11, 13))] = (j.hourly.precipitation?.[i] || 0) >= 0.2 || (j.hourly.precipitation_probability?.[i] || 0) >= 60;
    });
  } catch {
    /* hava servisi yoksa uyarı yok */
  }
  return out;
}

/** 15 dk'da bir: akşam hatırlatma, sabah yağış, tatil (7 gün önce), plan günlerinde roster değişikliği. */
export async function runOwnerCron(
  client: SupabaseClient,
  keys: VapidKeys,
  ownerId: string,
  cfg: Cfg,
  loadEntries: (from: string, to: string) => Promise<Entry[]>,
  test: { at?: Date; onlyDevice?: string } = {},
): Promise<string[]> {
  const tz = String(cfg.timezone || 'Europe/Istanbul');
  const { ymd: today, min } = localNow(tz, test.at);
  const done: string[] = [];
  const horizon = addDays(today, 45);
  const entries = await loadEntries(addDays(today, -1), horizon);
  const claims = rosterClaims(cfg, new Set(entries.map((e) => e.flight_date).filter((d): d is string => !!d)));
  const send = async (key: string, n: Notice, ttl = 6 * 3600, onlyPerson?: string) => {
    if (onlyPerson && !test.onlyDevice) {
      // Alıcı henüz yoksa anahtarı tüketme; kişi seçilince aynı gün yine denensin.
      const { count } = await client.from('family_planner_push_subs').select('id', { count: 'exact', head: true }).eq('owner_user_id', ownerId).eq('person', onlyPerson);
      if (!count) return;
    }
    if (!test.onlyDevice && !(await once(client, ownerId, key))) return;
    const r = await pushToOwner(client, keys, ownerId, n, { ttl, onlyDevice: test.onlyDevice, onlyPerson });
    done.push(key + ':' + r.sent + '/' + (r.sent + r.failed));
  };

  // Ciro: günlük kaynakta iş bitişinden 30 dk sonra (akşam), aylık kaynaklarda ayın 1–5'i önceki ay; yalnız eşin cihazlarına.
  const fin = (cfg.finance || {}) as Cfg;
  const daily: string[] = Array.isArray(fin.daily) ? fin.daily.map(String) : [];
  const monthly: string[] = Array.isArray(fin.monthly) ? fin.monthly.map(String) : [];
  const hasCiro = async (source: string, period: string) => {
    const { data } = await client.from('family_planner_finance').select('source').eq('owner_user_id', ownerId).eq('source', source).eq('period', period).maybeSingle();
    return !!data;
  };
  if (daily.length && min >= 17 * 60 && min < 23 * 60) {
    for (const w of workOf(cfg, today)) {
      if (!daily.includes(w.place) || min < hm(w.end) + 30 || (!test.onlyDevice && ((await hasCiro(w.place, today)) || (await hasCiro(w.place, today.slice(0, 7)))))) continue;
      await send('ciro:' + w.place + ':' + today, {
        title: '💰 Bugünkü ciro bilgisini girer misin?',
        body: w.name + ' ' + w.start + '–' + w.end + ' · tutarı yaz ya da 0 TL seç.',
        url: '/aile/?ciro=1',
        tag: 'ciro-' + today,
      }, 12 * 3600, 'partner');
    }
  }
  if (monthly.length && Number(today.slice(8, 10)) <= 5 && min >= 10 * 60 && min < 21 * 60) {
    const [y, m] = today.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const missing: string[] = [];
    for (const s of monthly) if (test.onlyDevice || !(await hasCiro(s, prev))) missing.push(s);
    if (missing.length) {
      await send('ciro-m:' + prev + ':' + today, {
        title: '💰 ' + MONTH_LONG[Number(prev.slice(5, 7)) - 1] + ' cirosu',
        body: missing.map((s) => placeName(cfg, s)).join(', ') + ': geçen ayın cirosunu girer misin? (yoksa 0 TL)',
        url: '/aile/?ciro=1',
        tag: 'ciro-m-' + prev,
      }, 12 * 3600, 'partner');
    }
  }
  if (Array.isArray(fin.debt?.sources) && fin.debt.sources.length && min >= 10 * 60 && min < 21 * 60) {
    const { data: due } = await client.from('family_planner_debt').select('label, amount, seq, total_n').eq('owner_user_id', ownerId).eq('due_date', today).is('paid_on', null).limit(20);
    if (due && due.length) {
      const fmt = (v: number) => Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' TL';
      const sum = due.reduce((a, d) => a + Number(d.amount), 0);
      await send('debt:' + today, {
        title: '💳 Bugün ödeme günü · ' + fmt(sum),
        body: due.slice(0, 4).map((d) => (String(fin.debt.label || 'Ödeme') + (d.label ? ' · ' + d.label : '') + (d.total_n > 1 ? ' (' + d.seq + '/' + d.total_n + ')' : '') + ': ' + fmt(Number(d.amount)))).join('\n') + (due.length > 4 ? '\n+' + (due.length - 4) + ' ödeme' : ''),
        url: '/aile/?tab=fin',
        tag: 'debt-' + today,
      }, 12 * 3600, 'partner');
    }
  }

  if (min >= 20 * 60 && min < 20 * 60 + 20) {
    const tm = addDays(today, 1);
    const w = workOf(cfg, tm);
    const crew = crewItems(cfg, claims, entries, tm, tz);
    const sc = cfg.school || {};
    const schoolDay = (sc.weekdays || [1, 2, 3, 4, 5]).includes(weekday(tm)) && !onVacation(cfg, tm) && !FULL_HOLIDAYS.has(tm) && !(sc.closedDates || []).includes(tm);
    const people = cfg.people || {};
    const appts = (Array.isArray(cfg.familyAppointments) ? cfg.familyAppointments : [])
      .filter((a: Cfg) => a && a.date === tm && ['crew', 'child', 'partner'].includes(String(a.person)))
      .slice(0, 4)
      .map((a: Cfg) => [String(a.start || '') + (a.end ? '–' + a.end : ''), people[a.person], a.label, a.location].filter((x) => x).join(' · '));
    const help = cfg.homeHelp;
    const helpOn = help && typeof help === 'object' && !Array.isArray(help) && help.enabled !== false && (Array.isArray(help.covers) ? help.covers.map(String).includes('home') : false) && (crew.length > 0 || w.length > 0);
    const lines: string[] = [];
    if (crew.length) lines.push(crewName(cfg) + ': ' + crew.slice(0, 4).join(' · '));
    if (w.length) lines.push(workText(w));
    if (schoolDay && (sc.start || sc.end)) lines.push('Okul ' + (sc.start || '') + '–' + (sc.end || ''));
    for (const a of appts) lines.push(a);
    if (helpOn) lines.push(String(help.name || '').trim() ? 'Evde: ' + String(help.name).trim() : 'Evde bakım var');
    await send('eve:' + tm, {
      title: 'Yarın · ' + dshort(tm),
      body: lines.length ? lines.join('\n') : 'Kayıtlı iş, görev veya randevu yok.',
      url: '/aile/?month=' + tm.slice(0, 7),
      tag: 'eve-' + tm,
    });
  }

  if (min >= 6 * 60 + 30 && min < 9 * 60) {
    const w = workOf(cfg, today);
    if (w.length) {
      const rain = await rainHours(today);
      const hit = new Set<number>();
      for (const x of w) for (let h = Math.floor((hm(x.start) - 90) / 60); h <= Math.floor((hm(x.end) + 60) / 60); h += 1) if (rain[h]) hit.add(h);
      if (hit.size) {
        const hs = [...hit].sort((a, b) => a - b);
        await send('rain:' + today, {
          title: '☔ Bugün yağış bekleniyor',
          body: workText(w) + '\nYağış ' + String(hs[0]).padStart(2, '0') + ':00–' + String(hs[hs.length - 1] + 1).padStart(2, '0') + ':00 civarı; yollar uzun sürebilir, erken çık.',
          url: '/aile/?month=' + today.slice(0, 7),
          tag: 'rain-' + today,
        });
      }
    }
  }

  if (min >= 10 * 60 && min < 21 * 60) {
    for (const v of validVacations(cfg)) {
      if (dayIdx(v.from) - dayIdx(today) !== 7) continue;
      await send('vac7:' + v.from + ':' + v.to, {
        title: '🏖️ 1 hafta sonra tatil' + (v.label ? ': ' + v.label : ''),
        body: dshort(v.from) + ' → ' + dshort(v.to) + '. İyi hazırlıklar!',
        url: '/aile/?month=' + v.from.slice(0, 7),
        tag: 'vac-' + v.from,
      }, 24 * 3600);
    }
  }

  // Roster: uygulama verisinin gün imzaları (DB birincil; kaybolan gün de değişiklik sayılır); gece değişiklikleri sabaha kalır.
  if (!test.at && !test.onlyDevice && min >= 7 * 60 && min < 22 * 60) {
    const sigs: Record<string, string> = {};
    for (const e of entries) {
      const d = e.flight_date;
      if (!d || d < today || d > horizon) continue;
      sigs[d] = (sigs[d] ? sigs[d] + ',' : '') + (e.flight_number ?? '?') + '@' + (e.scheduled_departure ?? '');
    }
    for (const d of Object.keys(sigs)) sigs[d] = sigs[d].split(',').sort().join(',');
    const { data: watch } = await client.from('family_planner_watch').select('roster_days').eq('owner_user_id', ownerId).maybeSingle();
    if (watch) {
      const prev = (watch.roster_days || {}) as Record<string, string>;
      const changed: string[] = [];
      for (let d = today; d <= horizon; d = addDays(d, 1)) {
        if ((prev[d] || '') === (sigs[d] || '')) continue;
        if (workOf(cfg, d).length) changed.push(d);
      }
      if (changed.length) {
        const lines = changed.slice(0, 4).map((d) => {
          const items = crewItems(cfg, claims, entries, d, tz);
          return dshort(d) + ' (' + workText(workOf(cfg, d)) + '): ' + (items.length ? items.slice(0, 2).join(', ') : 'görev kalktı');
        });
        const r = await pushToOwner(client, keys, ownerId, {
          title: '✈️ Roster değişti · ' + crewName(cfg),
          body: lines.join('\n') + (changed.length > 4 ? '\n+' + (changed.length - 4) + ' gün' : '') + '\nPlanı kontrol et.',
          url: '/aile/?month=' + changed[0].slice(0, 7),
          tag: 'roster-change',
        });
        done.push('roster:' + changed.length + ':' + r.sent);
      }
    }
    await client.from('family_planner_watch').upsert({ owner_user_id: ownerId, roster_days: sigs, updated_at: new Date().toISOString() });
  }

  if (min >= 3 * 60 && min < 3 * 60 + 15) await client.from('family_planner_notify_log').delete().eq('owner_user_id', ownerId).lt('sent_at', new Date(Date.now() - 120 * 86400000).toISOString());
  return done;
}
