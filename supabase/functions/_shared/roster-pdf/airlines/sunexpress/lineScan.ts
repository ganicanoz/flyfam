/**
 * SunExpress roster (schedule PDF) parser — MVP.
 *
 * Hedef:
 * - XQ uçuşları + DH bacakları
 * - OFF günleri (duty_off)
 * - Transit/Hotel/MEDGR vb. satırları atla
 *
 * Not: PDF metni satır kırılımı bozuk olabildiği için bazı bacaklar atlanabilir.
 * pdf-parse hücreyi sık sık `~ STA DEST ORIG STD CODE` sırasıyla verir.
 */

import type { PdfFlightRow } from '../../types.ts';
import { rosterOccupationLabelEn, rosterOccupationLabelTr } from '../../occupationLabels.ts';

type DayBlock = {
  off: boolean;
  dutyCode: string | null;
  report: string | null;
  release: string | null;
  flights: Array<{
    code: string;
    origin: string | null;
    destination: string | null;
    dep: string | null;
    arr: string | null;
  }>;
};

type OrphanLeg = {
  code: string;
  origin: string;
  destination: string;
  dep: string;
  arr: string;
};

function parseMonthName(mon: string): number | null {
  const m = mon.trim().toLowerCase();
  const map: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  return map[m] ?? null;
}

function toYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(ymd: string, days: number): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function padHhmm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

function hhmmToMin(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function overnightSpanMin(dep: string, arr: string): number {
  const d = hhmmToMin(dep);
  const a = hhmmToMin(arr);
  if (d == null || a == null) return 9999;
  return a < d ? a + 24 * 60 - d : a - d;
}

function detectStartDate(text: string): string {
  const compact = text.replace(/\s+/g, ' ');
  const mm = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i.exec(compact);
  const m = mm ? parseMonthName(mm[1] ?? '') : null;
  const y = mm ? Number(mm[2]) : null;
  // Takvim görünümü Pazar başlangıçlı; ayın 1'inin denk geldiği haftanın Pazar'ına geri sar.
  if (m && y) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const weekday = first.getUTCDay(); // 0=Sun
    const gridStart = new Date(first);
    gridStart.setUTCDate(first.getUTCDate() - weekday);
    return toYmd(gridStart.getUTCFullYear(), gridStart.getUTCMonth() + 1, gridStart.getUTCDate());
  }
  // Normal görünüm: "29 30 Mar. 31 1 2 3 4"
  const cal = /(\d{1,2})\s+(\d{1,2})\s+[A-Za-z]{3}\./.exec(compact);
  // Sıkışık görünüm: "2930Mar. 311234"
  const calCompact = /(\d{1,2})(\d{1,2})\s*[A-Za-z]{3}\./.exec(compact);
  if (m && y && cal) {
    const firstPrev = Number(cal[1] ?? '1');
    const prevMonthStart = new Date(Date.UTC(y, m - 2, 1));
    const prevMonth = prevMonthStart.getUTCMonth() + 1;
    return toYmd(prevMonthStart.getUTCFullYear(), prevMonth, firstPrev);
  }
  if (m && y && calCompact) {
    const firstPrev = Number(calCompact[1] ?? '1');
    const prevMonthStart = new Date(Date.UTC(y, m - 2, 1));
    const prevMonth = prevMonthStart.getUTCMonth() + 1;
    return toYmd(prevMonthStart.getUTCFullYear(), prevMonth, firstPrev);
  }
  return new Date().toISOString().slice(0, 10);
}

function detectRosterMonthYear(text: string): { year: number; month: number } | null {
  const compact = text.replace(/\s+/g, ' ');
  const mm = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i.exec(compact);
  if (!mm) return null;
  const month = parseMonthName(mm[1] ?? '');
  const year = Number(mm[2] ?? '');
  if (!month || !Number.isFinite(year)) return null;
  return { year, month };
}

function detectGridSpanDays(text: string): number {
  const compact = text.replace(/\s+/g, ' ');
  if (/\bMay\.\s*1\s*2\b/i.test(compact) || /\b2627282930May\.\s*12\b/i.test(compact)) return 35;
  return 42;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isFlightCode(code: string | null | undefined): boolean {
  return /^(XQ\d{2,4}|DH)$/i.test((code || '').trim());
}

/** Kaydırmayı yalnız uçuş bacaklarına göre yap — AVAC/OFF zinciri Eylül’ü “doldurup” uçuşları Ağustos’a itmesin. */
function scoreShift(
  rows: PdfFlightRow[],
  shift: number,
  targetYear: number,
  targetMonth: number
): number {
  const daySet = new Set<number>();
  let inMonthRows = 0;
  for (const r of rows) {
    if (!isFlightCode(r.flight_number)) continue;
    const shifted = addDays(r.flight_date, shift);
    const y = Number(shifted.slice(0, 4));
    const m = Number(shifted.slice(5, 7));
    const d = Number(shifted.slice(8, 10));
    if (y === targetYear && m === targetMonth) {
      inMonthRows += 1;
      daySet.add(d);
    }
  }
  if (daySet.size === 0) return -1e9;
  const monthLen = daysInMonth(targetYear, targetMonth);
  const minDay = Math.min(...daySet);
  const maxDay = Math.max(...daySet);
  const edgePenalty = Math.abs(minDay - 1) + Math.abs(monthLen - maxDay);
  return daySet.size * 10 + inMonthRows * 5 - edgePenalty * 2;
}

function joinWrappedFlightLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (
      /^~\s*\d{1,2}:\d{2}\s*[A-Z]{3}\s*$/.test(cur) &&
      /^[A-Z]{3}\s*\d{1,2}:\d{2}\s*(XQ\d{2,4}|DH)\b/.test(next)
    ) {
      out.push(`${cur} ${next}`);
      i += 1;
      continue;
    }
    out.push(cur);
  }
  return out;
}

/**
 * pdf-parse SunExpress hücresini görsel sıranın tersinde verir:
 * "~ STA DEST ORIG STD XQ..." — IATA bitişik veya ayrık olabilir.
 */
function parseFlightLine(line: string): DayBlock['flights'][number] | null {
  const clean = line.replace(/\s+/g, ' ').trim();
  const glued = /^~\s*(\d{1,2}:\d{2})\s*([A-Z]{6})\s*(\d{1,2}:\d{2})\s*(XQ\d{2,4}|DH)\b/.exec(clean);
  if (glued) {
    const route = (glued[2] ?? '').toUpperCase();
    return {
      arr: padHhmm(glued[1]),
      destination: route.slice(0, 3),
      origin: route.slice(3, 6),
      dep: padHhmm(glued[3]),
      code: (glued[4] ?? '').toUpperCase(),
    };
  }
  const r = /^~\s*(\d{1,2}:\d{2})\s*([A-Z]{3})\s*([A-Z]{3})\s*(\d{1,2}:\d{2})\s*(XQ\d{2,4}|DH)\b/.exec(clean);
  if (!r) return null;
  return {
    arr: padHhmm(r[1]),
    destination: (r[2] ?? '').toUpperCase(),
    origin: (r[3] ?? '').toUpperCase(),
    dep: padHhmm(r[4]),
    code: (r[5] ?? '').toUpperCase(),
  };
}

function parseNonFlightDutyCode(line: string): string | null {
  const u = line.replace(/\s+/g, '').toUpperCase();
  if (/^(OFFB?|AVAC|RSV\d*|TOF|COMP-DR)$/.test(u)) return u;
  if (/^SB[A-Z0-9]*$/.test(u)) return u;
  return null;
}

function clockBefore(label: 'Report' | 'Release', line: string): string | null {
  const m = new RegExp(`(\\d{1,2}:\\d{2})\\s*${label}`, 'i').exec(line);
  return padHhmm(m?.[1] ?? null);
}

function utcPair(
  day: string,
  dep: string | null | undefined,
  arr: string | null | undefined
): { depIso: string | null; arrIso: string | null } {
  const d = padHhmm(dep);
  const a = padHhmm(arr);
  const depIso = d ? `${day}T${d}:00.000Z` : null;
  const overnight = !!(d && a && a < d);
  const arrIso = a ? `${addDays(day, overnight ? 1 : 0)}T${a}:00.000Z` : null;
  return { depIso, arrIso };
}

/**
 * Release satırından hemen sonra yalnız kod olarak kalan dönüş bacakları
 * (XQ119 / XQ613 / XQ232) + alt metin katmanındaki rota parçaları.
 */
function extractOrphanLegs(text: string): OrphanLeg[] {
  const orphanCodes: Array<{ code: string; arrHint: string | null }> = [];
  const lines = text.replace(/\r/g, '\n').split('\n').map((x) => x.trim());

  for (let i = 0; i < lines.length; i += 1) {
    const release = clockBefore('Release', lines[i] ?? '');
    if (release) {
      for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j += 1) {
        const code = /^(XQ\d{2,4}|DH)$/i.exec(lines[j] ?? '');
        if (!code) {
          if (parseFlightLine(lines[j] ?? '') || /Report|Release|OFF|Hotel|Transit/i.test(lines[j] ?? '')) break;
          continue;
        }
        orphanCodes.push({ code: code[1]!.toUpperCase(), arrHint: release });
        break;
      }
      continue;
    }
    // XQ232 gibi: kod(lar) + ReportOFF / Report (Release yok)
    const alone = /^(XQ\d{2,4}|DH)$/i.exec(lines[i] ?? '');
    if (!alone) continue;
    const code = alone[1]!.toUpperCase();
    let reportAt: string | null = null;
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j += 1) {
      const n = lines[j] ?? '';
      if (/^(XQ\d{2,4}|DH)$/i.test(n) && n.toUpperCase() === code) continue;
      reportAt = clockBefore('Report', n);
      if (reportAt || /Report/i.test(n)) break;
      if (parseFlightLine(n) || /Release|OFF|Hotel|Transit/i.test(n)) break;
    }
    if (reportAt || (i + 1 < lines.length && /Report/i.test(lines[i + 1] ?? ''))) {
      orphanCodes.push({ code, arrHint: null });
    }
  }

  const depPieces: Array<{ origin: string; destination: string; dep: string }> = [];
  const arrPieces: Array<{ origin: string; destination: string; arr: string }> = [];
  for (const line of lines) {
    const dep = /^\s*([A-Z]{3})\s+(\d{1,2}:\d{2})\s*~\s*([A-Z]{3})\s*$/i.exec(line);
    if (dep) {
      depPieces.push({
        origin: dep[1]!.toUpperCase(),
        destination: dep[3]!.toUpperCase(),
        dep: padHhmm(dep[2])!,
      });
    }
    const arr = /^\s*([A-Z]{3})\s*~\s*(\d{1,2}:\d{2})\s*([A-Z]{3})\s*$/i.exec(line);
    if (arr) {
      arrPieces.push({
        origin: arr[1]!.toUpperCase(),
        destination: arr[3]!.toUpperCase(),
        arr: padHhmm(arr[2])!,
      });
    }
  }

  const usedArr = new Set<string>();
  const usedDep = new Set<string>();
  const out: OrphanLeg[] = [];

  for (const orphan of orphanCodes) {
    if (out.some((x) => x.code === orphan.code)) continue;
    let arrHit =
      (orphan.arrHint
        ? arrPieces.find((p) => p.arr === orphan.arrHint && !usedArr.has(`${p.origin}|${p.destination}|${p.arr}`))
        : null) ?? null;
    if (!arrHit && orphan.arrHint) {
      // Release = STA; rota satırı bazen aynı saati vermez — yine de hint’i STA kabul et.
      arrHit = null;
    }
    let depHit: (typeof depPieces)[number] | null = null;
    if (arrHit) {
      const candidates = depPieces.filter(
        (p) =>
          p.origin === arrHit!.origin &&
          p.destination === arrHit!.destination &&
          !usedDep.has(`${p.origin}|${p.destination}|${p.dep}`)
      );
      // Overnight: STD akşam / STA sabah → en kısa makul span’i seç (yanlış dep eşleşmesin).
      const overnight = candidates
        .filter((p) => overnightSpanMin(p.dep, arrHit!.arr) < 12 * 60)
        .sort((a, b) => overnightSpanMin(a.dep, arrHit!.arr) - overnightSpanMin(b.dep, arrHit!.arr));
      depHit = overnight[0] ?? candidates[0] ?? null;
    }
    if (!arrHit || !depHit) {
      // Report-öncesi orphan: henüz eşleşmemiş tam rota çifti (aynı orig/dest).
      for (const a of arrPieces) {
        const aKey = `${a.origin}|${a.destination}|${a.arr}`;
        if (usedArr.has(aKey)) continue;
        const d = depPieces.find(
          (p) =>
            p.origin === a.origin &&
            p.destination === a.destination &&
            !usedDep.has(`${p.origin}|${p.destination}|${p.dep}`)
        );
        if (!d) continue;
        // Tercih: overnight (dep > arr) veya arrHint eşleşmesi
        if (orphan.arrHint && a.arr !== orphan.arrHint) continue;
        arrHit = a;
        depHit = d;
        break;
      }
    }
    if (!arrHit || !depHit) continue;
    usedArr.add(`${arrHit.origin}|${arrHit.destination}|${arrHit.arr}`);
    usedDep.add(`${depHit.origin}|${depHit.destination}|${depHit.dep}`);
    out.push({
      code: orphan.code,
      origin: depHit.origin,
      destination: depHit.destination,
      dep: depHit.dep,
      arr: arrHit.arr,
    });
  }

  return out;
}

function mergeOrphanLegs(rows: PdfFlightRow[], orphans: OrphanLeg[]): PdfFlightRow[] {
  if (orphans.length === 0) return rows;
  const existing = new Set(rows.filter((r) => isFlightCode(r.flight_number)).map((r) => r.flight_number.toUpperCase()));
  const out = [...rows];

  for (const leg of orphans) {
    if (existing.has(leg.code)) continue;
    // Aynı Release / aynı duty günü: mevcut uçuşta release == orphan.arr
    let date =
      out.find(
        (r) =>
          isFlightCode(r.flight_number) &&
          padHhmm(r.duty_end_time_local) === leg.arr
      )?.flight_date ?? null;
    let partnerDep: string | null = null;
    const releasePartner = out.find(
      (r) => isFlightCode(r.flight_number) && padHhmm(r.duty_end_time_local) === leg.arr
    );
    if (releasePartner) partnerDep = releasePartner.dep_time_local ?? null;

    if (!date) {
      // Çift numarası: XQ118 ↔ XQ119 gibi ±1
      const num = Number(/^XQ(\d{2,4})$/i.exec(leg.code)?.[1] ?? '');
      if (Number.isFinite(num) && num > 0) {
        const partner = out.find((r) => {
          const m = /^XQ(\d{2,4})$/i.exec(r.flight_number || '');
          if (!m) return false;
          const n = Number(m[1]);
          return n === num - 1 || n === num + 1;
        });
        date = partner?.flight_date ?? null;
        partnerDep = partner?.dep_time_local ?? partnerDep;
      }
    }

    // Gidiş akşam / dönüş sabah: orphan overnight + partner sabah → bir gün önce.
    if (
      date &&
      partnerDep &&
      overnightSpanMin(leg.dep, leg.arr) < 12 * 60 &&
      (hhmmToMin(partnerDep) ?? 99) < 6 * 60 &&
      (hhmmToMin(leg.dep) ?? 0) >= 12 * 60
    ) {
      date = addDays(date, -1);
    }
    if (!date) continue;
    const { depIso, arrIso } = utcPair(date, leg.dep, leg.arr);
    const sample = out.find((r) => r.flight_date === date && isFlightCode(r.flight_number));
    out.push({
      flight_number: leg.code,
      flight_date: date,
      dep_time_local: leg.dep,
      arr_time_local: leg.arr,
      origin_iata: leg.origin,
      destination_iata: leg.destination,
      duty_start_time_local: sample?.duty_start_time_local ?? null,
      duty_end_time_local: sample?.duty_end_time_local ?? leg.arr,
      duty_clock_basis: 'utc',
      dep_schedule_utc_iso: depIso,
      arr_schedule_utc_iso: arrIso,
    });
    existing.add(leg.code);
  }
  return out;
}

export function parseFlightsFromPdfText_SunExpress(text: string): PdfFlightRow[] {
  const startDate = detectStartDate(text);
  const monthInfo = detectRosterMonthYear(text);
  const gridDays = detectGridSpanDays(text);
  const rawLines = text
    // TOFOFF tek hücre: ayrı TOF + OFF iki gün üretmesin
    .replace(/TOFOFF/gi, 'TOF')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  const lines = joinWrappedFlightLines(rawLines);

  const blocks: DayBlock[] = Array.from({ length: gridDays }, () => ({
    off: false,
    dutyCode: null,
    report: null,
    release: null,
    flights: [],
  }));
  let dayIdx = -1;
  let current: DayBlock | null = null;
  let skipNextPureOff = false;
  let pendingRelease: string | null = null;

  const startNewDay = (): DayBlock | null => {
    if (dayIdx + 1 >= blocks.length) return null;
    dayIdx += 1;
    const b = blocks[dayIdx] ?? null;
    if (b && pendingRelease) {
      b.release = pendingRelease;
      pendingRelease = null;
    }
    return b;
  };

  const dayHasContent = (b: DayBlock | null): boolean =>
    !!b && (b.flights.length > 0 || !!b.dutyCode || b.off || !!b.report || !!b.release);

  for (const line of lines) {
    // Birleşik ReportOFF: tek OFF günü (ekstra gün açma)
    if (/ReportOFF/i.test(line) || (/Report/i.test(line) && /OFF/i.test(line) && !/Release/i.test(line) && !parseFlightLine(line))) {
      if (/ReportOFF/i.test(line) || /^[\d:]+\s*Report\s*OFF$/i.test(line.replace(/\s+/g, ' ').trim())) {
        current = startNewDay();
        if (!current) break;
        current.off = true;
        current.report = clockBefore('Report', line);
        current = null;
        skipNextPureOff = true;
        continue;
      }
    }

    if (/^OFF$/i.test(line)) {
      if (skipNextPureOff) {
        skipNextPureOff = false;
        continue;
      }
      current = startNewDay();
      if (!current) break;
      current.off = true;
      current = null;
      continue;
    }
    if (/^MEDGR$/i.test(line)) {
      current = startNewDay();
      if (!current) break;
      current = null;
      continue;
    }
    const dutyCode = parseNonFlightDutyCode(line);
    if (dutyCode) {
      // OFFB / AVAC / SB… her biri kendi takvim günü
      current = startNewDay();
      if (!current) break;
      current.dutyCode = dutyCode;
      if (/^OFFB?$/i.test(dutyCode)) current.off = true;
      current = null;
      continue;
    }

    const releaseClock = /Release/i.test(line) ? clockBefore('Release', line) : null;
    if (releaseClock || (/Release/i.test(line) && !/Report/i.test(line))) {
      // Release yeni gün açmaz; mevcut güne veya bir sonraki güne yazılır.
      if (current) current.release = releaseClock ?? current.release;
      else pendingRelease = releaseClock ?? pendingRelease;
      continue;
    }

    if (/Report/i.test(line)) {
      skipNextPureOff = false;
      const reportClock = clockBefore('Report', line);
      // Ters hücre sırası: Release → uçuşlar → Report → Report mevcut günü kapatır (yeni gün açmaz).
      if (dayHasContent(current) && current && current.flights.length > 0) {
        current.report = reportClock ?? current.report;
        current = null;
        continue;
      }
      current = startNewDay();
      if (!current) break;
      current.report = reportClock;
      continue;
    }

    skipNextPureOff = false;
    const f = parseFlightLine(line);
    if (f) {
      if (!current) {
        current = startNewDay();
        if (!current) break;
      }
      current.flights.push(f);
      continue;
    }
  }

  let out: PdfFlightRow[] = [];
  for (let idx = 0; idx < blocks.length; idx += 1) {
    const day = addDays(startDate, idx);
    const b = blocks[idx]!;
    if ((b.off || b.dutyCode) && b.flights.length === 0) {
      const code = b.dutyCode || 'FOF';
      out.push({
        flight_number: code,
        flight_date: day,
        roster_entry_kind: 'duty_off',
        duty_occupation_code: code,
        duty_occupation_label_tr: rosterOccupationLabelTr(code) ?? 'Boş Gün',
        duty_occupation_label_en: rosterOccupationLabelEn(code) ?? 'Off day',
        duty_start_time_local: b.report,
        duty_end_time_local: b.release,
        duty_clock_basis: 'utc',
      });
      continue;
    }
    for (const f of b.flights) {
      const { depIso, arrIso } = utcPair(day, f.dep, f.arr);
      out.push({
        flight_number: f.code,
        flight_date: day,
        dep_time_local: f.dep,
        arr_time_local: f.arr,
        origin_iata: f.origin,
        destination_iata: f.destination,
        duty_start_time_local: b.report,
        duty_end_time_local: b.release,
        duty_clock_basis: 'utc',
        dep_schedule_utc_iso: depIso,
        arr_schedule_utc_iso: arrIso,
      });
    }
  }

  // Ay başlığına göre otomatik kaydırma (yalnız XQ/DH skorlanır).
  if (monthInfo && out.length > 0) {
    let bestShift = 0;
    let bestScore = -1e9;
    for (let shift = -20; shift <= 20; shift += 1) {
      const s = scoreShift(out, shift, monthInfo.year, monthInfo.month);
      if (s > bestScore) {
        bestScore = s;
        bestShift = shift;
      }
    }
    if (bestShift !== 0) {
      for (const r of out) r.flight_date = addDays(r.flight_date, bestShift);
    }

    for (const r of out) {
      if (!isFlightCode(r.flight_number)) continue;
      const { depIso, arrIso } = utcPair(r.flight_date, r.dep_time_local, r.arr_time_local);
      r.dep_schedule_utc_iso = depIso;
      r.arr_schedule_utc_iso = arrIso;
    }
  }

  out = mergeOrphanLegs(out, extractOrphanLegs(text));

  if (monthInfo && out.length > 0) {
    // Hedef ayda satırı olmayan günleri OFF ile doldur.
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
  }

  return out;
}
