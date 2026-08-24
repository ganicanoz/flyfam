/** FR24 planı bazen offset olmadan / yanlış bacakla gelir; TR↔PK gerçek uçuşlar genelde ≥3 saat. */

export const MIN_BLOCK_HOURS_TURKEY_PAKISTAN = 3;

export function isTurkeyAirportIcaoIata(code: string): boolean {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.startsWith('LT')) return true;
  return ['SAW', 'IST', 'AYT', 'ADB', 'ESB', 'BJV', 'DLM', 'TZX', 'ADA', 'COV', 'CKZ', 'MLX', 'EZS'].includes(u);
}

export function isPakistanAirportIcaoIata(code: string): boolean {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.startsWith('OP')) return true;
  return ['KHI', 'ISB', 'LHE'].includes(u);
}

export function fr24TurkeyPakistanScheduleTooShort(
  origin: string,
  dest: string,
  depIso: string | undefined,
  arrIso: string | undefined,
): boolean {
  if (!depIso || !arrIso) return false;
  const o = origin.replace(/\s/g, '').toUpperCase();
  const d = dest.replace(/\s/g, '').toUpperCase();
  const pair =
    (isTurkeyAirportIcaoIata(o) && isPakistanAirportIcaoIata(d)) ||
    (isPakistanAirportIcaoIata(o) && isTurkeyAirportIcaoIata(d));
  if (!pair) return false;
  const t0 = new Date(depIso).getTime();
  const t1 = new Date(arrIso).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return false;
  return (t1 - t0) / (3600 * 1000) < MIN_BLOCK_HOURS_TURKEY_PAKISTAN;
}
