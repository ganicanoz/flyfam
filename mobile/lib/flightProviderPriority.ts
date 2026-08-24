/** Uçuş durumu yenilemede harici API öncelikleri (maliyet / Edge ile aynı mantık). */

export type FlightPollPhaseForPriority = 'semi_active' | 'active';

const ACTIVE_ORDER_TR = [
  'FR24',
  'AeroDataBox (API Market)',
  'AeroDataBox (RapidAPI)',
  'AirLabs',
  'FlightAPI (AeroAPI)',
] as const;
const SEMI_ORDER_TR = [
  'AeroDataBox (API Market)',
  'AeroDataBox (RapidAPI)',
  'AirLabs',
  'FlightAPI (AeroAPI)',
] as const;

const ACTIVE_ORDER_EN = [
  'FR24',
  'AeroDataBox (API Market)',
  'AeroDataBox (RapidAPI)',
  'AirLabs',
  'FlightAPI (AeroAPI)',
] as const;
const SEMI_ORDER_EN = [
  'AeroDataBox (API Market)',
  'AeroDataBox (RapidAPI)',
  'AirLabs',
  'FlightAPI (AeroAPI)',
] as const;

export function getFlightProviderPriorityOrder(
  phase: FlightPollPhaseForPriority,
  locale: 'tr' | 'en',
): readonly string[] {
  if (phase === 'active') {
    return locale === 'tr' ? ACTIVE_ORDER_TR : ACTIVE_ORDER_EN;
  }
  return locale === 'tr' ? SEMI_ORDER_TR : SEMI_ORDER_EN;
}

/** Timetable zinciri: ilk “sağlıklı” cevaptan sonra sıradaki sağlayıcı çağrılmaz. */
export function timetableWaterfallPolicyNote(locale: 'tr' | 'en'): string {
  return locale === 'tr'
    ? 'Program (kalkış+varış) veya iptal/divert cevabı yeterli sayılırsa sıradaki timetable API’sine istek atılmaz.'
    : 'If the response is sufficient (dep+arr schedule, or cancelled/diverted), lower-priority timetable providers are not called.';
}

export function adminPrioritySectionTitle(locale: 'tr' | 'en'): string {
  return locale === 'tr' ? 'API önceliği (faz)' : 'API priority (phase)';
}
