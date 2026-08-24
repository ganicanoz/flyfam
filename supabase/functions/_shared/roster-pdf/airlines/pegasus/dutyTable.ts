/**
 * Pegasus duty roster PDF: `22.03.2615:25DUTY`, slash DD/MM/YYYY tabloları, PC + 4 satır IATA/saat.
 */

import type { PdfFlightRow } from '../../types.ts';
import { rosterOccupationLabelEn, rosterOccupationLabelTr, isStandbyOccupationCode } from '../../occupationLabels.ts';
import { isSimulatorOccupationCode, simulatorFlightNumberLabel, PEGASUS_SIM_OR_IPT_OCC } from '../../simulatorDuty.ts';
import { isLikelyFlightNumber } from '../../textUtils.ts';
import { pegasusUtcSchedulePairFromFlightDate } from '../../timeAndSchedule.ts';
import { detectPegasusPlanTimeBasis } from '../../normalize.ts';

/** PDF’te `DD/MM/YYYY` + (sonraki satır) `HH:MM` veya `HH:MM:SS` — iki çift (duty end + resting end veya SIM duty start + duty end). */
type SlashDateTimePair = { ymd: string; hhmm: string };

function tryReadTwoSlashPairs(
  lines: string[],
  startIdx: number
): { pairs: [SlashDateTimePair, SlashDateTimePair]; consume: number } | null {
  let idx = startIdx;
  const out: SlashDateTimePair[] = [];
  for (let k = 0; k < 2; k++) {
    const ds = lines[idx]?.trim() ?? '';
    const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ds);
    if (!dm) return null;
    const ymd = `${dm[3]}-${dm[2]!.padStart(2, '0')}-${dm[1]!.padStart(2, '0')}`;
    idx += 1;
    const ts = lines[idx]?.trim() ?? '';
    const tm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(ts);
    if (!tm) return null;
    const hhmm = `${tm[1]!.padStart(2, '0')}:${tm[2]}`;
    out.push({ ymd, hhmm });
    idx += 1;
  }
  return { pairs: [out[0]!, out[1]!], consume: idx - startIdx };
}

/**
 * Pegasus duty tablosu (tarih+DUTY/FSF/…, slash çiftleri, PC satırı + 4 satır IATA/saat).
 * `DutySingleLineSameRow` dahil değil — o yol Pegasus duty PDF + metin gürültüsünde yanlış `flight_date` (ör. 4 Nisan) üretebiliyor.
 */
export function parseFlightsFromPdfText_DutyLocalTableCore(text: string): PdfFlightRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: PdfFlightRow[] = [];
  const planTimeBasis = detectPegasusPlanTimeBasis(text);

  /** 22.03.2615:25DUTY | …FSF | …IPT | …OPC3-SIM (2 haneli yıl) */
  const dutyOcc = `([A-Z][A-Z0-9_-]{1,20}|${PEGASUS_SIM_OR_IPT_OCC})`;
  const dutyGlued = new RegExp(
    `^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2})(\\d{1,2}):(\\d{2})\\s*${dutyOcc}\\s*$`,
    'i',
  );
  const dutySpaced = new RegExp(
    `^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2})\\s+(\\d{1,2}):(\\d{2})\\s*${dutyOcc}\\s*$`,
    'i',
  );
  /** 07.04.202617:45OPC3-SIM veya …IPT — 4 haneli yıl + sim occupation */
  const dutyGluedYyyySim = new RegExp(
    `^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})(\\d{1,2}):(\\d{2})(${PEGASUS_SIM_OR_IPT_OCC})\\s*$`,
    'i',
  );
  const flightLine = /^([A-Z]{2,3})\s*(\d{2,4})$/i;
  /** SAW veya SAW(OD) */
  const airportLine = /^([A-Z]{3})(?:\([^)]*\))?\s*$/;
  const timeLineLocal = /^(\d{1,2}):(\d{2})$/;
  const timeLineUtc = /^(\d{1,2}):(\d{2})\s*\([Zz]\)\s*$/;

  let skipUntil = -1;
  let pendingDate: string | null = null;
  let pendingOccupationCode: string | null = null;
  let pendingDutyStartTime: string | null = null;
  /** Uçuş görevi: slash tablosunda 1. çift = duty end, 2. çift = resting end */
  let pendingSlashDutyEnd: SlashDateTimePair | null = null;
  let pendingSlashRestEnd: SlashDateTimePair | null = null;

  const clearPendingSlashFlight = () => {
    pendingSlashDutyEnd = null;
    pendingSlashRestEnd = null;
  };

  const setDateFromDutyYy = (m: RegExpExecArray) => {
    const d = m[1]!.padStart(2, '0');
    const mo = m[2]!.padStart(2, '0');
    const yy = parseInt(m[3]!, 10);
    pendingDate = `${2000 + yy}-${mo}-${d}`;
    const occRaw = m[6];
    pendingOccupationCode = occRaw ? occRaw.replace(/\s/g, '').toUpperCase() : null;
  };

  const pushSimRow = (p0: SlashDateTimePair, p1: SlashDateTimePair) => {
    if (!pendingDate) return;
    out.push({
      roster_entry_kind: 'sim',
      flight_number: simulatorFlightNumberLabel(pendingOccupationCode),
      flight_date: pendingDate,
      duty_occupation_code: pendingOccupationCode,
      duty_occupation_label_tr: rosterOccupationLabelTr(pendingOccupationCode),
      duty_occupation_label_en: rosterOccupationLabelEn(pendingOccupationCode),
      duty_start_time_local: pendingDutyStartTime,
      duty_slash_start_date_iso: p0.ymd,
      duty_slash_start_time_local: p0.hhmm,
      duty_end_date_iso: p1.ymd,
      duty_end_time_local: p1.hhmm,
    });
  };

  /** FSF/FOF/MSF: uçuş satırı yoksa aynı slash semantiği (1. çift = görev sonu, 2. = dinlenme sonu). */
  const pushFsfFofRow = (p0: SlashDateTimePair, p1: SlashDateTimePair) => {
    if (!pendingDate || !pendingOccupationCode) return;
    const code = pendingOccupationCode;
    if (code !== 'FSF' && code !== 'FOF' && code !== 'MSF') return;
    out.push({
      roster_entry_kind: 'duty_off',
      flight_number: code,
      flight_date: pendingDate,
      duty_occupation_code: code,
      duty_occupation_label_tr: rosterOccupationLabelTr(code),
      duty_occupation_label_en: rosterOccupationLabelEn(code),
      duty_start_time_local: pendingDutyStartTime,
      duty_end_date_iso: p0.ymd,
      duty_end_time_local: p0.hhmm,
      duty_rest_end_date_iso: p1.ymd,
      duty_rest_end_time_local: p1.hhmm,
    });
  };

  /** STBY / SB / HSBY vb.: uçuş satırı yoksa slash çiftleri görev penceresi + dinlenme sonu. */
  const pushStandbyDutyRow = (p0: SlashDateTimePair, p1: SlashDateTimePair) => {
    if (!pendingDate || !pendingOccupationCode) return;
    const code = pendingOccupationCode;
    if (!isStandbyOccupationCode(code)) return;
    out.push({
      roster_entry_kind: 'duty_off',
      flight_number: code,
      flight_date: pendingDate,
      duty_occupation_code: code,
      duty_occupation_label_tr: rosterOccupationLabelTr(code),
      duty_occupation_label_en: rosterOccupationLabelEn(code),
      duty_start_time_local: pendingDutyStartTime,
      duty_end_date_iso: p0.ymd,
      duty_end_time_local: p0.hhmm,
      duty_rest_end_date_iso: p1.ymd,
      duty_rest_end_time_local: p1.hhmm,
    });
  };

  /** Slash tablosu yok; yalnızca `DD.MM.YY HH:MMCODE` — MEET/RSV vb. başlangıç saati korunur. */
  const pushDutyOffRowStartOnly = () => {
    if (!pendingDate || !pendingOccupationCode) return;
    const code = pendingOccupationCode;
    if (isSimulatorOccupationCode(code)) return;
    if (isStandbyOccupationCode(code)) return;
    out.push({
      roster_entry_kind: 'duty_off',
      flight_number: code,
      flight_date: pendingDate,
      duty_occupation_code: code,
      duty_occupation_label_tr: rosterOccupationLabelTr(code),
      duty_occupation_label_en: rosterOccupationLabelEn(code),
      duty_start_time_local: pendingDutyStartTime,
    });
  };

  /** Genel duty/off kodları (ROF, RSF, VAV, UPV, III, VAC, vb.) — uçuş satırı yoksa non-flight duty satırı üret. */
  const pushGenericDutyOffRow = (p0: SlashDateTimePair, p1: SlashDateTimePair) => {
    if (!pendingDate || !pendingOccupationCode) return;
    const code = pendingOccupationCode;
    if (isSimulatorOccupationCode(code)) return;
    if (isStandbyOccupationCode(code)) return;
    out.push({
      roster_entry_kind: 'duty_off',
      flight_number: code,
      flight_date: pendingDate,
      duty_occupation_code: code,
      duty_occupation_label_tr: rosterOccupationLabelTr(code),
      duty_occupation_label_en: rosterOccupationLabelEn(code),
      duty_start_time_local: pendingDutyStartTime,
      duty_end_date_iso: p0.ymd,
      duty_end_time_local: p0.hhmm,
      duty_rest_end_date_iso: p1.ymd,
      duty_rest_end_time_local: p1.hhmm,
    });
  };

  const nextLineLooksLikeFlight = (idx: number): boolean => {
    const fl = lines[idx];
    const fm = fl ? flightLine.exec(fl) : null;
    if (!fm) return false;
    const fn = (fm[1]! + fm[2]!).toUpperCase();
    return isLikelyFlightNumber(fn);
  };

  for (let i = 0; i < lines.length; i++) {
    if (i < skipUntil) continue;
    const line = lines[i]!;

    let dm = dutyGluedYyyySim.exec(line);
    if (dm) {
      const d = dm[1]!.padStart(2, '0');
      const mo = dm[2]!.padStart(2, '0');
      const yyyy = dm[3]!;
      pendingDate = `${yyyy}-${mo}-${d}`;
      pendingDutyStartTime = `${dm[4]!.padStart(2, '0')}:${dm[5]}`;
      pendingOccupationCode = dm[6]!.replace(/\s/g, '').toUpperCase();
      clearPendingSlashFlight();

      const slash = tryReadTwoSlashPairs(lines, i + 1);
      if (slash) {
        skipUntil = Math.max(skipUntil, i + 1 + slash.consume);
        const [p0, p1] = slash.pairs;
        const nextIdx = i + 1 + slash.consume;
        if (!nextLineLooksLikeFlight(nextIdx)) pushSimRow(p0, p1);
      } else {
        skipUntil = Math.max(skipUntil, i + 1);
      }
      continue;
    }

    dm = dutyGlued.exec(line) ?? dutySpaced.exec(line);
    if (dm) {
      setDateFromDutyYy(dm);
      pendingDutyStartTime = `${dm[4]!.padStart(2, '0')}:${dm[5]}`;
      clearPendingSlashFlight();

      const occ = pendingOccupationCode ?? '';
      const isSimDuty = isSimulatorOccupationCode(occ);
      const isFsfFof = occ === 'FSF' || occ === 'FOF' || occ === 'MSF';
      const isStandby = isStandbyOccupationCode(occ);
      const slash = tryReadTwoSlashPairs(lines, i + 1);
      if (slash) {
        skipUntil = Math.max(skipUntil, i + 1 + slash.consume);
        const [p0, p1] = slash.pairs;
        const nextIdx = i + 1 + slash.consume;
        const hasFlight = nextLineLooksLikeFlight(nextIdx);
        if (isSimDuty && !hasFlight) {
          pushSimRow(p0, p1);
        } else if (isFsfFof && !hasFlight) {
          pushFsfFofRow(p0, p1);
        } else if (isStandby && !hasFlight) {
          pushStandbyDutyRow(p0, p1);
        } else if (!hasFlight) {
          pushGenericDutyOffRow(p0, p1);
        } else if (!isSimDuty) {
          pendingSlashDutyEnd = p0;
          pendingSlashRestEnd = p1;
        }
      } else if (!nextLineLooksLikeFlight(i + 1) && !isSimDuty && !isFsfFof && !isStandby) {
        pushDutyOffRowStartOnly();
      }
      continue;
    }

    const fm = flightLine.exec(line);
    if (!fm || !pendingDate) continue;

    const o1 = lines[i + 1];
    const t1 = lines[i + 2];
    const o2 = lines[i + 3];
    const t2 = lines[i + 4];
    if (!o1 || !t1 || !o2 || !t2) continue;

    const am1 = airportLine.exec(o1);
    const utc1 = timeLineUtc.exec(t1);
    const utc2 = timeLineUtc.exec(t2);
    const tm1 = utc1 ?? timeLineLocal.exec(t1);
    const tm2 = utc2 ?? timeLineLocal.exec(t2);
    const am2 = airportLine.exec(o2);
    if (!am1 || !tm1 || !am2 || !tm2) continue;
    const bothUtcTagged = utc1 !== null && utc2 !== null;
    if (!bothUtcTagged && (utc1 !== null) !== (utc2 !== null)) continue;
    // Header'da (Z) varsa (etiket düşse bile) saat çiftini UTC kabul et.
    const treatAsUtcPair = bothUtcTagged || (planTimeBasis === 'Z');

    const fn = (fm[1]! + fm[2]!).toUpperCase();
    if (!isLikelyFlightNumber(fn)) continue;
    if (/^TK\d{2,4}$/.test(fn)) continue;

    const depH = `${tm1[1]!.padStart(2, '0')}:${tm1[2]}`;
    const arrH = `${tm2[1]!.padStart(2, '0')}:${tm2[2]}`;
    let utcPair: { dep_schedule_utc_iso: string; arr_schedule_utc_iso: string } | null = null;
    if (treatAsUtcPair) {
      utcPair = pegasusUtcSchedulePairFromFlightDate(pendingDate, depH, arrH);
      if (!utcPair) continue;
    }

    out.push({
      roster_entry_kind: 'flight',
      flight_number: fn,
      flight_date: pendingDate,
      ...(utcPair
        ? {
            dep_schedule_utc_iso: utcPair.dep_schedule_utc_iso,
            arr_schedule_utc_iso: utcPair.arr_schedule_utc_iso,
          }
        : {
            dep_time_local: depH,
            arr_time_local: arrH,
          }),
      origin_iata: am1[1]!,
      destination_iata: am2[1]!,
      duty_occupation_code: pendingOccupationCode,
      duty_occupation_label_tr: rosterOccupationLabelTr(pendingOccupationCode),
      duty_occupation_label_en: rosterOccupationLabelEn(pendingOccupationCode),
      duty_start_time_local: pendingDutyStartTime,
      duty_end_date_iso: pendingSlashDutyEnd?.ymd ?? null,
      duty_end_time_local: pendingSlashDutyEnd?.hhmm ?? null,
      duty_rest_end_date_iso: pendingSlashRestEnd?.ymd ?? null,
      duty_rest_end_time_local: pendingSlashRestEnd?.hhmm ?? null,
    });
    clearPendingSlashFlight();
  }

  return out;
}

/**
 * Çekirdek duty tablosu + tek satır fallback.
 * Sıra: önce tek satır, sonra çekirdek — `parseFlightsFromPdfText` içinde Map birleşiminde **son gelen kazanır**;
 * böylece aynı `flight_date|flight_number` anahtarında gerçek DUTY satırı, tek-satır gürültüsünün üstüne yazılır.
 */
export function parseFlightsFromPdfText_DutyLocalTable(text: string): PdfFlightRow[] {
  return [
    ...parseFlightsFromPdfText_DutySingleLineSameRow(text),
    ...parseFlightsFromPdfText_DutyLocalTableCore(text),
  ];
}

/** Tek satırda `SAW 16:35` + `DD.MM.YY` (yıl sonrasında rakam yok) — eski / farklı PDF’ler. */
export function parseFlightsFromPdfText_DutySingleLineSameRow(text: string): PdfFlightRow[] {
  const out: PdfFlightRow[] = [];
  const rawLines = text.split(/\r?\n/);
  let lastDateIso: string | null = null;
  const ddMmYy = /\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b(?!\d)/g;
  const airportTime = /\b([A-Z]{3})\s+([01]?\d|2[0-3]):([0-5]\d)(\s*\([Zz]\))?\b/g;
  const flightSpaced = /\b([A-Z]{2,3})\s+(\d{2,4})\b/g;
  const flightJoined = /\b([A-Z]{2,3})(\d{2,4})\b/g;

  for (const line of rawLines) {
    ddMmYy.lastIndex = 0;
    let dm: RegExpExecArray | null;
    while ((dm = ddMmYy.exec(line)) !== null) {
      const d = dm[1]!.padStart(2, '0');
      const mo = dm[2]!.padStart(2, '0');
      const yy = parseInt(dm[3]!, 10);
      lastDateIso = `${2000 + yy}-${mo}-${d}`;
      break;
    }

    const pairs: { iata: string; hhmm: string; isZ: boolean }[] = [];
    airportTime.lastIndex = 0;
    let at: RegExpExecArray | null;
    while ((at = airportTime.exec(line)) !== null) {
      pairs.push({
        iata: at[1]!,
        hhmm: `${at[2]!.padStart(2, '0')}:${at[3]}`,
        isZ: !!at[4]?.trim(),
      });
    }

    const flightNumsSet = new Set<string>();
    let fx: RegExpExecArray | null;
    flightSpaced.lastIndex = 0;
    while ((fx = flightSpaced.exec(line)) !== null) {
      flightNumsSet.add((fx[1]! + fx[2]!).toUpperCase());
    }
    flightJoined.lastIndex = 0;
    while ((fx = flightJoined.exec(line)) !== null) {
      flightNumsSet.add((fx[1]! + fx[2]!).toUpperCase());
    }

    const iso = lastDateIso;
    if (!iso || pairs.length < 2 || flightNumsSet.size === 0) continue;

    const dep = pairs[0]!;
    const arr = pairs[1]!;
    const bothLineUtc = dep.isZ && arr.isZ;
    const utcPair = bothLineUtc ? pegasusUtcSchedulePairFromFlightDate(iso, dep.hhmm, arr.hhmm) : null;
    if (bothLineUtc && !utcPair) continue;

    for (const fn of flightNumsSet) {
      if (!isLikelyFlightNumber(fn)) continue;
      if (/^TK\d{2,4}$/.test(fn)) continue;
      if (utcPair) {
        out.push({
          flight_number: fn,
          flight_date: iso,
          dep_schedule_utc_iso: utcPair.dep_schedule_utc_iso,
          arr_schedule_utc_iso: utcPair.arr_schedule_utc_iso,
          origin_iata: dep.iata,
          destination_iata: arr.iata,
        });
      } else {
        out.push({
          flight_number: fn,
          flight_date: iso,
          dep_time_local: dep.hhmm,
          arr_time_local: arr.hhmm,
          origin_iata: dep.iata,
          destination_iata: arr.iata,
        });
      }
    }
  }
  return out;
}
