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

/** Planlı / gecikmeli / iptal vb. durum rozetleri. */
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

/**
 * Roster calendar marks + compact-card kind badges.
 * Cells stay white; dots/lines carry meaning (no pastel day fills).
 */
export const rosterMarksLight = {
  /** Katman 1 — uçuş günü tek nokta */
  flightDot: '#E53935',
  /** Katman 2 — birleşik çizgiler */
  layoverLine: '#F48FB1',
  standbyLine: '#F59E0B',
  offLine: '#22A55B',
  /** Kompakt kart rozetleri */
  offBadgeBg: '#E6F6EC',
  offBadgeText: '#1B7F3B',
  standbyBadgeBg: '#FFF1E0',
  standbyBadgeText: '#B45309',
  layoverBadgeBg: '#FCE4EC',
  layoverBadgeText: '#AD1457',
  /** Ortak boş gün ✓ (karşılaştırma) */
  sharedOffMark: '#1B7F3B',
  sharedOffBannerBg: '#E6F6EC',
  sharedOffBannerBorder: '#B7E4C7',
  sharedOffBannerText: '#1B7F3B',
} as const;

export const rosterMarksDark = {
  flightDot: '#EF5350',
  layoverLine: '#F8BBD0',
  standbyLine: '#F0B060',
  offLine: '#4ADE80',
  offBadgeBg: '#1A3324',
  offBadgeText: '#7BC47F',
  standbyBadgeBg: '#3A2A14',
  standbyBadgeText: '#F0B060',
  layoverBadgeBg: '#3A1A2A',
  layoverBadgeText: '#F9A8D4',
  sharedOffMark: '#7BC47F',
  sharedOffBannerBg: '#1A3324',
  sharedOffBannerBorder: '#2D5A3D',
  sharedOffBannerText: '#7BC47F',
} as const;

export function rosterMarks(mode: ThemeMode) {
  return mode === 'dark' ? rosterMarksDark : rosterMarksLight;
}

/**
 * Calendar chrome — white cells; marks come from `rosterMarks`.
 * Pastel day fills removed; keep border/empty helpers only.
 */
export const calendarLight = {
  flightDot: rosterMarksLight.flightDot,
  layoverLine: rosterMarksLight.layoverLine,
  standbyLine: rosterMarksLight.standbyLine,
  offLine: rosterMarksLight.offLine,
  /** @deprecated pastel fills — do not use for day backgrounds */
  dutyOffBg: 'transparent',
  dutyOffText: '#0F1B3D',
  standbyBg: 'transparent',
  standbyText: '#0F1B3D',
  layoverBg: 'transparent',
  layoverText: '#0F1B3D',
  emptyBg: 'transparent',
  emptyBorder: '#E5E9F0',
} as const;

export const calendarDark = {
  flightDot: rosterMarksDark.flightDot,
  layoverLine: rosterMarksDark.layoverLine,
  standbyLine: rosterMarksDark.standbyLine,
  offLine: rosterMarksDark.offLine,
  dutyOffBg: 'transparent',
  dutyOffText: '#F3F6FB',
  standbyBg: 'transparent',
  standbyText: '#F3F6FB',
  layoverBg: 'transparent',
  layoverText: '#F3F6FB',
  emptyBg: 'transparent',
  emptyBorder: '#243049',
} as const;

export function calendarTokens(mode: ThemeMode) {
  return mode === 'dark' ? calendarDark : calendarLight;
}

/** Left accent on roster cards (surface body stays white/surface). */
export const cardAccentLight = {
  flight: '#1A5CF5',
  duty_off: rosterMarksLight.offLine,
  standby: rosterMarksLight.standbyLine,
  in_flight: '#1D4ED8',
  landed: '#16A34A',
  layover: rosterMarksLight.layoverLine,
} as const;

export const cardAccentDark = {
  flight: '#4D7FFF',
  duty_off: rosterMarksDark.offLine,
  standby: rosterMarksDark.standbyLine,
  in_flight: '#6BB3FF',
  landed: '#7BC47F',
  layover: rosterMarksDark.layoverLine,
} as const;

export function cardAccent(
  kind: keyof typeof cardAccentLight,
  mode: ThemeMode,
): string {
  return mode === 'dark' ? cardAccentDark[kind] : cardAccentLight[kind];
}

export const touchMin = 44;

/** Calendar mark geometry (px). */
export const calendarMarkSize = {
  dot: 6,
  barHeight: 4,
  cellBottomGap: 2,
} as const;

/** Roster list / card spacing (px). */
export const rosterListSpacing = {
  cardGapSameDay: 8,
  dayGroupGap: 18,
  cardPadding: 14,
  fabSize: 56,
  listBottomPad: 56 + 16,
} as const;
