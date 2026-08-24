/**
 * Pegasus: satır bazlı `DD.MM.YY` + PCxxxx (duty PDF’inde çoğu zaman kapalı — `dutyTable` ana yol).
 */

import type { PdfFlightRow } from '../../types.ts';
import { PEGASUS_SIM_OR_IPT_OCC } from '../../simulatorDuty.ts';
import { extractRouteOnLine, extractTimesOnLine, isLikelyFlightNumber } from '../../textUtils.ts';
import { pegasusUtcSchedulePairFromFlightDate } from '../../timeAndSchedule.ts';
import { detectPegasusPlanTimeBasis } from '../../normalize.ts';

/**
 * Pegasus satır-taraması: `\b` ile satır ortasındaki `04.04.26` / `04.04.2026` (slash tablo, gürültü)
 * `lastDateIso` yapıp **tüm sonraki PC satırlarını o güne** yapıştırıyordu.
 * Tarih yalnızca satır başı veya bilinen duty başlığından taşınır.
 */
export function tryPegasusLineAnchorDate(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  let m: RegExpExecArray | null;
  m = new RegExp(`^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2})(\\d{1,2}:\\d{2})(DUTY|FSF|FOF|STBY[A-Z0-9]*|${PEGASUS_SIM_OR_IPT_OCC})`, 'i').exec(t);
  if (m) {
    const yy = parseInt(m[3]!, 10);
    return `${2000 + yy}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  m = new RegExp(`^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})(\\d{1,2}:\\d{2})(${PEGASUS_SIM_OR_IPT_OCC})`, 'i').exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2})\s+(\d{1,2}:\d{2})\s*(DUTY|FSF|FOF|STBY)/i.exec(t);
  if (m) {
    const yy = parseInt(m[3]!, 10);
    return `${2000 + yy}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)(\s|$)/.exec(t);
  if (m) {
    const yNum = parseInt(m[3]!, 10);
    if (yNum >= 2000 && yNum <= 2100) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)(\s|$)/.exec(t);
  if (m) {
    const yy = parseInt(m[3]!, 10);
    return `${2000 + yy}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) {
    const yNum = parseInt(m[3]!, 10);
    if (yNum >= 2000 && yNum <= 2100) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(t);
  if (m) {
    const yy = parseInt(m[3]!, 10);
    return `${2000 + yy}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return null;
}

/** Pegasus-style: DD.MM.YY veya DD.MM.YYYY; `19.03.2610:40` gibi yapışık saatleri yıl sanmamak için YY sonrası `(?!\d)`. */
export function parseFlightsFromPdfText_Pegasus(text: string): PdfFlightRow[] {
  const out: PdfFlightRow[] = [];
  const lines = text.split(/\r?\n/);
  const flightRe = /\b([A-Z]{2,3})\s*(\d{2,4})\b/g;
  let lastDateIso: string | null = null;
  const planTimeBasis = detectPegasusPlanTimeBasis(text);
  for (const line of lines) {
    const anchor = tryPegasusLineAnchorDate(line);
    if (anchor) lastDateIso = anchor;
    const numbers: string[] = [];
    let mx: RegExpExecArray | null;
    flightRe.lastIndex = 0;
    while ((mx = flightRe.exec(line)) !== null) {
      if (mx[2]!.length >= 2) numbers.push((mx[1]! + mx[2]!).toUpperCase());
    }
    const iso = lastDateIso;
    if (iso && numbers.length) {
      const { dep, arr, isUtcPair } = extractTimesOnLine(line);
      const treatAsUtcPair = isUtcPair || planTimeBasis === 'Z';
      const { origin, dest } = extractRouteOnLine(line);
      for (const fn of numbers) {
        if (!isLikelyFlightNumber(fn)) continue;
        /** THY = `airlines/thy/`; burada TK hayalet satırı üretme (rota `IST/6:00` slash formatında). */
        if (/^TK\d{2,4}$/.test(fn)) continue;
        if (treatAsUtcPair && dep && arr) {
          const utc = pegasusUtcSchedulePairFromFlightDate(iso, dep, arr);
          if (utc) {
            out.push({
              flight_number: fn,
              flight_date: iso,
              dep_schedule_utc_iso: utc.dep_schedule_utc_iso,
              arr_schedule_utc_iso: utc.arr_schedule_utc_iso,
              origin_iata: origin,
              destination_iata: dest,
            });
            continue;
          }
        }
        out.push({
          flight_number: fn,
          flight_date: iso,
          dep_time_local: dep,
          arr_time_local: arr,
          origin_iata: origin,
          destination_iata: dest,
        });
      }
    }
  }
  return out;
}
