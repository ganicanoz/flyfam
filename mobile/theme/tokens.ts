/**
 * FlyFam design tokens — single source for spacing, radius, type, status, calendar.
 * Runtime theme colors still flow through `colors.ts` Proxy; import tokens for
 * layout / semantic status / calendar chrome that should not be hardcoded.
 */
import type { ThemeMode } from './colors';
import type { TextStyle } from 'react-native';

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  button: 12,
  card: 16,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F1B3D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  cardTitle: { fontSize: 17, fontWeight: '600' as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '500' as const, lineHeight: 18 },
  micro: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
  /** Saat / uçuş no — tabular figures. */
  tabularNums: { fontVariant: ['tabular-nums'] } as TextStyle,
};

export type FlightStatusToken =
  | 'scheduled'
  | 'onTime'
  | 'delayed'
  | 'cancelled'
  | 'inFlight'
  | 'completed';

type StatusChrome = { bg: string; text: string };

const STATUS_LIGHT: Record<FlightStatusToken, StatusChrome> = {
  scheduled: { bg: '#F1F3F7', text: '#4B5563' },
  onTime: { bg: '#E6F6EC', text: '#1B7F3B' },
  delayed: { bg: '#FFF1E0', text: '#B45309' },
  cancelled: { bg: '#FDECEC', text: '#B42318' },
  inFlight: { bg: '#E8F0FE', text: '#1A5CF5' },
  completed: { bg: '#F1F3F7', text: '#6B7280' },
};

const STATUS_DARK: Record<FlightStatusToken, StatusChrome> = {
  scheduled: { bg: '#243049', text: '#C5D0E0' },
  onTime: { bg: '#1A3324', text: '#7BC47F' },
  delayed: { bg: '#3A2A14', text: '#F0B060' },
  cancelled: { bg: '#3A1A1A', text: '#F07171' },
  inFlight: { bg: '#1A2740', text: '#4D7FFF' },
  completed: { bg: '#243049', text: '#9AA8BC' },
};

export function statusChrome(token: FlightStatusToken, mode: ThemeMode): StatusChrome {
  return mode === 'dark' ? STATUS_DARK[token] : STATUS_LIGHT[token];
}

/** Calendar day fills / accents (selected & today handled in UI). */
export const calendarLight = {
  flightDot: '#1A5CF5',
  dutyOffBg: '#E5E7EB',
  dutyOffText: '#4B5563',
  standbyBg: '#FFEDD5',
  standbyText: '#B45309',
  layoverBg: '#FCE7F3',
  layoverText: '#BE185D',
  emptyBg: 'transparent',
  emptyBorder: '#E5E9F0',
} as const;

export const calendarDark = {
  flightDot: '#4D7FFF',
  dutyOffBg: '#2A3344',
  dutyOffText: '#C5D0E0',
  standbyBg: '#3A2A14',
  standbyText: '#F0B060',
  layoverBg: '#3A1A2A',
  layoverText: '#F9A8D4',
  emptyBg: 'transparent',
  emptyBorder: '#243049',
} as const;

export function calendarTokens(mode: ThemeMode) {
  return mode === 'dark' ? calendarDark : calendarLight;
}

/** Left accent on roster cards (surface body stays white/surface). */
export const cardAccentLight = {
  flight: '#1A5CF5',
  duty_off: '#94A3B8',
  standby: '#F59E0B',
  in_flight: '#1D4ED8',
  landed: '#16A34A',
  layover: '#EC4899',
} as const;

export const cardAccentDark = {
  flight: '#4D7FFF',
  duty_off: '#9AA8BC',
  standby: '#F0B060',
  in_flight: '#6BB3FF',
  landed: '#7BC47F',
  layover: '#F9A8D4',
} as const;

export function cardAccent(
  kind: keyof typeof cardAccentLight,
  mode: ThemeMode,
): string {
  return mode === 'dark' ? cardAccentDark[kind] : cardAccentLight[kind];
}

export const touchMin = 44;
