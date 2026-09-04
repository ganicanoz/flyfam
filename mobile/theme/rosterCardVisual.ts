/**
 * Roster kart görünümü — surface gövde + sol accent + status badge token’ları.
 */
import { StyleSheet } from 'react-native';
import { colors, getThemeMode, type ThemeMode } from './colors';
import {
  cardAccent,
  statusChrome,
  type FlightStatusToken,
} from './tokens';

export type RosterCardVisualKind = 'flight' | 'duty_off' | 'standby' | 'in_flight' | 'landed';

export function resolveRosterCardVisualKind(args: {
  rosterEntryKind?: string | null;
  flightStatus?: string | null;
  isStandbyDutyCode?: boolean;
}): RosterCardVisualKind {
  const status = String(args.flightStatus ?? '').toLowerCase();
  const kind = String(args.rosterEntryKind ?? 'flight').toLowerCase();
  if (kind === 'duty_off') {
    return args.isStandbyDutyCode ? 'standby' : 'duty_off';
  }
  if (status === 'landed' || status === 'parked') return 'landed';
  if (status === 'en_route' || status === 'departed') return 'in_flight';
  return 'flight';
}

/** Map flight_status / visual → semantic badge token. */
export function resolveFlightStatusToken(args: {
  rosterEntryKind?: string | null;
  flightStatus?: string | null;
  isStandbyDutyCode?: boolean;
  delayMins?: number | null;
}): FlightStatusToken {
  const visual = resolveRosterCardVisualKind(args);
  if (visual === 'duty_off') return 'completed';
  if (visual === 'standby') return 'scheduled';
  if (visual === 'landed') return 'completed';
  if (visual === 'in_flight') return 'inFlight';
  if (args.delayMins != null && args.delayMins > 0) return 'delayed';
  const status = String(args.flightStatus ?? '').toLowerCase();
  if (status === 'cancelled') return 'cancelled';
  if (status === 'scheduled') return 'scheduled';
  return 'onTime';
}

export function rosterCardInk(mode?: ThemeMode) {
  const dark = (mode ?? getThemeMode()) === 'dark';
  return {
    primary: dark ? '#F3F6FB' : '#0F1B3D',
    secondary: dark ? '#C5D0E0' : '#4B5563',
    muted: dark ? '#9AA8BC' : '#6B7280',
    onAccent: colors.primary,
    error: colors.error,
    success: colors.success,
  };
}

/** FlatList / aile kartları: surface + border + left accent color. */
export function rosterCardChrome(
  visual: RosterCardVisualKind,
  mode?: ThemeMode,
): {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  accentColor: string;
} {
  const m = mode ?? getThemeMode();
  const accentKey =
    visual === 'duty_off'
      ? 'duty_off'
      : visual === 'standby'
        ? 'standby'
        : visual === 'in_flight'
          ? 'in_flight'
          : visual === 'landed'
            ? 'landed'
            : 'flight';
  return {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    accentColor: cardAccent(accentKey, m),
  };
}

export function rosterStatusBadge(
  token: FlightStatusToken,
  mode?: ThemeMode,
): { backgroundColor: string; color: string } {
  const chrome = statusChrome(token, mode ?? getThemeMode());
  return { backgroundColor: chrome.bg, color: chrome.text };
}

/** StyleSheet kart token’ları (tema ile) — gövde surface; accent ayrı. */
export function rosterCardStyleTokens(mode?: ThemeMode) {
  const m = mode ?? getThemeMode();
  return {
    flightBg: colors.surface,
    flightBorder: colors.border,
    offDutyBg: colors.surface,
    offDutyBorder: colors.border,
    standbyBg: colors.surface,
    standbyBorder: colors.border,
    inFlightBg: colors.surface,
    inFlightBorder: colors.border,
    landedBg: colors.surface,
    accentFlight: cardAccent('flight', m),
    accentDutyOff: cardAccent('duty_off', m),
    accentStandby: cardAccent('standby', m),
    accentInFlight: cardAccent('in_flight', m),
    accentLanded: cardAccent('landed', m),
  };
}

/** @deprecated — kept for import compatibility; prefer surface + accent. */
export const ROSTER_CARD_FLIGHT_BG = '#FFFFFF';
export const ROSTER_CARD_FLIGHT_BORDER = '#E5E9F0';
export const ROSTER_CARD_OFF_DUTY_BG = '#FFFFFF';
export const ROSTER_CARD_OFF_DUTY_BORDER = '#E5E9F0';
export const ROSTER_CARD_STANDBY_BG = '#FFFFFF';
export const ROSTER_CARD_STANDBY_BORDER = '#E5E9F0';
export const ROSTER_CARD_IN_FLIGHT_BG = '#FFFFFF';
export const ROSTER_CARD_IN_FLIGHT_BORDER = '#E5E9F0';
export const ROSTER_CARD_LANDED_BG = '#FFFFFF';
