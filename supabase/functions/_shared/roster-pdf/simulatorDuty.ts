/**
 * Pegasus roster: SIM / IPT ve bunları içeren tüm occupation kodları simülatör görevi sayılır.
 */

export function isSimulatorOccupationCode(code: string | null | undefined): boolean {
  const u = (code ?? '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.includes('SIM')) return true;
  if (u.includes('IPT')) return true;
  return false;
}

/** DB `flight_number` — SIM türevleri çoğunlukla `SIM`, IPT içerenler `IPT`. */
export function simulatorFlightNumberLabel(code: string | null | undefined): string {
  const u = (code ?? '').replace(/\s/g, '').toUpperCase();
  if (u.includes('IPT')) return 'IPT';
  return 'SIM';
}

/** Regex alternation: yapışık duty başlığında SIM veya IPT içeren occupation. */
export const PEGASUS_SIM_OR_IPT_OCC = String.raw`\S*SIM|\S*IPT`;
