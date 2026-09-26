/** Normalize API type codes (ICAO/IATA) for roster footer chips. */

export function normalizeAircraftTypeCode(raw: string | null | undefined): string | null {
  const c = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return c.length >= 3 && c.length <= 8 ? c : null;
}

/**
 * Roster satırı için kısa tip: A333→A330, B738→B737.
 * Bilinmeyen kodlar olduğu gibi (kısaltılmış) döner.
 */
export function formatAircraftTypeLabel(raw: string | null | undefined): string | null {
  const c = normalizeAircraftTypeCode(raw);
  if (!c) return null;
  if (/^A33[239]$/.test(c)) return 'A330';
  if (c === 'A339') return 'A330';
  if (c === 'A359' || c === 'A35K') return 'A350';
  if (c === 'A388') return 'A380';
  if (c === 'A319' || c === 'A318') return c;
  if (c === 'A320' || c === 'A20N') return 'A320';
  if (c === 'A321' || c === 'A21N') return 'A321';
  if (c === 'B737' || c === 'B738' || c === 'B739' || c === 'B73H' || c === 'B73W') return 'B737';
  if (c === 'B38M' || c === 'B39M') return 'B737';
  if (c === 'B788' || c === 'B789' || c === 'B78X') return 'B787';
  if (c === 'B772' || c === 'B77L' || c === 'B77W' || c === 'B773') return 'B777';
  if (c === 'B748' || c === 'B744' || c === 'B74F') return 'B747';
  if (c === 'E190' || c === 'E195' || c === 'E290' || c === 'E295') return c.slice(0, 4);
  return c;
}

export function formatAircraftFooterLine(
  typeRaw: string | null | undefined,
  regRaw: string | null | undefined,
): string | null {
  const type = formatAircraftTypeLabel(typeRaw);
  const reg = String(regRaw ?? '').trim().toUpperCase() || null;
  if (type && reg) return `${type} · ${reg}`;
  if (type) return type;
  if (reg) return reg;
  return null;
}
