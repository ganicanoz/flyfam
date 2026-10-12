/**
 * Aile planındaki çalışma günleri → iCalendar.
 * Uçuş, okul yolu ve taslak seçim yok. Yalnız sabit işler ve kaydedilmiş planlar.
 * Türkiye 2016'dan beri sürekli UTC+3.
 */

export const WORK_HOLIDAYS = {
  '2026-01-01': ['Yılbaşı'], '2026-03-19': ['Ramazan B. arifesi', true], '2026-03-20': ['Ramazan Bayramı'], '2026-03-21': ['Ramazan Bayramı'],
  '2026-03-22': ['Ramazan Bayramı'], '2026-04-23': ['23 Nisan'], '2026-05-01': ['1 Mayıs'], '2026-05-19': ['19 Mayıs'], '2026-05-26': ['Kurban B. arifesi', true],
  '2026-05-27': ['Kurban Bayramı'], '2026-05-28': ['Kurban Bayramı'], '2026-05-29': ['Kurban Bayramı'], '2026-05-30': ['Kurban Bayramı'], '2026-07-15': ['15 Temmuz'],
  '2026-08-30': ['30 Ağustos'], '2026-10-28': ['Cumhuriyet B. arifesi', true], '2026-10-29': ['Cumhuriyet Bayramı'],
  '2027-01-01': ['Yılbaşı'], '2027-03-08': ['Ramazan B. arifesi', true], '2027-03-09': ['Ramazan Bayramı'], '2027-03-10': ['Ramazan Bayramı'], '2027-03-11': ['Ramazan Bayramı'],
  '2027-04-23': ['23 Nisan'], '2027-05-01': ['1 Mayıs'], '2027-05-15': ['Kurban B. arifesi', true], '2027-05-16': ['Kurban Bayramı'], '2027-05-17': ['Kurban Bayramı'],
  '2027-05-18': ['Kurban Bayramı'], '2027-05-19': ['Kurban B. · 19 Mayıs'], '2027-07-15': ['15 Temmuz'], '2027-08-30': ['30 Ağustos'],
  '2027-10-28': ['Cumhuriyet B. arifesi', true], '2027-10-29': ['Cumhuriyet Bayramı'],
};

const dayIndex = (ymd) => Math.round(Date.parse(ymd + 'T00:00:00Z') / 86400000);
const ymdOf = (idx) => new Date(idx * 86400000).toISOString().slice(0, 10);
export const addDays = (ymd, n) => ymdOf(dayIndex(ymd) + n);
const weekday = (ymd) => {
  const d = new Date(ymd + 'T12:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
};

function fixedApplies(f, ymd, wd) {
  if (Array.isArray(f.skipDates) && f.skipDates.includes(ymd)) return false;
  if (Array.isArray(f.dates) && f.dates.includes(ymd)) return true;
  if (Array.isArray(f.weekdays) && f.weekdays.includes(wd)) return true;
  if (f.monthlyNth && Number(f.monthlyNth.weekday) === wd) {
    return Math.floor((Number(ymd.slice(8, 10)) - 1) / 7) + 1 === Number(f.monthlyNth.n);
  }
  return false;
}

function vacationBlocks(cfg, ymd, today) {
  const y = Number(String(today || ymd).slice(0, 4));
  return (cfg.vacations || []).some((v) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(v.to || '')) return false;
    if (v.to < v.from) return false;
    if (Number(v.from.slice(0, 4)) < y - 1 || Number(v.to.slice(0, 4)) > y + 2) return false;
    if ((Date.parse(v.to + 'T00:00:00Z') - Date.parse(v.from + 'T00:00:00Z')) / 86400000 > 62) return false;
    return ymd >= v.from && ymd <= v.to;
  });
}

function picksOf(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

function hmOk(v) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function icsText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\r\n|\n|\r/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const dec = new TextDecoder();
  let out = '';
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + limit);
    while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end === start) end = Math.min(bytes.length, start + limit);
    out += (start === 0 ? '' : '\r\n ') + dec.decode(bytes.slice(start, end));
    start = end;
    limit = 74;
  }
  return out;
}

function stampOf(ymd, hm) {
  return ymd.replace(/-/g, '') + 'T' + String(hm).replace(':', '') + '00';
}

/**
 * @param {object} cfg planner config (plans dahil)
 * @param {{ today?: string, from?: string, to?: string }} [opts]
 */
export function buildWorkIcs(cfg, opts = {}) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  const today = opts.today || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const from = opts.from || addDays(today, -21);
  const to = opts.to || addDays(today, 270);
  const plans = src.plans && typeof src.plans === 'object' ? src.plans : {};
  const places = src.places && typeof src.places === 'object' ? src.places : {};
  const events = [];
  let guard = 0;
  for (let ymd = from; ymd <= to && guard < 400; ymd = addDays(ymd, 1), guard += 1) {
    if (vacationBlocks(src, ymd, today)) continue;
    const wd = weekday(ymd);
    const hol = WORK_HOLIDAYS[ymd] || null;
    const holFull = !!(hol && !hol[1]);
    const dayPlans = picksOf((plans[ymd.slice(0, 7)] || {})[ymd]);
    for (const p of dayPlans) {
      const start = hmOk(p.start);
      const end = hmOk(p.end);
      if (start == null || end == null || end <= start) continue;
      const placeKey = String(p.place || p.cand || 'plan');
      const place = places[placeKey] || {};
      events.push({
        ymd,
        start: p.start,
        end: p.end,
        title: String(p.label || p.short || place.label || 'Çalışma').slice(0, 140),
        placeKey,
        location: String(place.address || '').trim(),
        note: '',
      });
    }
    for (const f of src.partnerFixed || []) {
      if (!f || typeof f !== 'object') continue;
      if (holFull && f.skipPublicHolidays !== false) continue;
      if (!fixedApplies(f, ymd, wd)) continue;
      const start = hmOk(f.start);
      const end = hmOk(f.end);
      if (start == null || end == null || end <= start) continue;
      const placeKey = String(f.place || 'is');
      const place = places[placeKey] || {};
      events.push({
        ymd,
        start: f.start,
        end: f.end,
        title: String(f.label || f.short || place.label || 'Çalışma').slice(0, 140),
        placeKey,
        location: String(place.address || '').trim(),
        note: String(f.note || '').slice(0, 300),
      });
    }
  }
  const seen = new Map();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FlyFam//Calisma//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Çalışma',
    'X-WR-TIMEZONE:Europe/Istanbul',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Istanbul',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0300',
    'TZNAME:+03',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const ev of events) {
    let uid = 'flyfam-work-' + ev.ymd + '-' + ev.placeKey.replace(/[^a-z0-9]/gi, '').slice(0, 24) + '-' + ev.start.replace(':', '') + '@flyfamapp';
    const n = seen.get(uid) || 0;
    seen.set(uid, n + 1);
    if (n) uid = uid.replace('@', '-' + (n + 1) + '@');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uid);
    lines.push('DTSTAMP:20260101T000000Z');
    lines.push('DTSTART;TZID=Europe/Istanbul:' + stampOf(ev.ymd, ev.start));
    lines.push('DTEND;TZID=Europe/Istanbul:' + stampOf(ev.ymd, ev.end));
    lines.push('SUMMARY:' + icsText(ev.title));
    if (ev.location) lines.push('LOCATION:' + icsText(ev.location));
    if (ev.note) lines.push('DESCRIPTION:' + icsText(ev.note));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

if (typeof window !== 'undefined') window.buildWorkIcs = buildWorkIcs;
