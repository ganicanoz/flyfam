import { AIRLINES, type Airline } from '../constants/airlines';

/**
 * Best-effort match from free-text company / airline name (onboarding, imports).
 */
export function matchAirlineByCompanyText(input: string): Airline | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  const byExactName = AIRLINES.find((a) => a.name.toLowerCase() === raw);
  if (byExactName) return byExactName;

  const byIcao = AIRLINES.find((a) => a.icao.toLowerCase() === raw);
  if (byIcao) return byIcao;

  const byIata = AIRLINES.find((a) => a.iata.toLowerCase() === raw);
  if (byIata) return byIata;

  const byNameContains = AIRLINES.find(
    (a) => raw.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(raw),
  );
  if (byNameContains) return byNameContains;

  return null;
}
