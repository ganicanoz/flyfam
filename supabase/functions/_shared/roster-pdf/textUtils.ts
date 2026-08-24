/**
 * PDF satırından uçuş numarası / rota / saat çıkarma (tüm formatlar).
 */

/**
 * IATA tarzı uçuş no; PDF’te isim/rota parçalarını elemek için en az 5 karakter (ör. PF31 elenir, PC291 kalır).
 */
export function isLikelyFlightNumber(raw: string): boolean {
  const t = raw.replace(/\s/g, '').toUpperCase();
  if (t.length < 5 || t.length > 7) return false;
  return /^([A-Z]{2}\d{2,4}|[A-Z]{3}\d{2,4})$/.test(t);
}

/**
 * Satırdaki saatler: önce HH:MM; yoksa HH.MM (tarih parçası 20.03.2025 ile karışmaması için .YYYY reddedilir).
 * İki+ saat: ilki kalkış, ikinci iniş.
 * Aynı satırda en az iki `HH:MM (Z)` varsa Pegasus UTC tablosu — `isUtcPair: true`.
 */
export function extractTimesOnLine(line: string): { dep: string | null; arr: string | null; isUtcPair: boolean } {
  const zPattern = /\b([01]?\d|2[0-3]):([0-5]\d)\s*\([Zz]\)\b/g;
  const zMatches = [...line.matchAll(zPattern)];
  if (zMatches.length >= 2) {
    return {
      dep: `${zMatches[0]![1]!.padStart(2, '0')}:${zMatches[0]![2]}`,
      arr: `${zMatches[1]![1]!.padStart(2, '0')}:${zMatches[1]![2]}`,
      isUtcPair: true,
    };
  }
  const found: string[] = [];
  const timeColon = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  let mx: RegExpExecArray | null;
  while ((mx = timeColon.exec(line)) !== null) {
    found.push(`${mx[1]!.padStart(2, '0')}:${mx[2]}`);
  }
  if (found.length === 0) {
    const timeDot = /\b([01]?\d|2[0-3])\.([0-5]\d)(?!\.\d{4})/g;
    while ((mx = timeDot.exec(line)) !== null) {
      found.push(`${mx[1]!.padStart(2, '0')}:${mx[2]}`);
    }
  }
  if (found.length === 0) return { dep: null, arr: null, isUtcPair: false };
  if (found.length === 1) return { dep: found[0]!, arr: null, isUtcPair: false };
  return { dep: found[0]!, arr: found[1]!, isUtcPair: false };
}

/** Örn. IST-SAW, IST/SAW, IST → SAW (3 harf IATA). */
export function extractRouteOnLine(line: string): { origin: string | null; dest: string | null } {
  const arrow = /\b([A-Z]{3})\s*[-/→]\s*([A-Z]{3})\b/.exec(line.toUpperCase());
  if (arrow) return { origin: arrow[1]!, dest: arrow[2]! };
  return { origin: null, dest: null };
}
