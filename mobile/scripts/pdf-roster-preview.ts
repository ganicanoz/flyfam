/**
 * PDF → uygulamanın kullandığı parser ile uçuş listesi (önizleme).
 *
 * Kurulum (bir kez, mobile klasöründe):
 *   npm i -D pdf-parse tsx
 *
 * Çalıştır:
 *   npx tsx scripts/pdf-roster-preview.ts ./path/to/roster.pdf
 *   npx tsx scripts/pdf-roster-preview.ts ./roster.pdf --text   # ham metin özeti
 *
 * Not: Metin `pdf-parse` ile çıkar; `expo-pdf-text-extract` farklı satır kırılımı verebilir.
 */

import fs from 'node:fs';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import {
  parseFlightsFromPdfText,
  parseFlightsFromPdfText_Pegasus,
  parseFlightsFromPdfText_THY,
  parseFlightsFromPdfText_DutyLocalTable,
  parseFlightsFromPdfText_DutyLocalTableCore,
  parseFlightsFromPdfText_DutySingleLineSameRow,
  rowToScheduleIso,
  type PdfFlightRow,
} from '../lib/pdfRosterImport';
import { getLocalDateStringPlusDays } from '../lib/dateUtils';
import {
  rosterListRowVisible,
  normalizeRosterListShow,
  type RosterListShowPrefs,
} from '../lib/rosterListPreferences';

/** Roster ekranı ile aynı: `flight_date >= dün` (yerel). */
const ROSTER_MIN_DAYS_AGO = 1;

/** Uçuş fazı (minval): X = planlı kalkış, Y = planlı iniş (last_seen = Y), saatler Europe/Istanbul (+03). */
const FLIGHT_PHASE_30M_MS = 30 * 60 * 1000;
const FLIGHT_PHASE_12H_MS = 12 * 60 * 60 * 1000;

type FlightPhase = 'Pasif (ileri)' | 'Yarı aktif' | 'Aktif' | 'Pasif (geçmiş)';

function istanbulWallClockToUtcMs(dateIso: string, hhmm: string | null | undefined): number | null {
  if (!dateIso || !hhmm) return null;
  const t = hhmm.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const d = new Date(`${dateIso}T${t}:00+03:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

/** Sim / Boş Gün vb. hariç; planlı dep+arr saati olan roster uçuş segmenti. */
function isRosterFlightLeg(r: PdfFlightRow): boolean {
  if (r.roster_entry_kind === 'sim' || r.roster_entry_kind === 'duty_off') return false;
  const d = r.dep_time_local?.trim();
  const a = r.arr_time_local?.trim();
  return !!(d && a && /^\d{2}:\d{2}$/.test(d) && /^\d{2}:\d{2}$/.test(a));
}

/**
 * Sıra: önce iniş geçti mi, sonra aktif penceresi, sonra yarı aktif, kalan uzak gelecek.
 * 1) now > Y → Pasif (geçmiş)   2) now+30dk > X → Aktif   3) now+12h > X → Yarı aktif   4) → Pasif (ileri)
 */
function computeFlightPhase(r: PdfFlightRow, effectiveDepDate: string, nowMs: number): FlightPhase | null {
  if (!isRosterFlightLeg(r)) return null;
  const depMs = istanbulWallClockToUtcMs(effectiveDepDate, r.dep_time_local);
  const arrDate = effectiveArrDateIso(effectiveDepDate, r);
  const arrMs = istanbulWallClockToUtcMs(arrDate, r.arr_time_local);
  if (depMs == null || arrMs == null) return null;
  if (nowMs > arrMs) return 'Pasif (geçmiş)';
  if (nowMs + FLIGHT_PHASE_30M_MS > depMs) return 'Aktif';
  if (nowMs + FLIGHT_PHASE_12H_MS > depMs) return 'Yarı aktif';
  return 'Pasif (ileri)';
}

function flightPhaseLabel(r: PdfFlightRow, effectiveDepDate: string, nowMs: number): string {
  return computeFlightPhase(r, effectiveDepDate, nowMs) ?? '—';
}

function listedInApp(
  raw: PdfFlightRow,
  effectiveDate: string,
  minListDate: string,
  prefs: RosterListShowPrefs
): 'Evet' | 'Hayır' {
  if (effectiveDate < minListDate) return 'Hayır';
  if (
    !rosterListRowVisible(
      { roster_entry_kind: raw.roster_entry_kind, flight_number: raw.flight_number || '' },
      prefs
    )
  ) {
    return 'Hayır';
  }
  return 'Evet';
}

/** Önizleme: EXPO_PUBLIC_SUPABASE_* varsa `airports.timezone_iana` ile uçuş UTC (yoksa Istanbul yedek). */
async function loadTzMapForRows(rows: PdfFlightRow[]): Promise<Map<string, string>> {
  const iatas = new Set<string>();
  for (const r of rows) {
    if (r.roster_entry_kind === 'sim' || r.roster_entry_kind === 'duty_off') continue;
    if (r.origin_iata) iatas.add(r.origin_iata.replace(/\s/g, '').toUpperCase().slice(0, 3));
    if (r.destination_iata) iatas.add(r.destination_iata.replace(/\s/g, '').toUpperCase().slice(0, 3));
  }
  const out = new Map<string, string>();
  if (iatas.size === 0) return out;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return out;
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);
  const list = [...iatas];
  const { data, error } = await supabase.from('airports').select('iata,timezone_iana').in('iata', list);
  if (error || !data) return out;
  for (const row of data as { iata: string | null; timezone_iana: string | null }[]) {
    const i = row.iata?.trim().toUpperCase();
    const tz = row.timezone_iana?.trim();
    if (i && tz) out.set(i, tz);
  }
  return out;
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, ' ');
}

function dutyTimesSummary(r: PdfFlightRow): string {
  if (r.roster_entry_kind === 'duty_off') {
    const g = r.duty_start_time_local ?? '—';
    const e = r.duty_end_time_local ?? '—';
    const r0 = r.duty_rest_end_time_local ?? '—';
    return `FSF/FOF b${g} e${e} din${r0}`.slice(0, 36);
  }
  if (r.roster_entry_kind === 'sim') {
    const g = r.duty_start_time_local ?? '—';
    const s = r.duty_slash_start_time_local ?? '—';
    const e = r.duty_end_time_local ?? '—';
    return `baş ${g} | tablo ${s}→${e}`.slice(0, 36);
  }
  const bits: string[] = [];
  if (r.duty_start_time_local) bits.push(`b${r.duty_start_time_local}`);
  if (r.duty_end_time_local) bits.push(`görevB ${r.duty_end_time_local}`);
  if (r.duty_rest_end_time_local) bits.push(`dinlen ${r.duty_rest_end_time_local}`);
  return bits.length ? bits.join(' ').slice(0, 36) : '—';
}

function formatRow(r: PdfFlightRow, i: number, tzMap: Map<string, string>) {
  const oi = r.origin_iata?.replace(/\s/g, '').toUpperCase().slice(0, 3) ?? '';
  const di = r.destination_iata?.replace(/\s/g, '').toUpperCase().slice(0, 3) ?? '';
  const { depIso, arrIso } = rowToScheduleIso(r, {
    originTz: oi.length === 3 ? tzMap.get(oi) ?? null : null,
    destTz: di.length === 3 ? tzMap.get(di) ?? null : null,
  });
  const depL = r.dep_time_local ?? '—';
  const arrL = r.arr_time_local ?? '—';
  const route =
    r.origin_iata && r.destination_iata ? `${r.origin_iata}-${r.destination_iata}` : '—';
  const occ = r.duty_occupation_code
    ? `${r.duty_occupation_code}`.padEnd(9)
    : '—'.padEnd(9);
  const dutyT = dutyTimesSummary(r).padEnd(36);
  const line = [
    pad(i + 1, 3),
    r.flight_number.padEnd(8),
    r.flight_date,
    occ,
    `dep ${depL}`.padEnd(12),
    `arr ${arrL}`.padEnd(12),
    route.padEnd(9),
    dutyT,
    depIso ? `UTC ${depIso.slice(11, 16)}Z` : '—',
    arrIso ? `UTC ${arrIso.slice(11, 16)}Z` : '—',
  ].join('  ');
  return line;
}

function isPcFlight(r: PdfFlightRow): boolean {
  return /^PC\d{2,4}$/i.test((r.flight_number || '').replace(/\s/g, '').toUpperCase());
}

function formatManualPcRow(r: PdfFlightRow, i: number) {
  const line = [
    pad(i + 1, 3),
    r.flight_date,
    r.flight_number.padEnd(10),
    (r.origin_iata ?? '—').padEnd(5),
    (r.destination_iata ?? '—').padEnd(5),
    (r.dep_time_local ?? '—').padEnd(8),
    (r.arr_time_local ?? '—').padEnd(8),
  ].join('  ');
  return line;
}

function timeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = hhmm.trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Aynı kalkış gününde arr < dep (dakika) ise iniş ertesi takvim günü (gece uçuşu). */
function effectiveArrDateIso(effectiveDepDate: string, r: PdfFlightRow): string {
  const depM = timeToMinutes(r.dep_time_local);
  const arrM = timeToMinutes(r.arr_time_local);
  if (depM != null && arrM != null && arrM < depM) return addDaysIso(effectiveDepDate, 1);
  return effectiveDepDate;
}

function localIstanbulToUtc(dateIso: string | null | undefined, hhmm: string | null | undefined): { utcTime: string; dayDeltaLabel: string } {
  if (!dateIso || !hhmm || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !/^\d{2}:\d{2}$/.test(hhmm)) {
    return { utcTime: '-', dayDeltaLabel: '' };
  }
  // Turkey is UTC+3 year-round.
  const d = new Date(`${dateIso}T${hhmm}:00+03:00`);
  if (Number.isNaN(d.getTime())) return { utcTime: '-', dayDeltaLabel: '' };
  const utcIso = d.toISOString();
  const utcDate = utcIso.slice(0, 10);
  const utcTime = utcIso.slice(11, 16);
  let dayDeltaLabel = '';
  if (utcDate < dateIso) dayDeltaLabel = ' *-1 Gün*';
  else if (utcDate > dateIso) dayDeltaLabel = ' *+1 Gün*';
  return { utcTime, dayDeltaLabel };
}

function pcNumber(fn: string | null | undefined): number | null {
  const s = (fn || '').replace(/\s/g, '').toUpperCase();
  const m = /^PC(\d{2,4})$/.exec(s);
  return m ? Number(m[1]) : null;
}

type OvernightHint = {
  suggestNextDay: boolean;
  reason: string | null;
};

type DutyDateFixHint = {
  suggestNextDay: boolean;
  reason: string | null;
};

function detectDutyStartDateFixes(pcFlights: PdfFlightRow[]): Map<number, DutyDateFixHint> {
  const out = new Map<number, DutyDateFixHint>();
  for (let i = 0; i < pcFlights.length; i += 1) {
    const r = pcFlights[i];
    const dep = timeToMinutes(r.dep_time_local);
    const dutyStart = timeToMinutes(r.duty_start_time_local);
    if (dep == null || dutyStart == null) continue;
    // PDF tarihi duty start gününe bağlandığı için, duty start saati dep saatinden büyükse
    // uçuş büyük olasılıkla ertesi günün erken saatindedir.
    if (dutyStart > dep) {
      out.set(i, {
        suggestNextDay: true,
        reason: `DutyStart ${r.duty_start_time_local} > Dep ${r.dep_time_local}`,
      });
    }
  }
  return out;
}

function detectOvernightReturnHints(
  pcFlights: PdfFlightRow[],
  baseDateByIndex: string[]
): Map<number, OvernightHint> {
  const out = new Map<number, OvernightHint>();

  for (let i = 0; i < pcFlights.length - 1; i += 1) {
    const a = pcFlights[i];
    const b = pcFlights[i + 1];
    if (baseDateByIndex[i] !== baseDateByIndex[i + 1]) continue;

    const an = pcNumber(a.flight_number);
    const bn = pcNumber(b.flight_number);
    if (an == null || bn == null || bn !== an + 1) continue;

    const aDep = timeToMinutes(a.dep_time_local);
    const bDep = timeToMinutes(b.dep_time_local);
    if (aDep == null || bDep == null) continue;

    // Aynı duty içinde ardışık çiftte dönüşün kalkışı gidişten erkense
    // dönüşün yerel tarihi çoğunlukla ertesi gündür.
    if (bDep < aDep) {
      out.set(i + 1, {
        suggestNextDay: true,
        reason: `Çift ${a.flight_number}-${b.flight_number}, dönüş saati daha erken (${b.dep_time_local} < ${a.dep_time_local})`,
      });
    }
  }
  return out;
}

function formatNonPcRow(r: PdfFlightRow, i: number, listed: 'Evet' | 'Hayır', durumFaz: string) {
  const kind = nonPcTypeLabel(r).padEnd(10);
  const line = [
    pad(i + 1, 3),
    r.flight_date,
    kind,
    r.flight_number.padEnd(10),
    (r.duty_occupation_code ?? '—').padEnd(10),
    (r.duty_start_time_local ?? '—').padEnd(10),
    (r.duty_end_time_local ?? '—').padEnd(10),
    listed.padEnd(5),
    durumFaz,
  ].join('  ');
  return line;
}

function nonPcTypeLabel(r: PdfFlightRow): string {
  const fn = (r.flight_number || '').replace(/\s/g, '').toUpperCase();
  if (fn === 'FSF' || fn === 'FOF' || fn === 'SOF') return 'Boş Gün';
  if (fn === 'SIM' || fn === 'IPT' || r.roster_entry_kind === 'sim') return 'Simülatör';
  if (/^STBY/i.test(fn)) return 'Nöbet';
  if (r.roster_entry_kind === 'duty_off') return 'Boş Gün';
  return r.roster_entry_kind ?? 'Diğer';
}

function slashDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Bazı PDF'lerde STBY satırları birleşik geldiği için ana parser kaçırabiliyor.
 * Bu fallback ham metinden "DD.MM.YYHH:mmSTBY*" satırlarını yakalar.
 */
function extractStandbyRowsFromRawText(text: string): PdfFlightRow[] {
  const out: PdfFlightRow[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').replace(/\s/g, '');
    const m = line.match(/^(\d{2})\.(\d{2})\.(\d{2})(\d{2}:\d{2})(STBY[A-Z0-9]*)$/i);
    if (!m) continue;
    const dd = m[1]!;
    const mm = m[2]!;
    const yy = m[3]!;
    const start = m[4]!;
    const code = m[5]!.toUpperCase();
    const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const flightDate = `${year}-${mm}-${dd}`;

    let dutyEndDateIso: string | null = null;
    let dutyEndTime: string | null = null;
    for (let j = i + 1; j <= Math.min(i + 8, lines.length - 1); j += 1) {
      const dateCandidate = (lines[j] ?? '').trim();
      const timeCandidate = (lines[j + 1] ?? '').trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateCandidate) && /^\d{2}:\d{2}(:\d{2})?$/.test(timeCandidate)) {
        dutyEndDateIso = slashDateToIso(dateCandidate);
        dutyEndTime = timeCandidate.slice(0, 5);
        break;
      }
    }

    out.push({
      roster_entry_kind: undefined,
      flight_number: code,
      flight_date: flightDate,
      duty_occupation_code: code,
      duty_occupation_label_tr: 'Nöbet',
      duty_occupation_label_en: 'Standby',
      duty_start_time_local: start,
      duty_end_date_iso: dutyEndDateIso,
      duty_end_time_local: dutyEndTime,
    });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--text');
  const showText = process.argv.includes('--text');
  const pdfPath = args[0];
  if (!pdfPath) {
    console.error(`
Kullanım:
  npx tsx scripts/pdf-roster-preview.ts <dosya.pdf> [--text]

Önce:  cd mobile && npm i -D pdf-parse tsx
`);
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), pdfPath);
  if (!fs.existsSync(resolved)) {
    console.error('Dosya yok:', resolved);
    process.exit(1);
  }

  const buf = fs.readFileSync(resolved);
  const data = await pdfParse(buf);
  const text = (data.text || '').replace(/\r\n/g, '\n');

  console.log('══════════════════════════════════════════════════════════════');
  console.log('PDF:', resolved);
  console.log('Sayfa:', data.numpages, ' | Karakter:', text.length);
  console.log('══════════════════════════════════════════════════════════════\n');

  if (showText) {
    console.log('--- Ham metin (ilk 2500 karakter) ---\n');
    console.log(text.slice(0, 2500));
    console.log('\n--- ... ---\n');
  }

  const pegasus = parseFlightsFromPdfText_Pegasus(text);
  const thy = parseFlightsFromPdfText_THY(text);
  const dutyCore = parseFlightsFromPdfText_DutyLocalTableCore(text);
  const dutySingle = parseFlightsFromPdfText_DutySingleLineSameRow(text);
  const dutyFull = [...dutySingle, ...dutyCore];
  const merged = parseFlightsFromPdfText(text);
  const standbyFallback = extractStandbyRowsFromRawText(text);
  const mergedKeys = new Set(
    merged.map((r) => `${r.flight_date}|${(r.flight_number || '').replace(/\s/g, '').toUpperCase()}`)
  );
  const standbyMissing = standbyFallback.filter(
    (r) => !mergedKeys.has(`${r.flight_date}|${(r.flight_number || '').replace(/\s/g, '').toUpperCase()}`)
  );
  const previewRows = [...merged, ...standbyMissing];

  console.log('--- Parser ara sonuçları ---');
  console.log('  Pegasus kuralları     :', pegasus.length, 'satır');
  console.log('  THY/MAR kuralları     :', thy.length, 'satır');
  console.log('  Duty çekirdek tablo   :', dutyCore.length, 'satır');
  console.log('  Duty tek-satır fallback:', dutySingle.length, 'satır');
  console.log('  Duty (tek+çekirdek, birleşim sırası) :', dutyFull.length, 'satır');
  console.log('  Birleşik (uygulama)   :', merged.length, 'satır');
  if (standbyMissing.length > 0) {
    console.log('  STBY fallback eklendi :', standbyMissing.length, 'satır');
  }
  console.log('');

  if (previewRows.length === 0) {
    console.log('Hiç uçuş çıkmadı. --text ile metne bak veya satır formatını paylaş.\n');
    process.exit(0);
  }

  const tzMap = await loadTzMapForRows(previewRows);
  const needAirportTz = previewRows.some(
    (r) =>
      r.roster_entry_kind !== 'sim' &&
      r.roster_entry_kind !== 'duty_off' &&
      (r.origin_iata || r.destination_iata)
  );
  if (needAirportTz && tzMap.size === 0 && process.env.EXPO_PUBLIC_SUPABASE_URL) {
    console.log(
      'Not: airports.timezone_iana eşleşmedi veya tablo boş — UTC sütunu Europe/Istanbul yedeği kullanıyor.\n'
    );
  }

  const pcFlights = previewRows.filter(isPcFlight);
  const dutyDateFixHints = detectDutyStartDateFixes(pcFlights);
  const baseDateByIndex = pcFlights.map((r, i) =>
    dutyDateFixHints.get(i)?.suggestNextDay ? addDaysIso(r.flight_date, 1) : r.flight_date
  );
  const overnightHints = detectOvernightReturnHints(pcFlights, baseDateByIndex);
  const finalDateByIndex = baseDateByIndex.map((d, i) =>
    overnightHints.get(i)?.suggestNextDay ? addDaysIso(d, 1) : d
  );
  const pcIndexByRef = new Map<PdfFlightRow, number>();
  pcFlights.forEach((r, i) => pcIndexByRef.set(r, i));
  const nonPcRows = previewRows.filter((r) => !isPcFlight(r));

  const minFlightDate = getLocalDateStringPlusDays(-ROSTER_MIN_DAYS_AGO);
  const rosterListPrefs = normalizeRosterListShow(null);
  const nowMs = Date.now();

  console.log('--- Uçuş fazı (minval; yalnızca planlı dep+arr olan satırlar, diğerlerinde “—”) ---');
  console.log('X = planlı kalkış, Y = planlı iniş (last_seen = Y). Tarih: PC’de Tarih(Öneri), aksi halde satır tarihi. Saat: Europe/Istanbul (+03).');
  console.log('  Pasif (ileri)   : X henüz now+12 saat penceresine girmedi (uzak gelecek)');
  console.log('  Yarı aktif      : now+12 saat > X, fakat now+30 dk > X değil (aktif öncesi)');
  console.log('  Aktif           : now+30 dk > X ve henüz now ≤ Y (kalkışa yakın, uçuşta veya tamamlanmamış)');
  console.log('  Pasif (geçmiş)  : now > Y (segment bitti)\n');

  console.log('--- Uygulamaya Manuel Giriş (PC uçuşları) ---');
  console.log(
    `Toplam PC uçuş: ${pcFlights.length}  | Not: Önce Duty düzeltmesi, sonra gece dönüş düzeltmesi uygulanır.`
  );
  console.log(
    ' #   Tarih(PDF)   Tarih(Öneri) Tam Kod     Kalkış  Varış  Dep(L)    Arr(L)    DutyFix  GeceDönüş  Listede?  Durum'
  );
  console.log('-'.repeat(172));
  if (pcFlights.length === 0) {
    console.log(' (PC uçuşu bulunamadı)');
  } else {
    pcFlights.forEach((r, i) => {
      const dutyHint = dutyDateFixHints.get(i);
      const overnightHint = overnightHints.get(i);
      const suggestedDate = finalDateByIndex[i];
      const dutyMark = dutyHint?.suggestNextDay ? 'EVET(+1)' : '-';
      const overnightMark = overnightHint?.suggestNextDay ? 'EVET(+1)' : '-';
      const listed = listedInApp(r, suggestedDate, minFlightDate, rosterListPrefs);
      const faz = flightPhaseLabel(r, suggestedDate, nowMs);
      const row = [
        pad(i + 1, 3),
        r.flight_date,
        suggestedDate,
        r.flight_number.padEnd(10),
        (r.origin_iata ?? '—').padEnd(5),
        (r.destination_iata ?? '—').padEnd(5),
        (r.dep_time_local ?? '—').padEnd(8),
        (r.arr_time_local ?? '—').padEnd(8),
        dutyMark.padEnd(8),
        overnightMark.padEnd(10),
        listed.padEnd(5),
        faz,
      ].join('  ');
      console.log(row);
    });
  }
  console.log('-'.repeat(172));
  const dutyFixList = pcFlights
    .map((r, i) => {
      const hint = dutyDateFixHints.get(i);
      return hint?.suggestNextDay ? `${r.flight_number} ${r.flight_date} -> ${baseDateByIndex[i]} (${hint.reason})` : null;
    })
    .filter((x): x is string => !!x);
  if (dutyFixList.length > 0) {
    console.log(`Duty kaynaklı +1 gün adayı: ${dutyFixList.length}`);
    dutyFixList.forEach((s) => console.log(`  - ${s}`));
  } else {
    console.log('Duty kaynaklı +1 gün adayı: 0');
  }
  const overnightList = pcFlights
    .map((r, i) => {
      const hint = overnightHints.get(i);
      return hint?.suggestNextDay
        ? `${r.flight_number} ${baseDateByIndex[i]} -> ${addDaysIso(baseDateByIndex[i], 1)} (${hint.reason})`
        : null;
    })
    .filter((x): x is string => !!x);
  if (overnightList.length > 0) {
    console.log(`Gece dönüş adayı: ${overnightList.length}`);
    overnightList.forEach((s) => console.log(`  - ${s}`));
  } else {
    console.log('Gece dönüş adayı: 0');
  }
  console.log('');

  console.log('--- PC dışındaki kayıtlar (ayrı tablo) ---');
  console.log(`Toplam PC dışı: ${nonPcRows.length}`);
  console.log(
    ' #   Tarih        Tür         Kod         Görev      DutyStart  DutyEnd   Listede? Durum'
  );
  console.log('-'.repeat(128));
  if (nonPcRows.length === 0) {
    console.log(' (PC dışı kayıt yok)');
  } else {
    nonPcRows.forEach((r, i) => {
      const listed = listedInApp(r, r.flight_date, minFlightDate, rosterListPrefs);
      const faz = flightPhaseLabel(r, r.flight_date, nowMs);
      console.log(formatNonPcRow(r, i, listed, faz));
    });
  }
  console.log('-'.repeat(128));
  console.log('');

  const appListRows = previewRows
    .map((r) => {
      const pcIdx = pcIndexByRef.get(r);
      const effectiveDate = typeof pcIdx === 'number' ? finalDateByIndex[pcIdx] : r.flight_date;
      const isFlight = isPcFlight(r);
      const effectiveTime = isFlight ? r.dep_time_local ?? null : r.duty_start_time_local ?? null;
      const minutes = timeToMinutes(effectiveTime) ?? 24 * 60 + 59;
      const type = isFlight ? 'Uçuş' : nonPcTypeLabel(r);
      const oi = r.origin_iata?.replace(/\s/g, '').toUpperCase().slice(0, 3) ?? '';
      const di = r.destination_iata?.replace(/\s/g, '').toUpperCase().slice(0, 3) ?? '';
      const { depIso, arrIso } = rowToScheduleIso(r, {
        originTz: oi.length === 3 ? tzMap.get(oi) ?? null : null,
        destTz: di.length === 3 ? tzMap.get(di) ?? null : null,
      });
      const dutyStartUtc = localIstanbulToUtc(effectiveDate, r.duty_start_time_local ?? null);
      const dutyEndLocalDate = r.duty_end_date_iso ?? effectiveDate;
      const dutyEndUtc = localIstanbulToUtc(dutyEndLocalDate, r.duty_end_time_local ?? null);
      return {
        raw: r,
        date: effectiveDate,
        minutes,
        code: (r.flight_number || '—').replace(/\s/g, '').toUpperCase(),
        type,
        dep: r.origin_iata ?? '—',
        arr: r.destination_iata ?? '—',
        scheduledDep: r.dep_time_local ?? '—',
        scheduledArr: r.arr_time_local ?? '—',
        utcDep: depIso ? depIso.slice(11, 16) : '—',
        utcArr: arrIso ? arrIso.slice(11, 16) : '—',
        dutyStart: r.duty_start_time_local ?? '—',
        dutyEnd: r.duty_end_time_local ?? '—',
        dutyStartUtc: dutyStartUtc.utcTime,
        dutyStartUtcDelta: dutyStartUtc.dayDeltaLabel,
        dutyEndUtc: dutyEndUtc.utcTime,
        dutyEndUtcDelta: dutyEndUtc.dayDeltaLabel,
        isFlight,
      };
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.minutes !== b.minutes) return a.minutes - b.minutes;
      return a.code.localeCompare(b.code);
    });

  const appListRowsInRoster = appListRows.filter((row) => row.date >= minFlightDate);
  const belowRosterThreshold = appListRows.length - appListRowsInRoster.length;

  console.log('--- Uygulama Uçuş Listesi Simülasyonu (kart görünümü) ---');
  console.log(
    `Tarih eşiği (yerel, roster ile aynı): flight_date >= ${minFlightDate} (dün ve sonrası).`
  );
  if (belowRosterThreshold > 0) {
    console.log(`Eşik altında (listede gösterilmez): ${belowRosterThreshold} satır.`);
  }
  console.log(`Bu bölümde listelenen: ${appListRowsInRoster.length} / ${appListRows.length}`);
  console.log('Not: Saatler Local (L) ve UTC (Z) birlikte gösterilir.');
  console.log('Varsayılan profil tercihleri (tüm görev türleri açık) ile “Listede?” hesaplanır.\n');
  appListRowsInRoster.forEach((r, i) => {
    const listed = listedInApp(r.raw, r.date, minFlightDate, rosterListPrefs);
    const faz = flightPhaseLabel(r.raw, r.date, nowMs);
    console.log('-'.repeat(76));
    console.log(
      `#${pad(i + 1, 2)}  ${r.date}  ${r.code}  [${r.type}]`.padEnd(52) +
        `Listede? ${listed}  |  Durum: ${faz}`
    );
    if (r.isFlight) {
      console.log(`DEP/ARR : ${r.dep} -> ${r.arr}`);
      console.log(`DEP     : ${r.scheduledDep} (L) / ${r.utcDep} (Z)`);
      console.log(`ARR     : ${r.scheduledArr} (L) / ${r.utcArr} (Z)`);
    } else {
      console.log(`Gorev   : ${r.dep === '—' ? '-' : r.dep} -> ${r.arr === '—' ? '-' : r.arr}`);
      console.log(`START   : ${r.dutyStart} (L) / ${r.dutyStartUtc} (Z)${r.dutyStartUtcDelta}`);
      console.log(`END     : ${r.dutyEnd} (L) / ${r.dutyEndUtc} (Z)${r.dutyEndUtcDelta}`);
    }
  });
  console.log('-'.repeat(76));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
