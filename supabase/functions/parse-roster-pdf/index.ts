/**
 * PDF → metin: Node/pdf-parse (`npm run pdf:roster` ile aynı motor).
 * Yanıt: `{ text, flights }` — `flights` sunucuda paylaşılan parser ile üretilir (simulator/script ile tutarlı).
 * Mobil: varsa **önce `flights`** kullanır; Edge erişilemezse yerel extract + istemci parser (metin farklı olabilir).
 *
 * Deploy: supabase functions deploy parse-roster-pdf
 */
import { Buffer } from 'node:buffer';
import pdfParse from 'npm:pdf-parse@1.1.1';
import { getDocument } from 'npm:pdfjs-dist@4.3.136/legacy/build/pdf.mjs';
import {
  looksLikeFreebirdRosterPdf,
  looksLikeIndigoCrewSchedulePdf,
  looksLikeSunExpressSchedulePdf,
  parseFlightsFromPdfText,
  parseFlightsFromPdfText_SunExpress,
  type PdfFlightRow,
} from '../_shared/pdfRosterImport.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function stripDataUrl(b64: string): string {
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 7) : b64;
}

function base64ToBuffer(b64: string): Buffer {
  const raw = stripDataUrl(b64).replace(/\s/g, '');
  return Buffer.from(raw, 'base64');
}

function parseMonthName(mon: string): number | null {
  const m = mon.trim().toLowerCase();
  const map: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  return map[m] ?? null;
}

function toYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function extractMonthYear(text: string): { year: number; month: number } | null {
  const compact = text.replace(/\s+/g, ' ');
  const mm =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i.exec(
      compact,
    );
  if (!mm) return null;
  const month = parseMonthName(mm[1] ?? '');
  const year = Number(mm[2] ?? '');
  if (!month || !Number.isFinite(year)) return null;
  return { year, month };
}

function monthDistance(y: number, m: number, targetY: number, targetM: number): number {
  return Math.abs((y - targetY) * 12 + (m - targetM));
}

function candidateDatesForDay(day: number, targetY: number, targetM: number): Date[] {
  const out: Date[] = [];
  const push = (y: number, m: number) => {
    const max = daysInMonth(y, m);
    if (day >= 1 && day <= max) out.push(new Date(Date.UTC(y, m - 1, day)));
  };
  push(targetY, targetM);
  const prev = new Date(Date.UTC(targetY, targetM - 2, 1));
  push(prev.getUTCFullYear(), prev.getUTCMonth() + 1);
  const next = new Date(Date.UTC(targetY, targetM, 1));
  push(next.getUTCFullYear(), next.getUTCMonth() + 1);
  return out;
}

type SunExpressLeg = {
  code: string;
  origin: string;
  destination: string;
  stdUtc: string;
  staUtc: string;
};

function addDaysIso(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hhmmToMin(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function normalizeLegDirectionByDuration(leg: {
  code: string;
  origin: string | null;
  destination: string | null;
  stdUtc: string | null;
  staUtc: string | null;
}): {
  code: string;
  origin: string | null;
  destination: string | null;
  stdUtc: string | null;
  staUtc: string | null;
} {
  const dep = leg.stdUtc ? hhmmToMin(leg.stdUtc) : null;
  const arr = leg.staUtc ? hhmmToMin(leg.staUtc) : null;
  if (dep == null || arr == null) return leg;

  const asIsDuration = arr >= dep ? arr - dep : arr + 24 * 60 - dep;
  const swappedDuration = 24 * 60 - asIsDuration;

  // SunExpress kısa/orta menzil operasyonlarında 12+ saat tek bacak neredeyse hiç beklenmez.
  // Parser ters okuduğunda süre 18-20 saat görünür; swap sonrası 2-5 saate iner.
  const looksReversed = asIsDuration > 12 * 60 && swappedDuration < 8 * 60;
  if (!looksReversed) return leg;

  return {
    code: leg.code,
    origin: leg.destination ?? null,
    destination: leg.origin ?? null,
    stdUtc: leg.staUtc ?? null,
    staUtc: leg.stdUtc ?? null,
  };
}

function extractSunExpressLegs(rawText: string): Map<string, SunExpressLeg[]> {
  const out = new Map<string, SunExpressLeg[]>();
  const compact = rawText.replace(/\s+/g, ' ');

  const push = (leg: SunExpressLeg) => {
    const arr = out.get(leg.code) ?? [];
    if (!arr.some((x) => x.origin === leg.origin && x.destination === leg.destination && x.stdUtc === leg.stdUtc && x.staUtc === leg.staUtc)) {
      arr.push(leg);
      out.set(leg.code, arr);
    }
  };

  // Standart: XQ184 AYT 00:40 ~ 04:27 DUS
  const p1 = /\b(XQ\d{2,4}|DH)\s*([A-Z]{3})\s*(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\s*([A-Z]{3})\b/gi;
  for (const m of compact.matchAll(p1)) {
    push({
      code: (m[1] ?? '').toUpperCase(),
      origin: (m[2] ?? '').toUpperCase(),
      stdUtc: String(m[3] ?? '').padStart(5, '0'),
      staUtc: String(m[4] ?? '').padStart(5, '0'),
      destination: (m[5] ?? '').toUpperCase(),
    });
  }

  // Sıkışık: ~ 12:50AYTFRA 17:40XQ142
  const p2 = /~\s*(\d{1,2}:\d{2})\s*([A-Z]{6})\s*(\d{1,2}:\d{2})\s*(XQ\d{2,4}|DH)\b/gi;
  for (const m of compact.matchAll(p2)) {
    const route = (m[2] ?? '').toUpperCase();
    // Ham PDF metninde bu kalıp çoğunlukla ters yönde akar:
    // ~ STA DESTORIG STD CODE  (örn: ~ 16:30 NCLAYT 11:46XQ582)
    // Bu yüzden origin/destination ve std/sta ters çevrilir.
    push({
      code: (m[4] ?? '').toUpperCase(),
      origin: route.slice(3, 6),
      stdUtc: String(m[3] ?? '').padStart(5, '0'),
      staUtc: String(m[1] ?? '').padStart(5, '0'),
      destination: route.slice(0, 3),
    });
  }
  // Ayrık ama ters akış: ~ 12:41 ASR AMS 08:58XQ1323
  const p3 = /~\s*(\d{1,2}:\d{2})\s*([A-Z]{3})\s*([A-Z]{3})\s*(\d{1,2}:\d{2})\s*(XQ\d{2,4}|DH)\b/gi;
  for (const m of compact.matchAll(p3)) {
    push({
      code: (m[5] ?? '').toUpperCase(),
      origin: (m[3] ?? '').toUpperCase(),
      stdUtc: String(m[4] ?? '').padStart(5, '0'),
      staUtc: String(m[1] ?? '').padStart(5, '0'),
      destination: (m[2] ?? '').toUpperCase(),
    });
  }

  return out;
}

async function parseSunExpressWithLayout(buf: Uint8Array, rawText: string): Promise<PdfFlightRow[] | null> {
  const monthInfo = extractMonthYear(rawText);
  if (!monthInfo) return null;

  const doc = await getDocument({ data: buf, disableWorker: true }).promise;
  const flightsByLayout: Array<{ date: string; code: string }> = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str?: string; transform?: number[] }>).map((it) => {
      const t = it.transform ?? [1, 0, 0, 1, 0, 0];
      const x = Number(t[4] ?? 0);
      const y = Number(t[5] ?? 0);
      return {
        text: String(it.str ?? '').trim(),
        x,
        top: vp.height - y,
      };
    }).filter((x) => x.text.length > 0);

    const dayCandidates = items
      .filter((w) => /^\d{1,2}$/.test(w.text))
      .map((w) => ({ ...w, day: Number(w.text) }))
      .filter((w) => w.day >= 1 && w.day <= 31 && w.top < vp.height * 0.85);
    if (dayCandidates.length < 7) continue;

    // Zaman parçalarını eleyip gerçek takvim satırlarını bul:
    // Satırda 5-7 adet gün numarası olmalı ve x dağılımı geniş olmalı.
    const rowSeeds: number[] = [];
    for (const d of dayCandidates.sort((a, b) => a.top - b.top)) {
      const hit = rowSeeds.find((t) => Math.abs(t - d.top) <= 8);
      if (hit == null) rowSeeds.push(d.top);
    }
    rowSeeds.sort((a, b) => a - b);
    const rows = rowSeeds
      .map((rt) => dayCandidates.filter((d) => Math.abs(d.top - rt) <= 8).sort((a, b) => a.x - b.x))
      .filter((row) => {
        if (row.length < 5 || row.length > 7) return false;
        const xSpread = row[row.length - 1]!.x - row[0]!.x;
        return xSpread > vp.width * 0.55;
      });
    if (rows.length === 0) continue;
    const rowTops = rows.map((r) => r[0]!.top).sort((a, b) => a - b);

    const colCenters = [...rows].sort((a, b) => b.length - a.length)[0]!.map((d) => d.x).sort((a, b) => a - b);
    if (colCenters.length < 5) continue;

    const colBounds: Array<{ lo: number; hi: number }> = colCenters.map((c, i) => ({
      lo: i === 0 ? -1e9 : (colCenters[i - 1]! + c) / 2,
      hi: i === colCenters.length - 1 ? 1e9 : (c + colCenters[i + 1]!) / 2,
    }));

    const dayToDate = new Map<string, string>();
    const dayByRowCol = new Map<string, string>();
    for (const row of rows) {
      for (const d of row) {
        const col = colCenters.reduce(
          (best, cx, idx) => (Math.abs(cx - d.x) < Math.abs(colCenters[best] - d.x) ? idx : best),
          0,
        );
        const rowIdx = rowTops.reduce(
          (best, rt, idx) => (Math.abs(rt - d.top) < Math.abs(rowTops[best] - d.top) ? idx : best),
          0,
        );
        const candidates = candidateDatesForDay(d.day, monthInfo.year, monthInfo.month);
        let picked: Date | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const c of candidates) {
          const weekday = c.getUTCDay(); // 0=Sun
          const mismatch = weekday === col ? 0 : 10;
          const dist = monthDistance(
            c.getUTCFullYear(),
            c.getUTCMonth() + 1,
            monthInfo.year,
            monthInfo.month,
          );
          const score = mismatch + dist;
          if (score < bestScore) {
            bestScore = score;
            picked = c;
          }
        }
        if (picked) {
          const ymd = toYmd(picked.getUTCFullYear(), picked.getUTCMonth() + 1, picked.getUTCDate());
          dayToDate.set(`${d.top.toFixed(1)}:${d.x.toFixed(1)}`, ymd);
          dayByRowCol.set(`${rowIdx}:${col}`, ymd);
        }
      }
    }

    const flightTokens: Array<{ text: string; x: number; top: number }> = [];
    for (const w of items) {
      const matches = w.text.toUpperCase().match(/(XQ\d{2,4}|DH)/g);
      if (!matches) continue;
      for (const code of matches) flightTokens.push({ text: code, x: w.x, top: w.top });
    }
    for (const f of flightTokens) {
      let rowIdx = 0;
      for (let i = 0; i < rowTops.length; i += 1) {
        if (f.top >= rowTops[i] - 1) rowIdx = i;
      }
      const colIdx = colBounds.findIndex((b) => f.x > b.lo && f.x <= b.hi);
      const dateIso =
        (rowIdx >= 0 && colIdx >= 0 ? dayByRowCol.get(`${rowIdx}:${colIdx}`) : null) ??
        (() => {
          // fallback: en yakın day başlığı (eski yöntem)
          let best: { top: number; x: number } | null = null;
          for (const row of rows) {
            for (const d of row) {
              if (!best) best = d;
              else if (Math.abs(d.x - f.x) + Math.abs(d.top - f.top) < Math.abs(best.x - f.x) + Math.abs(best.top - f.top)) best = d;
            }
          }
          if (!best) return null;
          return dayToDate.get(`${best.top.toFixed(1)}:${best.x.toFixed(1)}`) ?? null;
        })();
      if (!dateIso) continue;
      flightsByLayout.push({ date: dateIso, code: f.text.toUpperCase() });
    }
  }

  if (flightsByLayout.length === 0) return null;

  // Detaylar (dep/dest/std/sta) ham metinden regex ile çıkarılır (date bağımsız).
  const detailByCode = extractSunExpressLegs(rawText);
  const usedByCode = new Map<string, number>();

  const out: PdfFlightRow[] = [];
  const dedupe = new Set<string>();
  for (const item of flightsByLayout) {
    const code = item.code;
    const list = detailByCode.get(code) ?? [];
    const idx = usedByCode.get(code) ?? 0;
    const src = list[Math.min(idx, Math.max(0, list.length - 1))];
    usedByCode.set(code, idx + 1);
    const normalized = normalizeLegDirectionByDuration({
      code,
      origin: src?.origin ?? null,
      destination: src?.destination ?? null,
      stdUtc: src?.stdUtc ?? null,
      staUtc: src?.staUtc ?? null,
    });
    const depMin = normalized.stdUtc ? hhmmToMin(normalized.stdUtc) : null;
    const arrMin = normalized.staUtc ? hhmmToMin(normalized.staUtc) : null;
    const arrDate = depMin != null && arrMin != null && arrMin < depMin ? addDaysIso(item.date, 1) : item.date;
    const row: PdfFlightRow = {
      flight_number: code,
      flight_date: item.date,
      dep_time_local: normalized.stdUtc ?? null,
      arr_time_local: normalized.staUtc ?? null,
      dep_schedule_utc_iso: normalized.stdUtc ? `${item.date}T${normalized.stdUtc}:00.000Z` : null,
      arr_schedule_utc_iso: normalized.staUtc ? `${arrDate}T${normalized.staUtc}:00.000Z` : null,
      origin_iata: normalized.origin ?? null,
      destination_iata: normalized.destination ?? null,
    };
    const k = `${row.flight_date}|${row.flight_number}|${row.origin_iata ?? ''}|${row.destination_iata ?? ''}|${row.dep_time_local ?? ''}|${row.arr_time_local ?? ''}`;
    if (!dedupe.has(k)) {
      dedupe.add(k);
      out.push(row);
    }
  }

  // Safety net: layout parser'ın özellikle ay sonu (24-30) kutularında kaçırdığı XQ/DH satırlarını
  // text parser'dan tamamla (yalnızca hedef ay içinde ve gerçekten eksik olan kod/tarih çiftleri).
  const fallbackRows = parseFlightsFromPdfText_SunExpress(rawText).filter(
    (r) => r.flight_number !== 'FOF' && /^(XQ\d{2,4}|DH)$/i.test(r.flight_number || ''),
  );
  for (const r of fallbackRows) {
    const y = Number(r.flight_date.slice(0, 4));
    const m = Number(r.flight_date.slice(5, 7));
    const d = Number(r.flight_date.slice(8, 10));
    if (y !== monthInfo.year || m !== monthInfo.month) continue;
    if (d < 24) continue;
    const code = (r.flight_number || '').toUpperCase();
    const key = `${r.flight_date}|${code}|${r.origin_iata ?? ''}|${r.destination_iata ?? ''}|${r.dep_time_local ?? ''}|${r.arr_time_local ?? ''}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    const normalized = normalizeLegDirectionByDuration({
      code,
      origin: r.origin_iata ?? null,
      destination: r.destination_iata ?? null,
      stdUtc: r.dep_time_local ?? null,
      staUtc: r.arr_time_local ?? null,
    });
    const dep = normalized.stdUtc ? hhmmToMin(normalized.stdUtc) : null;
    const arr = normalized.staUtc ? hhmmToMin(normalized.staUtc) : null;
    const arrDate = dep != null && arr != null && arr < dep ? addDaysIso(r.flight_date, 1) : r.flight_date;
    out.push({
      flight_number: code,
      flight_date: r.flight_date,
      dep_time_local: normalized.stdUtc ?? null,
      arr_time_local: normalized.staUtc ?? null,
      dep_schedule_utc_iso: normalized.stdUtc ? `${r.flight_date}T${normalized.stdUtc}:00.000Z` : null,
      arr_schedule_utc_iso: (() => {
        if (!normalized.staUtc) return null;
        return `${arrDate}T${normalized.staUtc}:00.000Z`;
      })(),
      origin_iata: normalized.origin ?? null,
      destination_iata: normalized.destination ?? null,
    });
  }

  // Hedef ayı tamamlama: eksik günlere OFF ekle.
  const dayHasEntry = new Set<number>();
  for (const r of out) {
    const y = Number(r.flight_date.slice(0, 4));
    const m = Number(r.flight_date.slice(5, 7));
    const d = Number(r.flight_date.slice(8, 10));
    if (y === monthInfo.year && m === monthInfo.month) dayHasEntry.add(d);
  }
  const monthLen = daysInMonth(monthInfo.year, monthInfo.month);
  for (let d = 1; d <= monthLen; d += 1) {
    if (dayHasEntry.has(d)) continue;
    out.push({
      flight_number: 'FOF',
      flight_date: toYmd(monthInfo.year, monthInfo.month, d),
      roster_entry_kind: 'duty_off',
      duty_occupation_code: 'FOF',
      duty_occupation_label_tr: 'Boş Gün',
      duty_occupation_label_en: 'Off day',
    });
  }

  out.sort((a, b) => a.flight_date.localeCompare(b.flight_date) || a.flight_number.localeCompare(b.flight_number));
  return out;
}

type LayoutWord = { text: string; x: number; top: number };

function groupWordsIntoRows(words: LayoutWord[], tolerance = 2.8): Array<{ top: number; words: LayoutWord[] }> {
  const rows: Array<{ top: number; words: LayoutWord[] }> = [];
  for (const w of [...words].sort((a, b) => (a.top === b.top ? a.x - b.x : a.top - b.top))) {
    const r = rows.find((row) => Math.abs(row.top - w.top) <= tolerance);
    if (r) {
      r.words.push(w);
      r.top = (r.top * (r.words.length - 1) + w.top) / r.words.length;
    } else {
      rows.push({ top: w.top, words: [w] });
    }
  }
  for (const r of rows) r.words.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => a.top - b.top);
}

function rowToText(row: { words: LayoutWord[] }): string {
  return row.words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
}

function extractUtcTimesFreebird(line: string): string[] {
  const scrub = line.replace(/\[[^\]]+\]/g, ' ');
  const out: string[] = [];
  for (const m of scrub.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    const v = `${String(m[1] ?? '').padStart(2, '0')}:${m[2] ?? ''}`;
    if (v === '05:06') continue;
    out.push(v);
  }
  return out;
}

function extractLocalTimesFreebird(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\[([01]?\d|2[0-3]):([0-5]\d)\]/g)) {
    out.push(`${String(m[1] ?? '').padStart(2, '0')}:${m[2] ?? ''}`);
  }
  return out;
}

function addMinutesToUtcHhmm(hhmm: string, deltaMin: number): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const base = Number(m[1]) * 60 + Number(m[2]);
  let v = (base + deltaMin) % (24 * 60);
  if (v < 0) v += 24 * 60;
  const h = String(Math.floor(v / 60)).padStart(2, '0');
  const mm = String(v % 60).padStart(2, '0');
  return `${h}:${mm}`;
}

function utcClockFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

function withUtcClock(dateIso: string, hhmm: string | null | undefined): string | null {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  return `${dateIso}T${hhmm}:00.000Z`;
}

function mergePreferLayoutRows(baseRows: PdfFlightRow[], layoutRows: PdfFlightRow[]): PdfFlightRow[] {
  const out = baseRows.map((r) => ({ ...r }));
  const key = (r: PdfFlightRow) =>
    `${r.flight_date}|${(r.flight_number || '').toUpperCase()}|${r.roster_entry_kind ?? 'flight'}`;
  const score = (r: PdfFlightRow) =>
    Number(!!r.dep_schedule_utc_iso) + Number(!!r.arr_schedule_utc_iso) + Number(!!r.duty_start_time_local) + Number(!!r.duty_end_time_local);
  const mergeRow = (a: PdfFlightRow, b: PdfFlightRow): PdfFlightRow => ({
    ...a,
    ...b,
    // Layout parser is more reliable for Freebird time columns; prefer layout values when present.
    origin_iata: b.origin_iata ?? a.origin_iata ?? null,
    destination_iata: b.destination_iata ?? a.destination_iata ?? null,
    dep_schedule_utc_iso: b.dep_schedule_utc_iso ?? a.dep_schedule_utc_iso ?? null,
    arr_schedule_utc_iso: b.arr_schedule_utc_iso ?? a.arr_schedule_utc_iso ?? null,
    dep_time_local: b.dep_time_local ?? a.dep_time_local ?? null,
    arr_time_local: b.arr_time_local ?? a.arr_time_local ?? null,
    duty_start_time_local: a.duty_start_time_local ?? b.duty_start_time_local ?? null,
    duty_end_time_local: a.duty_end_time_local ?? b.duty_end_time_local ?? null,
    duty_end_date_iso: a.duty_end_date_iso ?? b.duty_end_date_iso ?? null,
  });
  const byKey = new Map<string, number>();
  out.forEach((r, i) => byKey.set(key(r), i));
  for (const lr of layoutRows) {
    const k = key(lr);
    const idx = byKey.get(k);
    if (idx == null) {
      out.push({ ...lr });
      byKey.set(k, out.length - 1);
      continue;
    }
    const merged = mergeRow(out[idx]!, lr);
    out[idx] = score(merged) >= score(out[idx]!) ? merged : out[idx]!;
  }
  return out;
}

function normalizeFreebirdFlightTimes(rows: PdfFlightRow[]): PdfFlightRow[] {
  const out = rows.map((r) => ({ ...r }));
  type Template = { dep: string | null; arr: string | null; count: number };
  const tpl = new Map<string, Template>();
  const keyOf = (r: PdfFlightRow) =>
    `${String(r.flight_number ?? '').toUpperCase()}|${r.origin_iata ?? ''}|${r.destination_iata ?? ''}`;

  for (const r of out) {
    if (r.roster_entry_kind === 'duty_off' || r.roster_entry_kind === 'sim') continue;
    const dep = utcClockFromIso(r.dep_schedule_utc_iso);
    const arr = utcClockFromIso(r.arr_schedule_utc_iso);
    if (!dep && !arr) continue;
    const k = keyOf(r);
    const prev = tpl.get(k);
    if (!prev) tpl.set(k, { dep: dep ?? null, arr: arr ?? null, count: 1 });
    else tpl.set(k, { dep: prev.dep ?? dep ?? null, arr: prev.arr ?? arr ?? null, count: prev.count + 1 });
  }

  for (const r of out) {
    if (r.roster_entry_kind === 'duty_off' || r.roster_entry_kind === 'sim') continue;
    const k = keyOf(r);
    const t = tpl.get(k);
    let depClock = utcClockFromIso(r.dep_schedule_utc_iso);
    let arrClock = utcClockFromIso(r.arr_schedule_utc_iso);

    if (!depClock && r.dep_time_local) depClock = addMinutesToUtcHhmm(r.dep_time_local, -180);
    if (!arrClock && r.arr_time_local) arrClock = addMinutesToUtcHhmm(r.arr_time_local, -180);
    if (!depClock && t?.dep) depClock = t.dep;
    if (!arrClock && t?.arr) arrClock = t.arr;

    if (!r.dep_time_local && depClock) r.dep_time_local = addMinutesToUtcHhmm(depClock, 180);
    if (!r.arr_time_local && arrClock) r.arr_time_local = addMinutesToUtcHhmm(arrClock, 180);

    if (!r.dep_schedule_utc_iso && depClock) r.dep_schedule_utc_iso = withUtcClock(r.flight_date, depClock);
    if (!r.arr_schedule_utc_iso && arrClock) {
      const arrDate = depClock && arrClock && arrClock < depClock ? addDaysIso(r.flight_date, 1) : r.flight_date;
      r.arr_schedule_utc_iso = withUtcClock(arrDate, arrClock);
    }
  }
  const hhmmToMin = (hhmm: string | null | undefined): number | null => {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const routeKey = (r: PdfFlightRow) =>
    `${String(r.flight_number ?? '').toUpperCase()}|${String(r.origin_iata ?? '').toUpperCase()}|${String(r.destination_iata ?? '').toUpperCase()}`;
  const dropIdx = new Set<number>();
  for (let i = 0; i < out.length; i += 1) {
    const a = out[i]!;
    if (a.roster_entry_kind === 'duty_off' || a.roster_entry_kind === 'sim') continue;
    const aDep = utcClockFromIso(a.dep_schedule_utc_iso);
    const aArr = utcClockFromIso(a.arr_schedule_utc_iso);
    if (!aDep || !aArr) continue;
    for (let j = 0; j < out.length; j += 1) {
      if (i === j) continue;
      const b = out[j]!;
      if (b.roster_entry_kind === 'duty_off' || b.roster_entry_kind === 'sim') continue;
      if (routeKey(a) !== routeKey(b)) continue;
      if (b.flight_date !== addDaysIso(a.flight_date, 1)) continue;
      const bDep = utcClockFromIso(b.dep_schedule_utc_iso);
      const bArr = utcClockFromIso(b.arr_schedule_utc_iso);
      if (!bDep || !bArr) continue;
      // Layout continuation artifact:
      // day N row gets wrong late arrival, day N+1 row repeats same arrival with early dep.
      if (aArr !== bArr) continue;
      const aDepMin = hhmmToMin(aDep);
      const bDepMin = hhmmToMin(bDep);
      const bArrMin = hhmmToMin(bArr);
      if (aDepMin == null || bDepMin == null || bArrMin == null) continue;
      if (!(aDepMin > bDepMin && bDepMin < bArrMin)) continue;
      a.arr_schedule_utc_iso = withUtcClock(addDaysIso(a.flight_date, 1), bDep);
      a.arr_time_local = addMinutesToUtcHhmm(bDep, 180);
      dropIdx.add(j);
      break;
    }
  }
  return out.filter((_, idx) => !dropIdx.has(idx));
}

function mergeFreebirdDutyRows(baseRows: PdfFlightRow[], layoutRows: PdfFlightRow[]): PdfFlightRow[] {
  const flightRows = baseRows.filter((r) => r.roster_entry_kind !== 'duty_off' && r.roster_entry_kind !== 'sim');
  const baseDutyRows = baseRows.filter((r) => r.roster_entry_kind === 'duty_off');
  const layoutDutyRows = layoutRows.filter((r) => r.roster_entry_kind === 'duty_off');

  // Keep base duty rows authoritative; patch missing times from layout for same day+code.
  const dutyByKey = new Map<string, PdfFlightRow>();
  const key = (r: PdfFlightRow) => `${r.flight_date}|${String(r.flight_number ?? '').trim().toUpperCase()}`;
  for (const r of baseDutyRows) dutyByKey.set(key(r), { ...r });
  for (const r of layoutDutyRows) {
    const k = key(r);
    const prev = dutyByKey.get(k);
    if (!prev) continue;
    dutyByKey.set(k, {
      ...prev,
      duty_start_time_local: prev.duty_start_time_local ?? r.duty_start_time_local ?? null,
      duty_end_time_local: prev.duty_end_time_local ?? r.duty_end_time_local ?? null,
      duty_end_date_iso: prev.duty_end_date_iso ?? r.duty_end_date_iso ?? null,
    });
  }

  // Keep only STBY/STBC and explicit OFF/VAC/RQST style duty rows.
  const dutyFiltered = [...dutyByKey.values()].filter((r) => {
    const c = String(r.flight_number ?? '').trim().toUpperCase();
    if (c.startsWith('STB')) return true;
    if (c === 'VAC' || c === 'FREE' || c === 'RQST' || c === 'DOFF') return true;
    if (c === 'OFF') {
      // Avoid noisy OFF rows with no usable timing evidence.
      return !!(r.duty_start_time_local || r.duty_end_time_local);
    }
    return false;
  }).map((r) => {
    const c = String(r.flight_number ?? '').trim().toUpperCase();
    if (c !== 'FREE') return r;
    return {
      ...r,
      duty_start_time_local: '00:00',
      duty_end_time_local: '23:59',
      duty_end_date_iso: r.duty_end_date_iso ?? r.flight_date,
    };
  });

  // Deduplicate duty rows by date+code, prefer richer timing.
  const score = (r: PdfFlightRow) => Number(!!r.duty_start_time_local) + Number(!!r.duty_end_time_local);
  const dedupDuty = new Map<string, PdfFlightRow>();
  for (const r of dutyFiltered) {
    const k = `${r.flight_date}|${String(r.flight_number ?? '').trim().toUpperCase()}`;
    const prev = dedupDuty.get(k);
    if (!prev || score(r) > score(prev)) dedupDuty.set(k, r);
  }

  return [...flightRows, ...dedupDuty.values()];
}

async function parseFreebirdWithLayout(buf: Uint8Array): Promise<PdfFlightRow[] | null> {
  const doc = await getDocument({ data: buf, disableWorker: true }).promise;
  const out: PdfFlightRow[] = [];
  let currentDate: string | null = null;
  const dayHeaderRe = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\b/i;

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();
    const words: LayoutWord[] = (content.items as Array<{ str?: string; transform?: number[] }>)
      .map((it) => {
        const t = it.transform ?? [1, 0, 0, 1, 0, 0];
        return { text: String(it.str ?? '').trim(), x: Number(t[4] ?? 0), top: vp.height - Number(t[5] ?? 0) };
      })
      .filter((w) => w.text.length > 0);
    const rows = groupWordsIntoRows(words);

    for (const row of rows) {
      const line = rowToText(row);
      const day = dayHeaderRe.exec(line);
      if (day) {
        currentDate = `${day[4]}-${day[3]!.padStart(2, '0')}-${day[2]!.padStart(2, '0')}`;
        continue;
      }
      if (!currentDate) continue;

      const codes = [...line.matchAll(/\b(FH\d{2,4}|TK\d{2,4}|PC\d{2,4}|XQ\d{2,4}|DH)\b/gi)].map((m) =>
        (m[1] ?? '').toUpperCase(),
      );
      const routes = [...line.matchAll(/\b([A-Z]{3})-([A-Z]{3})\b/g)].map((m) => ({
        origin: (m[1] ?? '').toUpperCase(),
        destination: (m[2] ?? '').toUpperCase(),
      }));

      if (codes.length > 0) {
        const utc = extractUtcTimesFreebird(line);
        const local = extractLocalTimesFreebird(line);
        for (let i = 0; i < codes.length; i += 1) {
          let depUtc = utc[i * 2] ?? null;
          let arrUtc = utc[i * 2 + 1] ?? null;
          const depLocal = local[i * 2] ?? null;
          const arrLocal = local[i * 2 + 1] ?? null;
          // If UTC columns are partially missing but local times exist, infer UTC with TR offset (-3h).
          if (!depUtc && depLocal) depUtc = addMinutesToUtcHhmm(depLocal, -180);
          if (!arrUtc && arrLocal) arrUtc = addMinutesToUtcHhmm(arrLocal, -180);
          const arrDate = depUtc && arrUtc && arrUtc < depUtc ? addDaysIso(currentDate, 1) : currentDate;
          out.push({
            flight_number: codes[i]!,
            flight_date: currentDate,
            origin_iata: routes[i]?.origin ?? null,
            destination_iata: routes[i]?.destination ?? null,
            dep_time_local: depLocal,
            arr_time_local: arrLocal,
            dep_schedule_utc_iso: depUtc ? `${currentDate}T${depUtc}:00.000Z` : null,
            arr_schedule_utc_iso: arrUtc ? `${arrDate}T${arrUtc}:00.000Z` : null,
          });
        }
        continue;
      }

      const dutyM = /\b(VAC|FREE|DOFF|STB[A-Z0-9]{1,3}|OFF)\b/i.exec(line);
      if (dutyM) {
        const code = (dutyM[1] ?? '').toUpperCase();
        const local = extractLocalTimesFreebird(line);
        const utc = extractUtcTimesFreebird(line);
        const dutyStart = local[0] ?? null;
        const dutyEnd = local[1] ?? null;
        const dutyEndDate = dutyStart && dutyEnd && dutyEnd < dutyStart ? addDaysIso(currentDate, 1) : currentDate;
        const normCode = code;
        let startLocal = dutyStart;
        let endLocal = dutyEnd;
        if (normCode.startsWith('STB')) {
          const localNonMid = local.filter((x) => x !== '00:00' && x !== '23:59');
          if (localNonMid.length >= 2) {
            startLocal = localNonMid[0] ?? startLocal;
            endLocal = localNonMid[localNonMid.length - 1] ?? endLocal;
          }
          if (!startLocal) startLocal = addMinutesToUtcHhmm(utc[0] ?? null, 180);
          if (!endLocal) endLocal = addMinutesToUtcHhmm(utc[1] ?? null, 180);
        }
        if (['FREE', 'OFF', 'VAC', 'RQST', 'DOFF'].includes(normCode)) {
          if (!startLocal && endLocal === '23:59') startLocal = '00:00';
          if (!endLocal && startLocal === '00:00') endLocal = '23:59';
          if (!startLocal) startLocal = addMinutesToUtcHhmm(utc[0] ?? null, 180);
          if (!endLocal) endLocal = addMinutesToUtcHhmm(utc[1] ?? null, 180);
        }
        if (normCode === 'FREE' && !startLocal && !endLocal) {
          startLocal = '00:00';
          endLocal = '23:59';
        }
        const endDate = startLocal && endLocal && endLocal < startLocal ? addDaysIso(currentDate, 1) : dutyEndDate;

        const pushDuty = (dateIso: string, dutyCode: string, s: string | null, e: string | null, eDate: string) =>
          out.push({
            flight_number: dutyCode,
            flight_date: dateIso,
            roster_entry_kind: 'duty_off',
            duty_occupation_code: dutyCode,
            duty_occupation_label_tr: 'Boş Gün',
            duty_occupation_label_en: 'Off day',
            duty_start_time_local: s,
            duty_end_time_local: e,
            duty_end_date_iso: eDate,
          });

        if (normCode === 'DOFF') {
          pushDuty(currentDate, 'OFF', startLocal, endLocal, endDate);
          const next = addDaysIso(currentDate, 1);
          pushDuty(next, 'OFF', '00:00', '23:59', next);
        } else {
          pushDuty(currentDate, normCode, startLocal, endLocal, endDate);
        }
      }
    }
  }

  if (out.length === 0) return null;
  const mergeRow = (a: PdfFlightRow, b: PdfFlightRow): PdfFlightRow => ({
    ...a,
    ...b,
    origin_iata: a.origin_iata ?? b.origin_iata ?? null,
    destination_iata: a.destination_iata ?? b.destination_iata ?? null,
    dep_schedule_utc_iso: a.dep_schedule_utc_iso ?? b.dep_schedule_utc_iso ?? null,
    arr_schedule_utc_iso: a.arr_schedule_utc_iso ?? b.arr_schedule_utc_iso ?? null,
    dep_time_local: a.dep_time_local ?? b.dep_time_local ?? null,
    arr_time_local: a.arr_time_local ?? b.arr_time_local ?? null,
    duty_start_time_local: a.duty_start_time_local ?? b.duty_start_time_local ?? null,
    duty_end_time_local: a.duty_end_time_local ?? b.duty_end_time_local ?? null,
    duty_end_date_iso: a.duty_end_date_iso ?? b.duty_end_date_iso ?? null,
  });
  const dedupe = new Map<string, PdfFlightRow>();
  for (const r of out) {
    const k = `${r.flight_date}|${r.flight_number}|${r.roster_entry_kind ?? 'flight'}`;
    const prev = dedupe.get(k);
    if (!prev) dedupe.set(k, r);
    else dedupe.set(k, mergeRow(prev, r));
  }
  return [...dedupe.values()];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json().catch(() => null)) as { pdf_base64?: string } | null;
    const b64 = body?.pdf_base64;
    if (!b64 || typeof b64 !== 'string') {
      return new Response(JSON.stringify({ error: 'pdf_base64 string required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const buf = base64ToBuffer(b64);
    if (buf.length < 10) {
      return new Response(JSON.stringify({ error: 'PDF too small or invalid base64' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const parsed = await pdfParse(buf);
    const text = String((parsed as { text?: string }).text ?? '').replace(/\r\n/g, '\n');
    let flights = parseFlightsFromPdfText(text);
    let parserDebugSource = 'default';
    let parserDebugError: string | null = null;
    const isIndigoCrewPdf = looksLikeIndigoCrewSchedulePdf(text);
    if (isIndigoCrewPdf) {
      parserDebugSource = 'indigo_text_only';
    } else if (looksLikeSunExpressSchedulePdf(text)) {
      try {
        const layoutFlights = await parseSunExpressWithLayout(new Uint8Array(buf), text);
        if (layoutFlights && layoutFlights.length > 0) {
          flights = layoutFlights;
          parserDebugSource = 'sunexpress_layout';
        } else {
          parserDebugSource = 'sunexpress_fallback_no_layout_rows';
        }
      } catch (e) {
        console.warn('[parse-roster-pdf] sunexpress layout parse fallback to text parser:', e);
        parserDebugSource = 'sunexpress_fallback_exception';
        parserDebugError = e instanceof Error ? e.message : String(e);
      }
    } else if (looksLikeFreebirdRosterPdf(text)) {
      try {
        const layoutRows = await parseFreebirdWithLayout(new Uint8Array(buf));
        if (layoutRows && layoutRows.length > 0) {
          const merged = mergePreferLayoutRows(flights, layoutRows);
          flights = normalizeFreebirdFlightTimes(mergeFreebirdDutyRows(merged, layoutRows));
          parserDebugSource = 'freebird_layout_merge';
        } else {
          parserDebugSource = 'freebird_fallback_no_layout_rows';
        }
      } catch (e) {
        console.warn('[parse-roster-pdf] freebird layout parse fallback to text parser:', e);
        parserDebugSource = 'freebird_fallback_exception';
        parserDebugError = e instanceof Error ? e.message : String(e);
      }
    }

    return new Response(
      JSON.stringify({ text, flights, parser_debug_source: parserDebugSource, parser_debug_error: parserDebugError }),
      {
      headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[parse-roster-pdf]', e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
