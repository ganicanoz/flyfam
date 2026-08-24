/** FR24 flight object → tail registration (e.g. TC-JFK). */
export function fr24AircraftRegistrationFromFlight(f: unknown): string | undefined {
  const raw = f as Record<string, unknown>;
  for (const k of ['reg', 'registration', 'aircraft_registration', 'reg_number', 'reg_num', 'tail_number']) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toUpperCase();
  }
  return undefined;
}
