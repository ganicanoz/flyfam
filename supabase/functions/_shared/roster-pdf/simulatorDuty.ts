/**
 * Pegasus roster: SIM / IPT / CPI ve bunları içeren occupation kodları simülatör görevi sayılır.
 */

export function isSimulatorOccupationCode(code: string | null | undefined): boolean {
  const u = (code ?? '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.includes('SIM')) return true;
  if (u.includes('IPT')) return true;
  // CPI1, CPI2, CPIX… — PDF’de CPI başlığı altında simülatör
  if (u.startsWith('CPI')) return true;
  return false;
}

/** DB `flight_number` — SIM / IPT / CPI başlık etiketleri. */
export function simulatorFlightNumberLabel(code: string | null | undefined): string {
  const u = (code ?? '').replace(/\s/g, '').toUpperCase();
  if (u.includes('IPT')) return 'IPT';
  if (u.startsWith('CPI')) return 'CPI';
  return 'SIM';
}

/** Regex alternation: yapışık duty başlığında SIM, IPT veya CPI* occupation. */
export const PEGASUS_SIM_OR_IPT_OCC = String.raw`\S*SIM|\S*IPT|CPI[A-Z0-9]*`;
