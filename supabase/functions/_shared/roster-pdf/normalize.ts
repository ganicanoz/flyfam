/**
 * Ham PDF metnini normalize et — şu an Pegasus duty layout’una göre.
 */

/**
 * `expo-pdf-text-extract` çoğu zaman `pdf-parse`ten farklı satır kırar; duty blokları tek satırda yapışık kalabiliyor.
 * Bu adım Pegasus duty tablosu (`PC` + IATA + saat satırları) ve yapışık tarih/saat başlıklarını mümkün olduğunca toparlar.
 */
export function normalizePdfTextForRosterParse(text: string): string {
  let s = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Yapışık duty başlığı: "...22.03.2615:25DUTY" → önüne newline.
  // (?<![0-9]) zorunlu: aksi halde "19.03.2607:40DUTY" → "1" + "9.03.26..." diye bölünüp Date(L) yanlış (ör. PC291 → 9 Mart).
  s = s.replace(
    /(?<![0-9])(\d{1,2}\.\d{1,2}\.\d{2})(\d{1,2}:\d{2})(DUTY|FSF|FOF|STBY[A-Z0-9]*|\S*SIM)\b/gi,
    '\n$1$2$3',
  );
  // 4 haneli yıl + SIM: "...07.04.202617:45OPC3-SIM"
  s = s.replace(
    /(?<![0-9])(\d{1,2}\.\d{1,2}\.\d{4})(\d{1,2}:\d{2})(\S*SIM)\b/gi,
    '\n$1$2$3',
  );
  // Boşluklu duty başlığı yapışıksa
  s = s.replace(
    /(?<![0-9])(\d{1,2}\.\d{1,2}\.\d{2})\s+(\d{1,2}:\d{2})\s*(DUTY|FSF|FOF|STBY[A-Z0-9]*)\b/gi,
    '\n$1 $2 $3',
  );
  // IATA + saat bitişik: SAW16:35
  s = s.replace(/\b([A-Z]{3})([01]?\d|2[0-3]):([0-5]\d)\b/g, '$1 $2:$3');
  // Saatten sonra uçuş numarası (aynı satırda yapışmış bloklar)
  s = s.replace(/(:[0-5]\d)\s+((?:PC|TK|AJ|XQ|XF|GT)\s*\d{2,4})\b/gi, '$1\n$2');
  // Uçuş numarası + IATA bitişik veya aynı satır: PC997SAW / PC 997 SAW
  s = s.replace(/\b((?:PC|TK|AJ|XQ|XF|GT)\s*\d{2,4})([A-Z]{3})\b/gi, '$1\n$2');
  s = s.replace(/\b((?:PC|TK|AJ|XQ|XF|GT)\s*\d{2,4})\s+([A-Z]{3})\b/gi, '$1\n$2');
  return s;
}

/** Pegasus duty roster (tarih+sütun blokları); bu formatta satır-taran Pegasus parser yanlış lastDate ile hayalet uçuş üretebilir. */
export function looksLikePegasusDutyStylePdf(text: string): boolean {
  const t = (text || '').replace(/\r\n/g, '\n');
  if (/\d{1,2}\.\d{1,2}\.\d{2}\d{1,2}:\d{2}(DUTY|FSF|FOF|STBY[A-Z0-9]*|\S*SIM)/i.test(t)) return true;
  if (/\d{1,2}\.\d{1,2}\.\d{4}\d{1,2}:\d{2}\S*SIM/i.test(t)) return true;
  if (/\d{1,2}\.\d{1,2}\.\d{2}\s+\d{1,2}:\d{2}\s+(DUTY|FSF|FOF|STBY)/i.test(t)) return true;
  return false;
}

/** THY ekip aylık programı (GMT tablosu + başlık). */
export function looksLikeThyCrewRosterPdf(text: string): boolean {
  const t = (text || '').replace(/\r\n/g, '\n');
  if (/EKIP\s+PLANLAMA\s+SISTEMI/i.test(t) && /\bTK\d{3,4}\b/.test(t)) return true;
  if (/AYLIK\s+UCUS\s+PROGRAMI/i.test(t) && /\bTK\d{3,4}\s+[A-Z]{3}\/\d{1,2}:\d{2}\s+[A-Z]{3}\/\d{1,2}[A-Z]{3}\d{4}/i.test(t))
    return true;
  /** Başlık metni farklı çıksa bile: TK + THY tipik varış `AAA/02APR2026` / yapışık saat. */
  if (/\bTK\d{3,4}\b/.test(t) && /[A-Z]{3}\/\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4}/i.test(t))
    return true;
  /** Sütun başlıkları / dönem satırı (metin çıkarıcı başlığı kırpmış olabilir). */
  if (
    /\bTK\d{3,4}\b/.test(t) &&
    /\b(GUNLER|KALKIS\/GMT|INIS\/GMT|PERIOD\s*:|MESAI\s+BASI|UCUS\s+PROGRAMI)\b/i.test(t)
  )
    return true;
  return false;
}

/** SunExpress aylık schedule (XQ + OFF/Report/Release kalıbı). */
export function looksLikeSunExpressSchedulePdf(text: string): boolean {
  const t = (text || '').replace(/\r\n/g, '\n');
  if (!/XQ\d{2,4}/i.test(t)) return false;
  if (/Sunday\s*Monday\s*Tuesday/i.test(t) && /Release/i.test(t) && /Report/i.test(t)) return true;
  if (/OFF/i.test(t) && /Release/i.test(t) && /Report/i.test(t)) return true;
  return false;
}

/**
 * Pegasus üst başlığı: `Active Plan : ... (L|Z)`
 * - L: Local saat
 * - Z: UTC saat
 */
export function detectPegasusPlanTimeBasis(text: string): 'L' | 'Z' | null {
  const t = (text || '').replace(/\r\n/g, '\n');
  const m = /\bActive\s*Plan\s*:[^\n]*\(([LZ])\)/i.exec(t);
  if (!m) return null;
  const v = (m[1] || '').toUpperCase();
  return v === 'L' || v === 'Z' ? (v as 'L' | 'Z') : null;
}
