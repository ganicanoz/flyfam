/**
 * Roster kart görünümü — crew ve family aynı (Roster.tsx + aile yedek listeleri).
 */
import { StyleSheet } from 'react-native';
import { colors, getThemeMode, type ThemeMode } from './colors';

const LIGHT = {
  flightBg: '#EEEEF0',
  flightBorder: '#C8C8CC',
  offDutyBg: '#E8F5E9',
  offDutyBorder: '#A5D6A7',
  standbyBg: '#FFF3E0',
  standbyBorder: '#FFCC80',
  inFlightBg: '#E3F2FD',
  inFlightBorder: '#5AA6FF',
  landedBg: '#E8F5E9',
} as const;

/** Dark: hafif açık yüzeyler — arka plandan ayrışır, metin açık kalır. */
const DARK = {
  flightBg: '#252C38',
  flightBorder: '#3F4D62',
  offDutyBg: '#1E3026',
  offDutyBorder: '#4F7A5C',
  standbyBg: '#352A1C',
  standbyBorder: '#C48A44',
  inFlightBg: '#1C3048',
  inFlightBorder: '#6BB3FF',
  landedBg: '#1E3026',
} as const;

export const ROSTER_CARD_FLIGHT_BG = LIGHT.flightBg;
export const ROSTER_CARD_FLIGHT_BORDER = LIGHT.flightBorder;
export const ROSTER_CARD_OFF_DUTY_BG = LIGHT.offDutyBg;
export const ROSTER_CARD_OFF_DUTY_BORDER = LIGHT.offDutyBorder;
export const ROSTER_CARD_STANDBY_BG = LIGHT.standbyBg;
export const ROSTER_CARD_STANDBY_BORDER = LIGHT.standbyBorder;
export const ROSTER_CARD_IN_FLIGHT_BG = LIGHT.inFlightBg;
export const ROSTER_CARD_IN_FLIGHT_BORDER = LIGHT.inFlightBorder;
export const ROSTER_CARD_LANDED_BG = LIGHT.landedBg;

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

function palette(mode?: ThemeMode) {
  return (mode ?? getThemeMode()) === 'dark' ? DARK : LIGHT;
}

/** Kart içi metin — StyleSheet’e gömülmesin; her render’da tema ile. */
export function rosterCardInk(mode?: ThemeMode) {
  const dark = (mode ?? getThemeMode()) === 'dark';
  return {
    primary: dark ? '#F4F7FC' : '#0B1220',
    secondary: dark ? '#C5D0E0' : '#22324C',
    muted: dark ? '#9AADBF' : '#6B7A90',
    onAccent: colors.primary,
    error: colors.error,
    success: colors.success,
  };
}

/** FlatList / basit aile kartları için chrome (background + border). */
export function rosterCardChrome(
  visual: RosterCardVisualKind,
  mode?: ThemeMode,
): {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
} {
  const p = palette(mode);
  switch (visual) {
    case 'duty_off':
      return {
        backgroundColor: p.offDutyBg,
        borderColor: p.offDutyBorder,
        borderWidth: StyleSheet.hairlineWidth,
      };
    case 'standby':
      return {
        backgroundColor: p.standbyBg,
        borderColor: p.standbyBorder,
        borderWidth: StyleSheet.hairlineWidth,
      };
    case 'in_flight':
      return {
        backgroundColor: p.inFlightBg,
        borderColor: p.inFlightBorder,
        borderWidth: 2,
      };
    case 'landed':
      return {
        backgroundColor: p.landedBg,
        borderColor: colors.success,
        borderWidth: 2,
      };
    case 'flight':
    default:
      return {
        backgroundColor: p.flightBg,
        borderColor: p.flightBorder,
        borderWidth: StyleSheet.hairlineWidth,
      };
  }
}

/** Roster StyleSheet kart token’ları (tema ile). */
export function rosterCardStyleTokens(mode?: ThemeMode) {
  const p = palette(mode);
  return {
    flightBg: p.flightBg,
    flightBorder: p.flightBorder,
    offDutyBg: p.offDutyBg,
    offDutyBorder: p.offDutyBorder,
    standbyBg: p.standbyBg,
    standbyBorder: p.standbyBorder,
    inFlightBg: p.inFlightBg,
    inFlightBorder: p.inFlightBorder,
    landedBg: p.landedBg,
  };
}
