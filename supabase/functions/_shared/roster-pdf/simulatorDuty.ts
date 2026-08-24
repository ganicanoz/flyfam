/**
 * Pegasus roster: SIM / IPT ve türevleri simülatör görevi sayılır.
 */

export function isSimulatorOccupationCode(code: string | null | undefined): boolean {
  const u = (code ?? '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.includes('SIM')) return true;
  if (u === 'IPT' || /^IPT[A-Z0-9_-]*$/.test(u)) return true;
  return false;
}

/** DB `flight_number` — SIM türevleri çoğunlukla `SIM`, IPT için `IPT`. */
export function simulatorFlightNumberLabel(code: string | null | undefined): string {
  const u = (code ?? '').replace(/\s/g, '').toUpperCase();
  if (u === 'IPT' || /^IPT[A-Z0-9_-]*$/.test(u)) return 'IPT';
  return 'SIM';
}

/** Regex alternation: yapışık duty başlığında SIM veya IPT occupation. */
export const PEGASUS_SIM_OR_IPT_OCC = String.raw`\S*SIM|IPT`;
