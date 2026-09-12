import React, { useState, useCallback, useLayoutEffect, useRef, useEffect, useMemo, startTransition } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  AppState,
  Platform,
  InteractionManager,
  Dimensions,
  Pressable,
  LayoutAnimation,
  UIManager,
  Modal,
  type AppStateStatus,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addCalendarDaysToYmd,
  calendarDateFromUtcIsoInTimeZone,
  formatFlightDateTr,
  formatFlightTimeInTz,
  formatFlightTimeLocal,
  formatFlightTimeUTC,
  formatUtcCalendarDateLabel,
  getCalendarDateStringInTimeZone,
  getDeviceIanaTimeZone,
  getLocalDateString,
  getLocalDateStringPlusDays,
  getUtcDateString,
  getUtcDateStringPlusDays,
  parseFlightTimeAsUtc,
  utcCalendarDateFromIso,
  utcInstantForCalendarYmdInTimeZone,
} from '../lib/dateUtils';
import { regionCodeForIanaTimeZone } from '../lib/flightDisplayTime';
import { fetchFlightByNumber, fr24UrlForAircraftRegistration, getFr24DeepLink } from '../lib/flightApi';
import { pollFlightForRoster } from '../lib/flightStatusPoll';
import { notifyFamilyTodayFlights } from '../lib/notifyFamily';
import { setRosterLastSharedAt } from '../lib/rosterShareMeta';
import { rosterOccupationLabelEn, rosterOccupationLabelTr, isOccupationCodeDefined } from '../lib/rosterOccupationLabels';
import {
  hydrateLocalOccupationOverrides,
  setLocalOccupationOverride,
  subscribeLocalOccupationOverrides,
} from '../lib/rosterOccupationLocalOverrides';
import { SuggestOccupationModal } from '../components/SuggestOccupationModal';
import { isOffDayOccupationCode, isAnnualLeaveOccupationCode, isUnpaidLeaveOccupationCode, isGroundDutyOccupationCode, isOfficeDutyOccupationCode, isStandbyOccupationCode, isTrainingOccupationCode, isRosterPdfImportSupportedForCrewAirline } from '../lib/pdfRosterImport';
import {
  indigoDutyBlockTitleEn,
  indigoDutyBlockTitleTr,
  indigoRosterTrainingDetailDisplay,
  shouldUseIndigoRosterLabels,
} from '../lib/indigoRosterLabels';
import { loadFamilyRosterListShow } from '../lib/familyRosterListPrefs';
import { normalizeRosterListShow, rosterListRowVisible, type RosterListShowPrefs } from '../lib/rosterListPreferences';
import {
  airborneFromLiveFields,
  computeApiRefreshPhase,
  isApiRefreshPhasePolling,
  landedFromRow,
  type ApiRefreshPhase,
} from '../lib/flightApiRefreshPhase';
import {
  ARRIVAL_LATE_THRESHOLD_MIN,
  significantArrivalSkewMins,
} from '../lib/flightDelayThreshold';
import { RosterListTasksModal } from '../components/RosterListTasksModal';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { ClearFlightsConfirmModal } from '../components/ClearFlightsConfirmModal';
import FlightOperationOverlay from '../components/FlightOperationOverlay';
import {
  isLiveAirborneFlight,
} from '../lib/rosterFlightClear';
import { getAirportDisplay, getAirportTimezone } from '../constants/airports';
import { colors, useThemeMode } from '../theme/colors';
import {
  rosterCardStyleTokens,
  rosterCardInk,
} from '../theme/rosterCardVisual';
import { calendarMarkSize, calendarTokens, radius, rosterListSpacing, rosterMarks, statusChrome } from '../theme/tokens';
import { RosterFlightCard } from '../components/roster/RosterFlightCard';
import { useFontScaleMultiplier } from '../theme/fontScale';
import { fetchMySubscriptionAccess, fetchCrewRosterAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';
import { isSimulatorOccupationCode } from '../lib/pdfRosterImport';
import { setRosterLastSyncedAt, getRosterLastSyncedAt, subscribeRosterLastSyncedAt, hydrateRosterLastSyncedAt } from '../lib/rosterSyncMeta';
import { formatRelativeSyncedAt } from '../lib/relativeTime';
import { demoPeersForUser } from '../lib/crewPeerDemo';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** En eski dün: herkes dünün uçuşlarını görür; dünden öncekiler silinir. */
const ROSTER_MIN_DAYS_AGO = 1; // 1 = yesterday (show flight_date >= yesterday)
/** Üst tarih şeridi + liste: bugünden en fazla bu kadar ileri gün (dahil). */
const ROSTER_MAX_DAYS_AHEAD = 30;

/** Takvimde geçmiş gün renkleri: uçuş silinse bile ~2 ay işaret kalsın. */
const CALENDAR_DAY_MARKS_RETENTION_DAYS = 62;
function calendarDayMarksStorageKey(userKey: string): string {
  return `flyfam.calendarDayMarks.v1:${userKey}`;
}

const LAYOVER_PLACEHOLDER_FN = 'LAYOVER';

type CalendarDayKind = 'empty' | 'flight' | 'standby' | 'duty_off' | 'layover';

function calendarDayKindForEntry(f: {
  roster_entry_kind?: string | null;
  flight_number?: string | null;
  duty_occupation_code?: string | null;
  id?: string | null;
}): CalendarDayKind {
  const blockCode = (f.flight_number || '').trim().toUpperCase();
  const occCode = (f.duty_occupation_code || '').trim().toUpperCase();
  if (isLayoverPlaceholder(f) || blockCode === LAYOVER_PLACEHOLDER_FN) return 'layover';
  const isSim =
    f.roster_entry_kind === 'sim' ||
    isSimulatorOccupationCode(blockCode) ||
    isSimulatorOccupationCode(occCode);
  if (isSim) return 'duty_off';
  // Yer dersi / ofis: görev — takvimde kırmızı (uçuş günü).
  if (isGroundDutyOccupationCode(blockCode) || isGroundDutyOccupationCode(occCode)) {
    return 'flight';
  }
  // MSF/FSF/FOF vb. — kind flight yazılmış olsa bile takvimde boş gün.
  if (isOffDayOccupationCode(blockCode) || isOffDayOccupationCode(occCode)) {
    return 'duty_off';
  }
  const isDutyOff = f.roster_entry_kind === 'duty_off';
  if (isDutyOff) return isStandbyOccupationCode(blockCode) || isStandbyOccupationCode(occCode) ? 'standby' : 'duty_off';
  return 'flight';
}

/** Gün rengi önceliği: layover > uçuş > nöbet > izin/off > boş. */
function mergeCalendarDayKind(prev: CalendarDayKind | undefined, next: CalendarDayKind): CalendarDayKind {
  const rank = { empty: 0, duty_off: 1, standby: 2, flight: 3, layover: 4 } as const;
  if (!prev) return next;
  return rank[next] >= rank[prev] ? next : prev;
}

const LAYOVER_MIN_HOURS = 10;

type LayoverWindow = {
  key: string;
  station: string;
  startYmd: string;
  endYmd: string;
  inboundId: string;
  outboundId: string;
};

function isLayoverPlaceholder(f: { id?: string | null; flight_number?: string | null }): boolean {
  const id = String(f.id ?? '');
  const fn = (f.flight_number ?? '').trim().toUpperCase();
  return id.startsWith('layover:') || fn === LAYOVER_PLACEHOLDER_FN;
}

function isoToYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function minYmd(a: string, b: string | null | undefined): string {
  if (!b) return a;
  return b < a ? b : a;
}

function maxYmd(a: string, b: string | null | undefined): string {
  if (!b) return a;
  return b > a ? b : a;
}

/**
 * A layover is a stay at a non-home station until the next departure from that
 * station (≥ LAYOVER_MIN_HOURS). Calendar paints the full gidiş–dönüş span
 * (flight_date + schedule days) so 20–22 LED becomes one merged block.
 * `homeBaseIata` — tek IATA veya aile/peer için birden fazla (görüntülenen crew base’leri).
 */
function computeLayoverWindows(
  flights: readonly {
    id: string;
    flight_date: string;
    origin_airport: string | null;
    destination_airport: string | null;
    scheduled_departure: string | null;
    scheduled_arrival: string | null;
    roster_entry_kind?: string | null;
    flight_number?: string | null;
  }[],
  homeBaseIata?: string | null | readonly string[],
): LayoverWindow[] {
  const realFlights = flights.filter(
    (f) =>
      (f.roster_entry_kind ?? 'flight') === 'flight' &&
      f.destination_airport &&
      !isLayoverPlaceholder(f),
  );
  const homeBases = (
    Array.isArray(homeBaseIata)
      ? homeBaseIata
      : homeBaseIata
        ? [homeBaseIata]
        : []
  )
    .map((b) => (b ?? '').trim().toUpperCase())
    .filter(Boolean);
  const homeBaseCities = new Set(
    homeBases
      .map((b) => getAirportDisplay(b)?.city?.trim().toLowerCase() ?? null)
      .filter((c): c is string => !!c),
  );
  const windows: LayoverWindow[] = [];
  const usedOutbound = new Set<string>();

  for (const inbound of realFlights) {
    const station = (inbound.destination_airport ?? '').trim().toUpperCase();
    if (!station) continue;
    const stationCity = getAirportDisplay(station)?.city?.trim().toLowerCase() ?? null;
    if (homeBases.includes(station)) continue;
    if (stationCity && homeBaseCities.has(stationCity)) continue;
    const arrMs = parseUtcMsStatic(inbound.scheduled_arrival);
    if (!arrMs) continue;

    let outbound: (typeof realFlights)[number] | null = null;
    let depMs: number | null = null;
    for (const cand of realFlights) {
      if (cand.id === inbound.id || usedOutbound.has(cand.id)) continue;
      const origin = (cand.origin_airport ?? '').trim().toUpperCase();
      if (origin !== station) continue;
      const ms = parseUtcMsStatic(cand.scheduled_departure);
      if (!ms || ms <= arrMs) continue;
      if (depMs == null || ms < depMs) {
        depMs = ms;
        outbound = cand;
      }
    }
    if (!outbound || depMs == null) continue;
    const gapHours = (depMs - arrMs) / (1000 * 60 * 60);
    if (gapHours < LAYOVER_MIN_HOURS) continue;

    const startYmd = minYmd(inbound.flight_date, isoToYmd(inbound.scheduled_arrival));
    const endYmd = maxYmd(outbound.flight_date, isoToYmd(outbound.scheduled_departure));
    if (!startYmd || !endYmd || endYmd < startYmd) continue;
    usedOutbound.add(outbound.id);
    windows.push({
      key: `${station}|${startYmd}|${endYmd}|${inbound.id}|${outbound.id}`,
      station,
      startYmd,
      endYmd,
      inboundId: inbound.id,
      outboundId: outbound.id,
    });
  }
  return windows;
}

function layoverDatesFromWindows(windows: readonly LayoverWindow[]): Set<string> {
  const dates = new Set<string>();
  for (const w of windows) {
    let cur = w.startYmd;
    while (cur <= w.endYmd) {
      dates.add(cur);
      cur = addUtcDaysToYmd(cur, 1);
    }
  }
  return dates;
}

const CALENDAR_COL_H = 48;
const CALENDAR_DAY_RADIUS = 10;
const CALENDAR_BAR_H = calendarMarkSize.barHeight;
const CALENDAR_DOT_SIZE = calendarMarkSize.dot;
/** Nokta ile çubuk arası — absolute marker satırında kompakt. */
const CALENDAR_DOT_BAR_GAP = 2;
const CALENDAR_BAR_INSET = calendarMarkSize.barInset;
const CALENDAR_MARK_BOTTOM = 3;
const CALENDAR_RANGE_DAYS_BACK = 30;
const CALENDAR_RANGE_DAYS_AHEAD = 45;

type CalendarDayCell = { ymd: string; day: number };

function formatUtcYmd(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function addUtcDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatUtcYmd(dt);
}

function mondayYmdOf(ymd: string): string | null {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  noon.setUTCDate(noon.getUTCDate() - ((noon.getUTCDay() + 6) % 7));
  return formatUtcYmd(noon);
}

function weekCellsFromMonday(mondayYmd: string): CalendarDayCell[] {
  return Array.from({ length: 7 }, (_, i) => {
    const ymd = addUtcDaysToYmd(mondayYmd, i);
    return { ymd, day: parseInt(ymd.slice(8, 10), 10) };
  });
}

function weeksCoveringRange(startYmd: string, endYmd: string): CalendarDayCell[][] {
  const startMonday = mondayYmdOf(startYmd);
  const endMonday = mondayYmdOf(endYmd);
  if (!startMonday || !endMonday) return [];
  const weeks: CalendarDayCell[][] = [];
  let cur = startMonday;
  while (cur <= endMonday) {
    weeks.push(weekCellsFromMonday(cur));
    cur = addUtcDaysToYmd(cur, 7);
  }
  return weeks;
}

/** Seçili ayı (YYYY-MM) tamamen kapsayan Pazartesi hafta satırları — 4–6 satır. */
function weeksCoveringMonth(ym: string): CalendarDayCell[][] {
  const [y, m] = ym.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return [];
  const first = `${ym}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${ym}-${String(lastDay).padStart(2, '0')}`;
  return weeksCoveringRange(first, last);
}

function shiftYm(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym;
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function clampDayInYm(ymd: string, ym: string): string {
  const day = parseInt(ymd.slice(8, 10), 10);
  const [y, m] = ym.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(day) || !Number.isFinite(y) || !Number.isFinite(m)) return `${ym}-01`;
  const max = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(Math.min(Math.max(1, day), max)).padStart(2, '0')}`;
}

function dominantMonthFromWeeks(weeks: CalendarDayCell[][], preferYm?: string): string {
  const counts = new Map<string, number>();
  for (const week of weeks) {
    for (const cell of week) {
      const ym = cell.ymd.slice(0, 7);
      counts.set(ym, (counts.get(ym) ?? 0) + 1);
    }
  }
  let bestYm = '';
  let bestN = -1;
  for (const [ym, n] of counts) {
    if (n > bestN || (n === bestN && preferYm && ym === preferYm)) {
      bestYm = ym;
      bestN = n;
    }
  }
  return bestYm;
}

function isCalendarBlockKind(kind: CalendarDayKind): kind is 'layover' | 'duty_off' {
  return kind === 'layover' || kind === 'duty_off';
}

function parseUtcMsStatic(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return 0;
  let s = iso.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return 0;
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) s = s.replace(/\.\d+$/, '') + (s.includes('.') ? 'Z' : '.000Z');
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function monthLabelFromYm(yyyyMm: string, locale: string, style: 'long' | 'short' = 'long'): string {
  const [yStr, mStr] = yyyyMm.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyyMm;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(locale, {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

function monthAbbrevFromYmd(ymd: string, locale: string): string {
  return monthLabelFromYm(ymd.slice(0, 7), locale, 'short');
}

/** Roster’da gecikme metni / takvim rengi: 20 dk ve altı hiç gösterilmez (kaynak fark etmez). */
const ROSTER_DELAY_DISPLAY_MIN_EXCLUSIVE = 20;

/** FR24 first_seen − STD, dakika; yalnızca fark > 20 dk (gösterim eşiği ile aynı). */
function departureDelayMinutesFirstSeenAfterStd(
  scheduledDepartureIso: string | null | undefined,
  fr24FirstSeenUtc: string | null | undefined,
): number | null {
  const fsMs = parseFlightTimeAsUtc(fr24FirstSeenUtc)?.getTime() ?? 0;
  const stdMs = parseFlightTimeAsUtc(scheduledDepartureIso)?.getTime() ?? 0;
  if (!fsMs || !stdMs || fsMs <= stdMs) return null;
  const gapMin = Math.round((fsMs - stdMs) / 60_000);
  return gapMin > ROSTER_DELAY_DISPLAY_MIN_EXCLUSIVE ? gapMin : null;
}

/** DB self-heal (toLanded): iptal / divert / olay pasif_geçmiş olsa bile landed'e yazılmasın. */
function terminalNoReschedule(flightStatus: string | null | undefined): boolean {
  const x = (flightStatus ?? '').toLowerCase();
  return x === 'cancelled' || x === 'canceled' || x === 'diverted' || x === 'incident' || x === 'redirected';
}

/** Varış/saat için ms döndürür. Önce actual_arrival/scheduled_arrival (ISO); yoksa date-only YYYY-MM-DD ise o gün 23:59 UTC. */
function getArrivalMs(f: { actual_arrival?: string | null; scheduled_arrival?: string | null; flight_date?: string | null }): number {
  let ms = parseUtcMsStatic(f.actual_arrival) || parseUtcMsStatic(f.scheduled_arrival);
  if (ms > 0) return ms;
  const dateStr = typeof f.flight_date === 'string' ? f.flight_date.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z').getTime();
    return Number.isNaN(endOfDay) ? 0 : endOfDay;
  }
  return 0;
}

/** Uçuş kartı sağ üst faz noktası: pasif gelecek gri, pasif geçmiş siyah, yarı aktif turuncu, aktif yeşil. */
function apiRefreshPhaseDotColor(phase: ApiRefreshPhase, isDark = false): string {
  switch (phase) {
    case 'passive_future':
    case 'passive_upcoming':
      return isDark ? '#9AA8BC' : '#9CA3AF';
    case 'passive_past':
    case 'passive_complete':
      return isDark ? '#E2E8F0' : '#171717';
    case 'semi_active':
      return '#EA580C';
    case 'active':
      return isDark ? '#7BC47F' : '#16A34A';
    default:
      return isDark ? '#9AA8BC' : '#9CA3AF';
  }
}

function isMissingColumn(errMsg: string | undefined | null, column: string): boolean {
  if (!errMsg) return false;
  const m = String(errMsg).toLowerCase();
  const c = String(column).toLowerCase();
  // Supabase/PostgREST error messages vary:
  // - "Could not find the 'airlabs_progress_percent' column"
  // - "column flights.airlabs_progress_percent does not exist"
  return m.includes(c) && (m.includes('could not find') || m.includes('does not exist'));
}

function extractMissingColumnName(errMsg: string | undefined | null): string | null {
  if (!errMsg) return null;
  const msg = String(errMsg);
  // Examples:
  // - Could not find the 'airlabs_progress_percent' column of 'flights' in the schema cache
  // - column flights.api_refresh_phase does not exist
  const quoted = msg.match(/'([a-zA-Z0-9_]+)'/);
  if (quoted?.[1]) return quoted[1];
  const dotted = msg.match(/column\s+[a-zA-Z0-9_]+\.(\w+)\s+does not exist/i);
  if (dotted?.[1]) return dotted[1];
  return null;
}

/** DB `flights_internal_status_check` — API’den yazılan `flight_status` ile iç statüyü aynı hizada tut. */
function internalStatusMirrorFromApiFlightStatus(fs: string | null | undefined): string | undefined {
  if (fs == null) return undefined;
  const s = String(fs).toLowerCase();
  if (s === 'parked') return 'landed';
  if (s === 'departed') return 'en_route';
  if (['scheduled', 'taxi_out', 'en_route', 'landed', 'cancelled'].includes(s)) return s;
  if (s === 'canceled') return 'cancelled';
  return 'scheduled';
}

/** Crew roster: full `flights` select (must match all call sites + strip helpers below). */
const CREW_ROSTER_FLIGHT_SELECT_COLS =
  'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, delay_dep_min, delay_arr_min, is_delayed, flight_status, internal_status, diverted_to, api_refresh_phase, phase_active_locked, estimated_departure, estimated_arrival, roster_entry_kind, duty_rest_end, roster_detail, aircraft_registration, aircraft_type, fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent';

const CREW_ROSTER_FR24_AIRLABS_COLS_FRAGMENT =
  ', fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent';

/** Drop columns PostgREST says are missing; caller retries until select succeeds or nothing changes. */
function stripCrewRosterFlightSelectForError(selectCols: string, errMsg: string | undefined | null): string {
  if (!errMsg) return selectCols;
  let c = selectCols;
  if (isMissingColumn(errMsg, 'actual_departure') || isMissingColumn(errMsg, 'actual_arrival')) {
    c = c.replace(', actual_departure, actual_arrival', '');
  }
  if (isMissingColumn(errMsg, 'diverted_to')) {
    c = c.replace(', diverted_to', '');
  }
  if (isMissingColumn(errMsg, 'phase_active_locked') || isMissingColumn(errMsg, 'estimated_departure')) {
    c = c.replace(', phase_active_locked, estimated_departure', '');
  }
  if (isMissingColumn(errMsg, 'estimated_arrival')) {
    c = c.replace(', estimated_arrival', '');
  }
  if (isMissingColumn(errMsg, 'internal_status')) {
    c = c.replace(', internal_status', '');
  }
  if (isMissingColumn(errMsg, 'api_refresh_phase')) {
    c = c.replace(', api_refresh_phase', '');
  }
  if (
    isMissingColumn(errMsg, 'fr24_progress_dep_utc') ||
    isMissingColumn(errMsg, 'fr24_progress_eta_utc') ||
    isMissingColumn(errMsg, 'fr24_datetime_takeoff_utc') ||
    isMissingColumn(errMsg, 'fr24_datetime_landed_utc') ||
    isMissingColumn(errMsg, 'fr24_first_seen_utc') ||
    isMissingColumn(errMsg, 'airlabs_progress_percent')
  ) {
    c = c.replace(CREW_ROSTER_FR24_AIRLABS_COLS_FRAGMENT, '');
  }
  if (isMissingColumn(errMsg, 'roster_entry_kind')) {
    c = c.replace(', roster_entry_kind, duty_rest_end', '');
  }
  if (isMissingColumn(errMsg, 'roster_detail')) {
    c = c.replace(', roster_detail', '');
  }
  if (isMissingColumn(errMsg, 'aircraft_registration')) {
    c = c.replace(', aircraft_registration', '');
  }
  if (isMissingColumn(errMsg, 'aircraft_type')) {
    c = c.replace(', aircraft_type', '');
  }
  return c;
}

async function fetchCrewRosterFlightsByIds(
  client: SupabaseClient,
  flightIds: string[],
): Promise<{ data: any[] | null; error: { message: string } | null }> {
  let cols = CREW_ROSTER_FLIGHT_SELECT_COLS;
  let lastErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await client
      .from('flights')
      .select(cols)
      .in('id', flightIds)
      .order('flight_date', { ascending: true });
    if (!error) return { data, error: null };
    lastErr = error;
    const next = stripCrewRosterFlightSelectForError(cols, error.message);
    if (next === cols) return { data, error };
    cols = next;
  }
  return { data: null, error: lastErr };
}

async function fetchCrewRosterFlightRowById(
  client: SupabaseClient,
  flightId: string,
): Promise<{ data: any | null; error: { message: string } | null }> {
  let cols = CREW_ROSTER_FLIGHT_SELECT_COLS;
  let lastErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await client.from('flights').select(cols).eq('id', flightId).single();
    if (!error) return { data, error: null };
    lastErr = error;
    const next = stripCrewRosterFlightSelectForError(cols, error.message);
    if (next === cols) return { data, error };
    cols = next;
  }
  return { data: null, error: lastErr };
}

function mapCrewRosterFetchedRows(rows: any[]): any[] {
  return rows.map((row) => ({
    ...row,
    actual_departure: row.actual_departure ?? null,
    actual_arrival: row.actual_arrival ?? null,
    diverted_to: row.diverted_to ?? null,
    api_refresh_phase: row.api_refresh_phase ?? null,
    phase_active_locked: row.phase_active_locked ?? null,
    estimated_departure: row.estimated_departure ?? null,
    estimated_arrival: row.estimated_arrival ?? null,
    internal_status: row.internal_status ?? null,
    fr24_datetime_takeoff_utc: row.fr24_datetime_takeoff_utc ?? null,
    fr24_first_seen_utc: row.fr24_first_seen_utc ?? null,
    roster_detail: row.roster_detail ?? null,
    aircraft_registration: row.aircraft_registration ?? null,
    aircraft_type: row.aircraft_type ?? null,
  }));
}

/** İniş sonrası roster listesi + DB temizliği (aynı eşik). */
const LANDED_REMOVE_AFTER_MS = 16 * 60 * 60 * 1000;
/** Admin roster: geçmiş uçuşlar; tarih şeridi ve DB çekimi için geriye bakış (gün). */
const ROSTER_MIN_DAYS_AGO_ADMIN = 540;

function getRosterMinDaysAgo(exemptLandedAutoPurge: boolean, isCrew: boolean): number {
  return exemptLandedAutoPurge && isCrew ? ROSTER_MIN_DAYS_AGO_ADMIN : ROSTER_MIN_DAYS_AGO;
}

type RowForLandedListPurge = {
  id: string;
  roster_entry_kind?: string | null;
  api_refresh_phase?: string | null;
  actual_arrival?: string | null;
  fr24_datetime_landed_utc?: string | null;
  scheduled_arrival?: string | null;
  flight_date?: string | null;
};

/** passive_past iniş referansı: gerçek > FR24 > planlı varış. */
function passivePastListPurgeReferenceUtcMs(r: RowForLandedListPurge): number {
  let ms = parseUtcMsStatic(r.actual_arrival);
  if (ms > 0) return ms;
  ms = parseUtcMsStatic(r.fr24_datetime_landed_utc);
  if (ms > 0) return ms;
  return parseUtcMsStatic(r.scheduled_arrival);
}

/** duty_off bitiş: DUTY END (`scheduled_arrival`); yoksa flight_date gün sonu. */
function dutyOffEndedReferenceUtcMs(r: RowForLandedListPurge): number {
  return getArrivalMs({
    scheduled_arrival: r.scheduled_arrival,
    flight_date: r.flight_date,
  });
}

function isEndedDutyOffRow(r: RowForLandedListPurge, nowMs = Date.now()): boolean {
  if (isLayoverPlaceholder(r)) return false;
  const kind = (r.roster_entry_kind ?? '').toLowerCase();
  if (kind !== 'duty_off') return false;
  const endMs = dutyOffEndedReferenceUtcMs(r);
  return endMs > 0 && nowMs >= endMs;
}

/**
 * Roster otomatik temizlik (crew; admin skip):
 * - Uçuş: passive_past (+ eski passive_complete) → inişten 16 saat sonra
 * - Boş gün (duty_off): DUTY END biter bitmez
 * Admin roster: otomatik listeden düşürme / DB purge yok.
 */
async function removeFlightsLandedOver6hAgo<T extends RowForLandedListPurge>(
  list: T[],
  options?: { adminSkipLandedPurge?: boolean },
): Promise<{ kept: T[]; dbPurgeIds: string[] }> {
  if (options?.adminSkipLandedPurge) {
    return { kept: [...list], dbPurgeIds: [] };
  }
  const removeAfterMs = LANDED_REMOVE_AFTER_MS;
  const now = Date.now();
  const dbPurgeIds: string[] = [];
  const kept = list.filter((r) => {
    const kind = (r.roster_entry_kind ?? 'flight').toLowerCase();
    if (kind === 'duty_off') {
      if (isEndedDutyOffRow(r, now)) {
        dbPurgeIds.push(r.id);
        return false;
      }
      return true;
    }
    if (r.roster_entry_kind != null && kind !== 'flight') return true;
    const p = (r.api_refresh_phase ?? '').toLowerCase();
    if (p !== 'passive_past' && p !== 'passive_complete') return true;
    const refMs = passivePastListPurgeReferenceUtcMs(r);
    if (refMs <= 0) return true;
    if (now >= refMs + removeAfterMs) {
      dbPurgeIds.push(r.id);
      return false;
    }
    return true;
  });
  return { kept, dbPurgeIds };
}

/** `removeFlightForCrew` ile aynı RPC/yedek yollar; hata sessiz (arka plan temizliği). */
async function purgeCrewFlightFromDbSilently(client: SupabaseClient, crewId: string, flightId: string): Promise<void> {
  const { error: rpcErr } = await client.rpc('remove_me_from_flight', { p_flight_id: flightId });
  if (!rpcErr) {
    await client.from('flights').delete().eq('id', flightId);
    return;
  }
  const { error: relErr } = await client
    .from('flight_crew')
    .delete()
    .eq('flight_id', flightId)
    .eq('crew_id', crewId);
  if (!relErr) {
    await client.from('flights').delete().eq('id', flightId);
    return;
  }
  await client.from('flights').delete().eq('id', flightId).eq('crew_id', crewId);
}

function scheduleLandedFlightsDbPurge(client: SupabaseClient, crewId: string | null | undefined, ids: string[]): void {
  if (!crewId || ids.length === 0) return;
  void Promise.all(ids.map((id) => purgeCrewFlightFromDbSilently(client, crewId, id)));
}

type Flight = {
  id: string;
  flight_number: string;
  origin_airport: string | null;
  destination_airport: string | null;
  origin_city: string | null;
  destination_city: string | null;
  flight_date: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  actual_departure: string | null;
  actual_arrival: string | null;
  is_delayed: boolean | null;
  delay_dep_min?: number | null;
  delay_arr_min?: number | null;
  is_diverted?: boolean | null;
  flight_status?: string | null;
  internal_status?: string | null;
  diverted_to?: string | null;
  /** DB + cron; liste etiketi için `computeApiRefreshPhase` ile uyumlu. */
  api_refresh_phase?: string | null;
  /** PDF histerezis: ACTIVE girdikten sonra ETD oynasa da faz düşmez. */
  phase_active_locked?: boolean | null;
  estimated_departure?: string | null;
  estimated_arrival?: string | null;
  /** flight | duty_off | sim — duty_off satırında scheduled_* = PDF görev penceresi (kalkış/iniş değil) */
  roster_entry_kind?: string | null;
  duty_occupation_code?: string | null;
  duty_rest_end?: string | null;
  /** FR24 — liste progress bar (kalkış→0%, ETA→100%, iniş zamanı→100%). */
  fr24_progress_dep_utc?: string | null;
  fr24_progress_eta_utc?: string | null;
  /** FR24 `datetime_takeoff` — çubuk başlangıcı (varsa) birinci öncelik. */
  fr24_datetime_takeoff_utc?: string | null;
  fr24_datetime_landed_utc?: string | null;
  /** FR24 `first_seen` — STD ile kıyaslı gecikme (yer hareketi). */
  fr24_first_seen_utc?: string | null;
  /** AirLabs /flight percent 0–100 (DB’de kalır; çubuk artık bunu kullanmaz). */
  airlabs_progress_percent?: number | null;
  /** IndiGo PDF Training Details vb. (İngilizce kaynak metin). */
  roster_detail?: string | null;
  /** Tail registration when known (e.g. TC-JFK). */
  aircraft_registration?: string | null;
  /** Aircraft type code when known (e.g. A333). */
  aircraft_type?: string | null;
  crew_profiles?: { company_name: string | null } | { company_name: string | null }[] | null;
};

function formatAircraftRegistration(reg: string | null | undefined): string | null {
  const r = String(reg ?? '').trim().toUpperCase();
  return r.length > 0 ? r : null;
}

/** Crew UTC görünümü: planlı kalkışın UTC günü (yoksa varış, yoksa DB flight_date). */
function rosterCrewUtcGroupDate(f: Flight): string {
  return (
    utcCalendarDateFromIso(f.scheduled_departure) ??
    utcCalendarDateFromIso(f.scheduled_arrival) ??
    f.flight_date
  );
}

function flightPhaseComputeArgs(f: Flight, nowMs: number) {
  return {
    roster_entry_kind: f.roster_entry_kind,
    scheduled_departure: f.scheduled_departure,
    scheduled_arrival: f.scheduled_arrival,
    estimated_departure: f.estimated_departure,
    nowMs,
    roster_flight_date: f.flight_date,
    origin_airport: f.origin_airport,
    delay_dep_min: f.delay_dep_min,
    flight_status: f.flight_status,
    internal_status: f.internal_status,
    actual_arrival: f.actual_arrival,
    fr24_datetime_landed_utc: f.fr24_datetime_landed_utc,
    phase_active_locked: f.phase_active_locked,
  };
}

function dedupeVisibleRosterRows(rows: Flight[]): Flight[] {
  const score = (r: Flight) =>
    Number(!!r.actual_departure) +
    Number(!!r.actual_arrival) +
    Number(!!r.estimated_departure) +
    Number(!!r.estimated_arrival) +
    Number(!!r.fr24_datetime_takeoff_utc) +
    Number(!!r.fr24_datetime_landed_utc);
  const byKey = new Map<string, Flight>();
  for (const r of rows) {
    const kind = (r.roster_entry_kind ?? 'flight').toLowerCase();
    if (kind !== 'flight') {
      byKey.set(`id:${r.id}`, r);
      continue;
    }
    const key = [
      kind,
      r.flight_date ?? '',
      (r.flight_number ?? '').trim().toUpperCase(),
      (r.origin_airport ?? '').trim().toUpperCase(),
      (r.destination_airport ?? '').trim().toUpperCase(),
      r.scheduled_departure ?? '',
      r.scheduled_arrival ?? '',
    ].join('|');
    const prev = byKey.get(key);
    if (!prev || score(r) > score(prev)) byKey.set(key, r);
  }
  return [...byKey.values()];
}

/** Fetch flight IDs for a crew: flight_crew first, then fallback to flights.crew_id (legacy inserts). */
async function fetchFlightIdsForCrew(supabaseClient: ReturnType<typeof supabase>, crewId: string, minFlightDate: string): Promise<string[]> {
  const { data: fcData } = await supabaseClient
    .from('flight_crew')
    .select('flight_id')
    .eq('crew_id', crewId);
  let ids: string[] = [];
  if (fcData?.length) {
    ids = [...new Set((fcData as { flight_id: string }[]).map((r) => r.flight_id))];
  }
  const { data: flightsByCrew } = await supabaseClient
    .from('flights')
    .select('id')
    .eq('crew_id', crewId)
    .gte('flight_date', minFlightDate);
  const legacyIds = (flightsByCrew ?? []).map((f) => f.id);
  const combined = [...new Set([...ids, ...legacyIds])];
  const { data: flights } = await supabaseClient
    .from('flights')
    .select('id')
    .in('id', combined)
    .gte('flight_date', minFlightDate);
  return (flights ?? []).map((f) => f.id);
}

/** Fetch flight IDs for family: flight_crew + fallback flights.crew_id (legacy). crew_id yoksa sadece flight_crew kullan. */
async function fetchFlightIdsForFamily(supabaseClient: ReturnType<typeof supabase>, crewIds: string[], minFlightDate: string): Promise<string[]> {
  if (crewIds.length === 0) return [];
  const { data: fcData } = await supabaseClient
    .from('flight_crew')
    .select('flight_id')
    .in('crew_id', crewIds);
  let ids: string[] = [];
  if (fcData?.length) ids = [...new Set((fcData as { flight_id: string }[]).map((r) => r.flight_id))];
  const { data: byCrewId, error: legacyErr } = await supabaseClient
    .from('flights')
    .select('id')
    .in('crew_id', crewIds)
    .gte('flight_date', minFlightDate);
  const legacyIds = legacyErr ? [] : (byCrewId ?? []).map((f) => f.id);
  const combined = [...new Set([...ids, ...legacyIds])];
  if (combined.length === 0) return [];
  const { data: flights } = await supabaseClient
    .from('flights')
    .select('id, flight_date')
    .in('id', combined)
    .gte('flight_date', minFlightDate)
    .order('flight_date', { ascending: true });
  return (flights ?? []).map((f: { id: string }) => f.id);
}

/** Takvim/roster “bugün”: crew UTC görünümü, aile profil/cihaz TZ, aksi halde cihaz yerel günü. */
function resolveRosterTodayYmd(crewUtcView: boolean, familyRosterTz: string | null): string {
  if (crewUtcView) return getUtcDateString();
  if (familyRosterTz) return getCalendarDateStringInTimeZone(new Date(), familyRosterTz);
  return getLocalDateString();
}

function rosterListGroupDateForAnchor(
  f: Flight,
  crewUtcView: boolean,
  familyRosterTz: string | null,
): string {
  if (crewUtcView) return rosterCrewUtcGroupDate(f);
  if (familyRosterTz) {
    return (
      calendarDateFromUtcIsoInTimeZone(f.scheduled_departure, familyRosterTz) ??
      calendarDateFromUtcIsoInTimeZone(f.scheduled_arrival, familyRosterTz) ??
      f.flight_date
    );
  }
  return f.flight_date;
}

/** Canlı uçuş yardımcıları → `lib/rosterFlightClear`. */

/**
 * Açılışta tepeye alınacak gün: canlı uçuş varsa onun liste günü
 * (ertesi güne taşsa bile); yoksa null → bugün kullanılır.
 */
function findLiveRosterAnchorYmd(
  rows: Flight[],
  crewUtcView: boolean,
  familyRosterTz: string | null,
): string | null {
  let best: { ymd: string; depMs: number } | null = null;
  for (const f of rows) {
    if (!isLiveAirborneFlight(f)) continue;
    const ymd = rosterListGroupDateForAnchor(f, crewUtcView, familyRosterTz);
    if (!ymd) continue;
    const depMs =
      parseUtcMsStatic(f.actual_departure) ||
      parseUtcMsStatic(f.fr24_datetime_takeoff_utc) ||
      parseUtcMsStatic(f.scheduled_departure) ||
      0;
    if (!best || depMs < best.depMs || (depMs === best.depMs && ymd < best.ymd)) {
      best = { ymd, depMs };
    }
  }
  return best?.ymd ?? null;
}

export default function Roster({
  showAdminFr24Debug = false,
  exemptLandedAutoPurge = false,
  /** Crew↔crew takip: aile üyesinin gördüğü salt okunur roster UI. */
  peerView = null,
}: {
  showAdminFr24Debug?: boolean;
  exemptLandedAutoPurge?: boolean;
  peerView?: { peerCrewId: string; peerName: string } | null;
} = {}) {
  const { t, i18n } = useTranslation();
  const { profile, crewProfile, refreshProfile, session } = useSession();
  const themeMode = useThemeMode();
  const fontScale = useFontScaleMultiplier() || 1;
  /** Only list cards scale; chrome StyleSheet stays fixed (no full rebuild). */
  const [listFontScale, setListFontScale] = useState(() => fontScale || 1);
  useEffect(() => {
    const next = fontScale || 1;
    if (listFontScale === next) return;
    startTransition(() => setListFontScale(next));
  }, [fontScale, listFontScale]);
  const styles = useMemo(() => getCachedRosterStyles(themeMode), [themeMode]);
  const cardInk = useMemo(() => rosterCardInk(themeMode), [themeMode]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [occupationSuggestTick, setOccupationSuggestTick] = useState(0);
  const [suggestOccupation, setSuggestOccupation] = useState<{
    code: string;
    flightId: string;
  } | null>(null);
  useEffect(() => {
    void hydrateLocalOccupationOverrides();
    return subscribeLocalOccupationOverrides(() => {
      setOccupationSuggestTick((n) => n + 1);
    });
  }, []);

  const [liveMetricsById, setLiveMetricsById] = useState<Record<string, { gs?: number; altFt?: number; atUtc?: string }>>({});
  const [airborneSeenById, setAirborneSeenById] = useState<Record<string, boolean>>({});
  const [nextDayHintById, setNextDayHintById] = useState<Record<string, boolean>>({});
  const [fr24IdByFlightId, setFr24IdByFlightId] = useState<Record<string, string>>({});
  /** DB satırı gecikse bile poll sonrası çubuk/gecikme — liste state refetch beklemeden gösterim. */
  const [fr24TakeoffUtcByFlightId, setFr24TakeoffUtcByFlightId] = useState<Record<string, string>>({});
  const [fr24FirstSeenUtcByFlightId, setFr24FirstSeenUtcByFlightId] = useState<Record<string, string>>({});
  const [delayById, setDelayById] = useState<Record<string, { dep?: number; arr?: number }>>({});
  /** Poll sonrası kuyruk — DB refetch beklemeden listede gösterim. */
  const [aircraftRegById, setAircraftRegById] = useState<Record<string, string>>({});
  const airborneSeenRef = useRef<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [updatingTimes, setUpdatingTimes] = useState(false);
  const [refreshingList, setRefreshingList] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const syncInFlightRef = useRef(false);
  const [sendingToFamily, setSendingToFamily] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  /** Program içi roster değiştirici kaldırıldı — peer yalnızca 4. sekme. */
  const effectivePeerView = peerView ?? null;
  const isPeerViewer = Boolean(effectivePeerView?.peerCrewId);
  /** Ortak boş günler (kendi Program + peer sekmesi). */
  const [sharedOffDates, setSharedOffDates] = useState<string[]>([]);
  /** Hesap crew; peer rosterına bakarken bile karşılaştırma için. */
  const isOwnCrewAccount = profile?.role === 'crew';
  const followedPeers = useMemo(
    () => (isOwnCrewAccount ? demoPeersForUser(profile?.id) : []),
    [isOwnCrewAccount, profile?.id],
  );
  /** Karşılaştırma: peer sekmesinde o kişi; kendi Program’da bağlı ilk peer. */
  const comparePeerCrewId = useMemo(() => {
    if (effectivePeerView?.peerCrewId) return effectivePeerView.peerCrewId;
    return followedPeers[0]?.peerCrewId ?? null;
  }, [effectivePeerView?.peerCrewId, followedPeers]);
  /** Kendi düzenlenebilir roster; peer görünümünde aile-modu UI (salt okunur). */
  const isCrew = profile?.role === 'crew' && !isPeerViewer;
  const flightsRef = useRef<Flight[]>([]);
  flightsRef.current = flights;

  useEffect(() => {
    setAircraftRegById((prev) => {
      let next: Record<string, string> | null = null;
      for (const f of flights) {
        const r = formatAircraftRegistration(f.aircraft_registration);
        if (!r) continue;
        if (!next) next = { ...prev };
        if (next[f.id] !== r) next[f.id] = r;
      }
      return next ?? prev;
    });
  }, [flights]);

  const lastAutoRefreshMsRef = useRef<number>(0);
  const lastDashRefreshMsRef = useRef<number>(0);
  const autoRefreshInFlightRef = useRef<boolean>(false);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const [updatingFlightIds, setUpdatingFlightIds] = useState<Record<string, boolean>>({});
  const [swipeCardHeights, setSwipeCardHeights] = useState<Record<string, number>>({});
  const [shareToastMessage, setShareToastMessage] = useState<string | null>(null);
  const shareToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clearUndoToast, setClearUndoToast] = useState<string | null>(null);
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false);
  const [infoToast, setInfoToast] = useState<string | null>(null);
  const pendingClearRef = useRef<{
    rows: Flight[];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const infoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSyncedAtMs, setLastSyncedAtMs] = useState<number | null>(() => getRosterLastSyncedAt());
  const [syncNowMs, setSyncNowMs] = useState(() => Date.now());
  const todayStr = getLocalDateString();
  const [selectedDate, setSelectedDate] = useState<string>(() => todayStr);
  const sharedOffSet = useMemo(() => new Set(sharedOffDates), [sharedOffDates]);
  const sharedOffThisMonth = useMemo(() => {
    const ym = selectedDate.slice(0, 7);
    return sharedOffDates.filter((d) => d.startsWith(ym));
  }, [sharedOffDates, selectedDate]);

  const [familyRosterListPrefs, setFamilyRosterListPrefs] = useState<RosterListShowPrefs>(() =>
    normalizeRosterListShow(null)
  );
  const [rosterTasksModalVisible, setRosterTasksModalVisible] = useState(false);
  const [addFlightMenuVisible, setAddFlightMenuVisible] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => todayStr.slice(0, 7));
  const programmaticListScrollRef = useRef(false);
  /** Takvim gününe basınca listData (boş gün başlığı) güncellenene kadar bekleyen hedef. */
  const pendingListScrollDateRef = useRef<string | null>(null);
  const pendingListScrollClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRosterAnchorRef = useRef<string | null>(null);
  /** Focus sonrası açılış hizası: `auto` = canlı uçuş varsa onun günü, yoksa bugün; `added` = AddFlight. */
  const openRosterAnchorRef = useRef<null | { kind: 'auto' } | { kind: 'added'; ymd: string }>(null);
  const liveAnchorYmdPrevRef = useRef<string | null | undefined>(undefined);
  const [rosterAnchorNonce, setRosterAnchorNonce] = useState(0);
  /** Geçmiş gün takvim renkleri (uçuş listeden düşünce de kırmızı/turuncu/yeşil kalsın). */
  const [persistedDayKinds, setPersistedDayKinds] = useState<Record<string, CalendarDayKind>>({});
  const [familyCrewOptions, setFamilyCrewOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [familyCrewFilterId, setFamilyCrewFilterId] = useState<string>('all');
  const familyCrewFilterIdRef = useRef('all');
  /** Aile/peer roster: görüntülenen crew’(lar)ın home base — yatı hesabı için. */
  const [viewedCrewHomeBases, setViewedCrewHomeBases] = useState<string[]>([]);
  const [flightOpBusyMessage, setFlightOpBusyMessage] = useState<string | null>(null);
  const [subscriptionAccess, setSubscriptionAccess] = useState<SubscriptionAccess | null>(null);
  const [subscriptionAccessLoading, setSubscriptionAccessLoading] = useState(false);

  const rosterListPrefs = React.useMemo(() => {
    // Görünüm tercihi her zaman görüntüleyen kullanıcıya aittir (takip edilen crew’ın ayarı değil).
    if (profile?.role === 'crew') return normalizeRosterListShow(crewProfile?.roster_list_show);
    return familyRosterListPrefs;
  }, [profile?.role, crewProfile?.roster_list_show, familyRosterListPrefs]);

  /** Takvim görünümü: ay her zaman expanded + değişken satır. */
  const calendarViewEnabled = rosterListPrefs.show_calendar;
  /** Liste görünümü: çok günlük kaydırılabilir roster (mevcut yapı). */
  const listViewEnabled = rosterListPrefs.show_list;
  /** Yalnızca takvim: seçili güne ait kartlar. */
  const calendarDayCardsOnly = calendarViewEnabled && !listViewEnabled;
  const crewUtcView = isCrew && rosterListPrefs.time_display === 'utc';
  /** Aile: profil `timezone_iana` veya cihaz — liste günü ve sıra bu TZ’ye göre. */
  const familyRosterTz = !isCrew ? (profile?.timezone_iana?.trim() || getDeviceIanaTimeZone()) : null;
  const rosterTodayYmd = useMemo(
    () => resolveRosterTodayYmd(crewUtcView, familyRosterTz),
    [crewUtcView, familyRosterTz, nowTick, todayStr],
  );
  const crewUtcViewRef = useRef(crewUtcView);
  crewUtcViewRef.current = crewUtcView;
  const familyRosterTzRef = useRef(familyRosterTz);
  familyRosterTzRef.current = familyRosterTz;

  useEffect(() => {
    void hydrateRosterLastSyncedAt().then((ms) => {
      if (ms != null) setLastSyncedAtMs(ms);
    });
  }, []);
  useEffect(() => subscribeRosterLastSyncedAt(() => {
    setLastSyncedAtMs(getRosterLastSyncedAt());
    setSyncNowMs(Date.now());
  }), []);
  useEffect(() => {
    const id = setInterval(() => setSyncNowMs(Date.now()), 15_000);
    return () => clearInterval(id as any);
  }, []);
  const rosterSyncMetaText = useMemo(
    () => formatRelativeSyncedAt(lastSyncedAtMs, syncNowMs, t),
    [lastSyncedAtMs, syncNowMs, t],
  );
  /** Yalnızca kullanıcı yenilemesi (pull / etiket) — arka plan poll etiketi “Güncelleniyor” yapmasın. */
  const isSyncingMeta = refreshingList;
  const syncMetaLabel = isSyncingMeta
    ? t('nav.lastUpdatedUpdating')
    : syncError
      ? t('nav.lastUpdatedFailed')
      : `↻ ${rosterSyncMetaText}`;
  const syncMetaColor = syncError ? '#E67E22' : isSyncingMeta ? colors.primary : colors.textMuted;


  const listGroupDate = useCallback(
    (f: Flight) => {
      if (crewUtcView) return rosterCrewUtcGroupDate(f);
      if (familyRosterTz) {
        return (
          calendarDateFromUtcIsoInTimeZone(f.scheduled_departure, familyRosterTz) ??
          calendarDateFromUtcIsoInTimeZone(f.scheduled_arrival, familyRosterTz) ??
          f.flight_date
        );
      }
      return f.flight_date;
    },
    [crewUtcView, familyRosterTz]
  );

  const crewTimeDisplayPrevRef = useRef<'local' | 'utc' | null>(null);
  useEffect(() => {
    if (!isCrew) {
      crewTimeDisplayPrevRef.current = null;
      return;
    }
    const v = rosterListPrefs.time_display;
    if (crewTimeDisplayPrevRef.current === null) {
      crewTimeDisplayPrevRef.current = v;
      return;
    }
    if (crewTimeDisplayPrevRef.current !== v) {
      crewTimeDisplayPrevRef.current = v;
      const today = resolveRosterTodayYmd(v === 'utc', familyRosterTz);
      // Soft switch: update "today" without forcing a full list re-scroll (that freezes the UI).
      startTransition(() => {
        setSelectedDate(today);
        setCalendarMonth(today.slice(0, 7));
      });
    }
  }, [isCrew, rosterListPrefs.time_display, familyRosterTz]);

  /** Uçuş + duty_off satırları gösterilir; sim blokları listede gizlenir. Önümüzdeki N gün. Biten boş gün anında düşer. */
  const displayFlights = React.useMemo(() => {
    const now = Date.now();
    const maxDate = getLocalDateStringPlusDays(ROSTER_MAX_DAYS_AHEAD);
    const visible = flights.filter((f) => {
      const kind = (f.roster_entry_kind ?? 'flight').toLowerCase();
      if (kind === 'sim') return false;
      if (isEndedDutyOffRow(f, now)) return false;
      if ((f.flight_date || '') > maxDate) return false;
      return rosterListRowVisible(f, rosterListPrefs);
    });
    return dedupeVisibleRosterRows(visible);
  }, [flights, rosterListPrefs, todayStr, nowTick]);

  const reloadFamilyRosterPrefs = useCallback(() => {
    if (profile?.id && (profile.role === 'family' || isPeerViewer)) {
      void loadFamilyRosterListShow(profile.id).then(setFamilyRosterListPrefs);
    }
  }, [profile?.id, profile?.role, isPeerViewer]);

  useFocusEffect(
    useCallback(() => {
      reloadFamilyRosterPrefs();
    }, [reloadFamilyRosterPrefs])
  );

  /** API güncellemesi: yalnızca faz semi_active veya active (cron ile aynı kural). */
  const shouldForceLookupForMissingSchedule = useCallback((f: Flight) => {
    if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') return false;
    // Dash uçuşlar (saat yok) her zaman yarı-aktif kabul edilir.
    return !f.scheduled_departure && !f.scheduled_arrival;
  }, []);

  const getAutoRefreshList = useCallback(
    (list: Flight[]) => {
      const now = Date.now();
      const minFlightDateStr = getLocalDateStringPlusDays(
        -getRosterMinDaysAgo(exemptLandedAutoPurge, isCrew),
      );
      return list.filter((f) => {
        if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') return false;
        if (f.flight_date < minFlightDateStr) return false;
        if (shouldForceLookupForMissingSchedule(f)) return true;
        const phase = computeApiRefreshPhase(flightPhaseComputeArgs(f, now));
        return isApiRefreshPhasePolling(phase);
      });
    },
    [shouldForceLookupForMissingSchedule, exemptLandedAutoPurge, isCrew]
  );

  /** DB self-heal: future-date yanlış landed should not remain. */
  const normalizeFutureLandedInDb = useCallback(
    async <
      T extends {
        id: string;
        flight_date: string;
        flight_status?: string | null;
        internal_status?: string | null;
        api_refresh_phase?: string | null;
        phase_active_locked?: boolean | null;
        scheduled_departure?: string | null;
        estimated_departure?: string | null;
        delay_dep_min?: number | null;
        actual_arrival?: string | null;
        fr24_datetime_landed_utc?: string | null;
        last_seen_utc?: string | null;
      },
    >(
      rows: T[],
    ): Promise<T[]> => {
    const todayLocal = getLocalDateStringPlusDays(0);
    const preserveCancelledOnly = (s: string | null | undefined) => {
      const x = (s ?? '').toLowerCase();
      return x === 'cancelled' || x === 'canceled';
    };
    const toScheduled = rows
      .filter((r) => {
        if (preserveCancelledOnly(r.flight_status)) return false;
        // Rule: passive_future must always be scheduled.
        if (
          (r.api_refresh_phase === 'passive_future' || r.api_refresh_phase === 'passive_upcoming' || r.api_refresh_phase === 'semi_active') &&
          r.flight_status !== 'scheduled'
        ) {
          return true;
        }
        // Without actual arrival, future rows should not remain landed.
        if (
          r.flight_date > todayLocal &&
          !r.actual_arrival &&
          (r.flight_status === 'landed' || r.flight_status === 'parked')
        ) {
          return true;
        }
        // Extra guard: future date should not remain landed/parked.
        if (r.flight_date > todayLocal && (r.flight_status === 'landed' || r.flight_status === 'parked')) return true;
        // Çelişki: planlı kalkış henüz gelmemişken landed olamaz (eski kotarı DB satırları).
        const depMs = parseUtcMsStatic((r as { scheduled_departure?: string | null }).scheduled_departure);
        if (
          (r.flight_status === 'landed' || r.flight_status === 'parked') &&
          depMs > Date.now() + 120_000
        ) {
          return true;
        }
        return false;
      })
      .map((r) => r.id)
      .filter(Boolean);

    const toLanded = rows
      .filter((r) => {
        if (terminalNoReschedule(r.flight_status)) return false;
        const st = (r.flight_status ?? '').toLowerCase();
        return r.api_refresh_phase === 'passive_past' && st !== 'landed' && st !== 'parked';
      })
      .map((r) => r.id)
      .filter(Boolean);

    // Tampon self-heal: cron faz refresh aksarsa, ETD-30dk eşiğini geçmiş semi_active satırları active+locked yap.
    const toActive = rows
      .filter((r) => {
        if (r.api_refresh_phase !== 'semi_active') return false;
        if (terminalNoReschedule(r.flight_status)) return false;
        if (landedFromRow(r)) return false;
        const stdMs = parseUtcMsStatic(r.scheduled_departure);
        if (stdMs <= 0) return false;
        const estMs = parseUtcMsStatic(r.estimated_departure);
        const delayMin = Number.isFinite(Number(r.delay_dep_min)) ? Number(r.delay_dep_min) : 0;
        const etdMs = estMs > 0 ? estMs : stdMs + Math.round(delayMin * 60 * 1000);
        return Date.now() >= etdMs - 30 * 60 * 1000;
      })
      .map((r) => r.id)
      .filter(Boolean);

    if (toScheduled.length > 0) {
      await supabase.from('flights').update({ flight_status: 'scheduled' }).in('id', toScheduled);
    }
    if (toLanded.length > 0) {
      await supabase.from('flights').update({ flight_status: 'landed', internal_status: 'landed' }).in('id', toLanded);
    }
    if (toActive.length > 0) {
      await supabase
        .from('flights')
        .update({ api_refresh_phase: 'active', phase_active_locked: true })
        .in('id', toActive);
    }
    if (toScheduled.length === 0 && toLanded.length === 0 && toActive.length === 0) return rows;

    const scheduledSet = new Set(toScheduled);
    const landedSet = new Set(toLanded);
    const activeSet = new Set(toActive);
    return rows.map((r) => {
      if (scheduledSet.has(r.id)) return { ...r, flight_status: 'scheduled' };
      if (landedSet.has(r.id)) return { ...r, flight_status: 'landed', internal_status: 'landed' } as T;
      if (activeSet.has(r.id)) return { ...r, api_refresh_phase: 'active', phase_active_locked: true } as T;
      return r;
    });
  }, []);

  // Roster sırası: her zaman planlı kalkış (STD); gerçek kalkış sıralamayı kaydırmaz.
  const sortByDepartureAsc = useCallback((a: Flight, b: Flight) => {
    const aMs = parseUtcMsStatic(a.scheduled_departure);
    const bMs = parseUtcMsStatic(b.scheduled_departure);
    const aHas = aMs > 0;
    const bHas = bMs > 0;
    if (aHas && bHas) return aMs - bMs;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (a.flight_date !== b.flight_date) return a.flight_date.localeCompare(b.flight_date);
    return a.flight_number.localeCompare(b.flight_number);
  }, []);

  const flightsForSelectedDay = React.useMemo(
    () => displayFlights.filter((f) => listGroupDate(f) === selectedDate),
    [displayFlights, selectedDate, listGroupDate]
  );

  /** Layover pencereleri — crew kendi base’i; aile/peer görüntülenen crew base’i. */
  const layoverHomeBases = useMemo(() => {
    if (isCrew && !isPeerViewer) {
      const own = (crewProfile?.home_base_iata ?? '').trim().toUpperCase();
      return own ? [own] : [];
    }
    return viewedCrewHomeBases;
  }, [isCrew, isPeerViewer, crewProfile?.home_base_iata, viewedCrewHomeBases]);
  const layoverWindows = useMemo(
    () => computeLayoverWindows(flights, layoverHomeBases),
    [flights, layoverHomeBases],
  );
  const layoverDateSet = useMemo(() => layoverDatesFromWindows(layoverWindows), [layoverWindows]);
  /** “Sadece uçuş” açıkken yatı / nöbet / boş gün işaretleri takvimde de gizlenir. */
  const calendarLayoverDateSet = useMemo(
    () => (rosterListPrefs.flights_only ? new Set<string>() : layoverDateSet),
    [rosterListPrefs.flights_only, layoverDateSet],
  );

  /**
   * Önce roster günü (`flight_date`), sonra aynı gün içinde kalkış saati.
   * Sadece UTC kalkışa göre global sıralama yapılırsa farklı günler iç içe geçer;
   * gün ayırıcı aynı tarih için iki kez üretilir → `day-2026-04-04` duplicate key hatası.
   * Layover ara günlerdeki duty_off (FOF vb.) listede gösterilmez — yatı yalnız takvimde.
   * Aynı listede gerçek uçuş olan günde boş/izin satırı da gizlenir (gece dönüş + FOF çakışması).
   */
  const allFlightsSorted = React.useMemo(() => {
    const interiorLayoverDays = new Set<string>();
    for (const w of layoverWindows) {
      let cur = addUtcDaysToYmd(w.startYmd, 1);
      while (cur < w.endYmd) {
        interiorLayoverDays.add(cur);
        cur = addUtcDaysToYmd(cur, 1);
      }
    }
    const datesWithFlight = new Set<string>();
    for (const f of displayFlights) {
      if (isLayoverPlaceholder(f)) continue;
      const rk = (f.roster_entry_kind ?? 'flight').toLowerCase();
      if (rk !== 'flight') continue;
      const code = (f.flight_number || '').trim().toUpperCase();
      if (isOffDayOccupationCode(code) || isStandbyOccupationCode(code)) continue;
      datesWithFlight.add(listGroupDate(f));
    }
    const copy = displayFlights.filter((f) => {
      if (isLayoverPlaceholder(f)) return false;
      const kind = (f.roster_entry_kind ?? 'flight').toLowerCase();
      const ymd = listGroupDate(f);
      if (kind === 'duty_off' && interiorLayoverDays.has(ymd)) return false;
      // Uçuş gününde FOF/OFF/AVAC vb. gösterme (XQ613 gece dönüş + 24 OFF).
      if (kind === 'duty_off' && datesWithFlight.has(ymd)) return false;
      return true;
    });
    copy.sort((a, b) => {
      const ga = listGroupDate(a);
      const gb = listGroupDate(b);
      if (ga !== gb) return ga.localeCompare(gb);
      return sortByDepartureAsc(a, b);
    });
    return copy;
  }, [displayFlights, sortByDepartureAsc, listGroupDate, layoverWindows]);
  /**
   * Sticky-ish day headers + flight rows.
   * Aynı gün içindeki kartlar eşit aralıklı; günler arası ayrım dayHeader ile.
   */
  type ListEntry =
    | {
        type: 'dayHeader';
        dateYmd: string;
        flightCount: number;
        blockMinutes: number;
      }
    | {
        type: 'flight';
        flight: Flight;
        dayIndex: number;
        dayGroupIndex: number;
        isFirstInDay: boolean;
        isLastInDay: boolean;
      }
    | {
        type: 'layover';
        dateYmd: string;
        station: string;
        windowKey: string;
        inboundId: string;
      };
  const listData = React.useMemo((): ListEntry[] => {
    const byDate = new Map<string, Flight[]>();
    for (const f of allFlightsSorted) {
      const g = listGroupDate(f);
      if (!byDate.has(g)) byDate.set(g, []);
      byDate.get(g)!.push(f);
    }
    // Layover başlangıç günü listede yoksa boş gün için başlık oluştur
    for (const w of layoverWindows) {
      if (!byDate.has(w.startYmd)) byDate.set(w.startYmd, []);
    }
    // Bugün/seçili gün boşsa sticky başlık + empty satırı için dahil et
    for (const ymd of [rosterTodayYmd, selectedDate]) {
      if (ymd && !byDate.has(ymd)) byDate.set(ymd, []);
    }
    const sortedDates = [...byDate.keys()].sort();
    const datesToRender =
      calendarDayCardsOnly && selectedDate
        ? sortedDates.filter((ymd) => ymd === selectedDate)
        : sortedDates;
    const rebuilt: ListEntry[] = [];
    let gIdx = -1;
    for (const ymd of datesToRender) {
      const flightsInDay = byDate.get(ymd) ?? [];
      gIdx += 1;
      let blockMinutes = 0;
      let flightOnlyCount = 0;
      for (const f of flightsInDay) {
        const kind = (f.roster_entry_kind ?? 'flight').toLowerCase();
        const isFlightRow = kind === 'flight' || kind === '';
        if (isFlightRow) flightOnlyCount += 1;
        if (!isFlightRow) continue;
        const a = parseFlightTimeAsUtc(f.scheduled_departure)?.getTime() ?? 0;
        const b = parseFlightTimeAsUtc(f.scheduled_arrival)?.getTime() ?? 0;
        if (a > 0 && b > 0) {
          let end = b;
          if (end <= a) end += 24 * 60 * 60 * 1000;
          blockMinutes += Math.round((end - a) / 60000);
        }
      }
      rebuilt.push({
        type: 'dayHeader',
        dateYmd: ymd,
        flightCount: flightOnlyCount || flightsInDay.length,
        blockMinutes,
      });
      let dIdx = 0;
      for (const f of flightsInDay) {
        dIdx += 1;
        rebuilt.push({
          type: 'flight',
          flight: f,
          dayIndex: dIdx,
          dayGroupIndex: gIdx,
          isFirstInDay: dIdx === 1,
          isLastInDay: dIdx === flightsInDay.length,
        });
      }
      for (const w of layoverWindows) {
        if (w.startYmd !== ymd) continue;
        rebuilt.push({
          type: 'layover',
          dateYmd: ymd,
          station: w.station,
          windowKey: w.key,
          inboundId: w.inboundId,
        });
      }
    }
    return rebuilt;
  }, [
    allFlightsSorted,
    listGroupDate,
    layoverWindows,
    rosterTodayYmd,
    selectedDate,
    calendarDayCardsOnly,
  ]);
  const flightsSorted = React.useMemo(() => {
    const copy = [...flightsForSelectedDay];
    copy.sort(sortByDepartureAsc);
    return copy;
  }, [flightsForSelectedDay, sortByDepartureAsc]);

  const refreshTimesFromApi = useCallback(async (silent = false, listOverride?: Flight[]) => {
    if (!isCrew || !crewProfile?.id) return;
    const baseList = listOverride ?? flightsRef.current;
    const list = getAutoRefreshList(baseList);
    if (list.length === 0) return;
    if (!silent) setUpdatingTimes(true);

    const processFlight = async (flight: Flight) => {
      if (flight.roster_entry_kind === 'duty_off' || flight.roster_entry_kind === 'sim') return;
      const nowMs = Date.now();
      const forceLookupMissingSchedule = shouldForceLookupForMissingSchedule(flight);
      const phase = computeApiRefreshPhase(flightPhaseComputeArgs(flight, nowMs));
      let effectivePhase: 'semi_active' | 'active' | null =
        phase === 'semi_active' || phase === 'active'
          ? phase
          : forceLookupMissingSchedule
            ? 'semi_active'
            : null;
      if (!effectivePhase) return;

      let info = await pollFlightForRoster(flight.flight_number, flight.flight_date, effectivePhase);
      if (!info) return;

      // Dash uçuşlarda (schedule boş) ilk adım olarak semi_active ile FR'den schedule_*
      // dolduruyoruz; sonra gerçek fazı (active vs semi_active) tekrar hesaplayıp
      // aktif ise ikinci kez active lookup yapıyoruz.
      let actualPhase: ApiRefreshPhase | null = null;
      if (forceLookupMissingSchedule && effectivePhase === 'semi_active') {
        actualPhase = computeApiRefreshPhase({
          ...flightPhaseComputeArgs(flight, nowMs),
          scheduled_departure: info.scheduled_departure_utc ?? flight.scheduled_departure,
          scheduled_arrival: info.scheduled_arrival_utc ?? flight.scheduled_arrival,
        });
        if (actualPhase === 'active') {
          effectivePhase = 'active';
          const infoActive = await pollFlightForRoster(flight.flight_number, flight.flight_date, 'active');
          if (infoActive) info = infoActive;
        }
      }

      const effectiveInfo = { ...info };
      if (actualPhase === 'passive_future' || actualPhase === 'passive_upcoming' || actualPhase === 'semi_active') {
        // Passive/semiactive => UI her zaman scheduled göstermeli.
        effectiveInfo.flightStatus = 'scheduled';
      }
      const debugKey = flight.flight_number.toUpperCase();
      if (effectiveInfo.fr24Id?.trim()) {
        setFr24IdByFlightId((prev) => (prev[flight.id] === effectiveInfo!.fr24Id!.trim() ? prev : { ...prev, [flight.id]: effectiveInfo!.fr24Id!.trim() }));
      }
      if (effectiveInfo.nextDayHint != null) {
        setNextDayHintById((prev) => ({ ...prev, [flight.id]: effectiveInfo.nextDayHint === true }));
      }
      if (effectiveInfo.groundSpeedKts != null || effectiveInfo.altitudeFt != null) {
        setLiveMetricsById((prev) => ({
          ...prev,
          [flight.id]: {
            gs: effectiveInfo.groundSpeedKts ?? prev[flight.id]?.gs,
            altFt: effectiveInfo.altitudeFt ?? prev[flight.id]?.altFt,
            atUtc: effectiveInfo.lastTrackUtc ?? prev[flight.id]?.atUtc,
          },
        }));
      }
      // Cache delay mins from API immediately so UI can show without waiting for DB.
      if ((effectiveInfo as any).delayDepMin != null || (effectiveInfo as any).delayArrMin != null) {
        const dep = Number((effectiveInfo as any).delayDepMin);
        const arr = Number((effectiveInfo as any).delayArrMin);
        setDelayById((prev) => ({
          ...prev,
          [flight.id]: {
            dep: Number.isFinite(dep) ? dep : prev[flight.id]?.dep,
            arr: Number.isFinite(arr) ? arr : prev[flight.id]?.arr,
          },
        }));
      }
      const polledTakeoff =
        effectiveInfo.fr24_datetime_takeoff_utc ?? (effectiveInfo as { datetime_takeoff_utc?: string }).datetime_takeoff_utc;
      if (polledTakeoff) {
        setFr24TakeoffUtcByFlightId((prev) =>
          prev[flight.id] === polledTakeoff ? prev : { ...prev, [flight.id]: polledTakeoff },
        );
      }
      if (effectiveInfo.first_seen_utc) {
        setFr24FirstSeenUtcByFlightId((prev) =>
          prev[flight.id] === effectiveInfo.first_seen_utc ? prev : { ...prev, [flight.id]: effectiveInfo.first_seen_utc! },
        );
      }
      const polledReg = String(
        effectiveInfo.aircraftRegistration ??
          (effectiveInfo as { aircraft_registration?: string }).aircraft_registration ??
          '',
      ).trim().toUpperCase();
      if (polledReg) {
        setAircraftRegById((prev) => (prev[flight.id] === polledReg ? prev : { ...prev, [flight.id]: polledReg }));
        setFlights((prev) => prev.map((f) => (f.id === flight.id ? { ...f, aircraft_registration: polledReg } : f)));
      }
      const gs = effectiveInfo.groundSpeedKts;
      const alt = effectiveInfo.altitudeFt;
      const isAirborneNow =
        (typeof alt === 'number' && Number.isFinite(alt) && alt >= 500) ||
        (typeof gs === 'number' && Number.isFinite(gs) && gs >= 90) ||
        effectiveInfo.flightStatus === 'en_route';
      if (isAirborneNow) {
        airborneSeenRef.current[flight.id] = true;
        setAirborneSeenById((prev) => (prev[flight.id] ? prev : { ...prev, [flight.id]: true }));
      }
      // Statü türetme (LANDED DETECTION / low-speed heuristic) kaldırıldı — baştan yazılacak.
      // Update in two phases so missing actual_* columns don't block scheduled_* updates.
      const payloadScheduled = {} as Record<string, unknown>;
      const toIata = (code: string | undefined) => (code ? (getAirportDisplay(code)?.iata ?? code) : undefined);
      if (effectiveInfo.scheduled_departure_utc != null) payloadScheduled.scheduled_departure = effectiveInfo.scheduled_departure_utc;
      if (effectiveInfo.scheduled_arrival_utc != null) payloadScheduled.scheduled_arrival = effectiveInfo.scheduled_arrival_utc;
      if (effectiveInfo.origin) payloadScheduled.origin_airport = toIata(effectiveInfo.origin) ?? effectiveInfo.origin;
      if (effectiveInfo.destination) payloadScheduled.destination_airport = toIata(effectiveInfo.destination) ?? effectiveInfo.destination;
      if (effectiveInfo.originCity != null) payloadScheduled.origin_city = effectiveInfo.originCity;
      if (effectiveInfo.destinationCity != null) payloadScheduled.destination_city = effectiveInfo.destinationCity;
      if (effectiveInfo.flightStatus != null) {
        payloadScheduled.flight_status = effectiveInfo.flightStatus;
        const mir = internalStatusMirrorFromApiFlightStatus(effectiveInfo.flightStatus);
        if (mir != null) (payloadScheduled as any).internal_status = mir;
      }
      if (effectiveInfo.lastTrackUtc) (payloadScheduled as any).last_seen_utc = effectiveInfo.lastTrackUtc;
      if (effectiveInfo.delayed != null) payloadScheduled.is_delayed = effectiveInfo.delayed;
      if ((effectiveInfo as any).delayDepMin != null) payloadScheduled.delay_dep_min = (effectiveInfo as any).delayDepMin;
      if ((effectiveInfo as any).delayArrMin != null) payloadScheduled.delay_arr_min = (effectiveInfo as any).delayArrMin;
      if (effectiveInfo.divertedTo != null) payloadScheduled.diverted_to = effectiveInfo.divertedTo;
      if (effectiveInfo.fr24_progress_dep_utc != null) {
        (payloadScheduled as any).fr24_progress_dep_utc = effectiveInfo.fr24_progress_dep_utc;
      }
      if (effectiveInfo.fr24_progress_eta_utc != null) {
        (payloadScheduled as any).fr24_progress_eta_utc = effectiveInfo.fr24_progress_eta_utc;
      }
      const takeoffUtc =
        effectiveInfo.fr24_datetime_takeoff_utc ?? (effectiveInfo as { datetime_takeoff_utc?: string }).datetime_takeoff_utc;
      if (takeoffUtc != null) {
        (payloadScheduled as any).fr24_datetime_takeoff_utc = takeoffUtc;
      }
      if (effectiveInfo.first_seen_utc != null) {
        (payloadScheduled as any).fr24_first_seen_utc = effectiveInfo.first_seen_utc;
      }
      if (effectiveInfo.fr24_datetime_landed_utc != null) {
        (payloadScheduled as any).fr24_datetime_landed_utc = effectiveInfo.fr24_datetime_landed_utc;
      } else if (effectiveInfo.flightStatus && effectiveInfo.flightStatus !== 'landed') {
        // Avoid stale 100% bar from previously stored landed timestamp.
        (payloadScheduled as any).fr24_datetime_landed_utc = null;
      }
      if (effectiveInfo.airlabsProgressPercent != null) {
        (payloadScheduled as any).airlabs_progress_percent = effectiveInfo.airlabsProgressPercent;
      }
      const regToSave = String(
        effectiveInfo.aircraftRegistration ??
          (effectiveInfo as { aircraft_registration?: string }).aircraft_registration ??
          '',
      ).trim().toUpperCase();
      if (regToSave) {
        (payloadScheduled as any).aircraft_registration = regToSave;
      }

      // Etiket: planlı kalkışın UTC takvim günü (çakışan başka satır yoksa flight_date güncellenir).
      const depUtcStr = effectiveInfo.scheduled_departure_utc;
      if (typeof depUtcStr === 'string' && depUtcStr.length >= 10) {
        const utcDay = depUtcStr.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(utcDay) && utcDay !== flight.flight_date) {
          const { data: clash } = await supabase
            .from('flights')
            .select('id')
            .eq('flight_number', flight.flight_number)
            .eq('flight_date', utcDay)
            .neq('id', flight.id)
            .maybeSingle();
          if (!clash) payloadScheduled.flight_date = utcDay;
        }
      }

      const payloadActual = {} as Record<string, unknown>;
      if (effectiveInfo.actual_departure_utc != null) payloadActual.actual_departure = effectiveInfo.actual_departure_utc;
      if (effectiveInfo.actual_arrival_utc != null) payloadActual.actual_arrival = effectiveInfo.actual_arrival_utc;

      if (Object.keys(payloadScheduled).length > 0) {
        if (debugKey === 'PC2088' || debugKey === 'PC2199') console.log(`[${debugKey}] Updating DB with payloadScheduled.flight_status =`, payloadScheduled.flight_status);
        const tryUpdateScheduled = async (payload: Record<string, unknown>) => {
          let current = { ...payload } as Record<string, unknown>;
          let attempts = 0;
          // Dynamic fallback for legacy schemas: strip missing column and retry.
          while (Object.keys(current).length > 0 && attempts < 8) {
            const { error } = await supabase.from('flights').update(current).eq('id', flight.id);
            if (!error) return { error: null as any, finalPayload: current };
            const missing = extractMissingColumnName(error.message);
            if (!missing || !(missing in current)) return { error, finalPayload: current };
            const { [missing]: _drop, ...rest } = current as any;
            current = rest;
            attempts += 1;
          }
          return { error: null as any, finalPayload: current };
        };
        let { error } = await supabase.from('flights').update(payloadScheduled).eq('id', flight.id);
        if (error && isMissingColumn(error?.message, 'diverted_to')) {
          const { diverted_to: _dt, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (
          error &&
          (isMissingColumn(error?.message, 'fr24_progress_dep_utc') ||
            isMissingColumn(error?.message, 'fr24_progress_eta_utc') ||
            isMissingColumn(error?.message, 'fr24_datetime_takeoff_utc') ||
            isMissingColumn(error?.message, 'fr24_datetime_landed_utc') ||
            isMissingColumn(error?.message, 'fr24_first_seen_utc'))
        ) {
          const {
            fr24_progress_dep_utc: _fd,
            fr24_progress_eta_utc: _fe,
            fr24_datetime_takeoff_utc: _ft,
            fr24_datetime_landed_utc: _fl,
            fr24_first_seen_utc: _ff,
            ...rest
          } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (error && isMissingColumn(error?.message, 'airlabs_progress_percent')) {
          const { airlabs_progress_percent: _ap, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (error && (isMissingColumn(error?.message, 'delay_dep_min') || isMissingColumn(error?.message, 'delay_arr_min'))) {
          const { delay_dep_min: _dd, delay_arr_min: _da, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (error && isMissingColumn(error?.message, 'last_seen_utc')) {
          const { last_seen_utc: _ls, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (error && isMissingColumn(error?.message, 'internal_status')) {
          const { internal_status: _is, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        // Final safety-net: remove whatever missing column message points to.
        if (error) {
          ({ error } = await tryUpdateScheduled(payloadScheduled));
        }
        if (error) {
          console.log('[Roster] scheduled update failed', { flight: flight.flight_number, id: flight.id, error: error.message });
          if (debugKey === 'PC2088' || debugKey === 'PC2199') console.log(`[${debugKey}] DB scheduled update FAILED:`, error.message);
        } else if (debugKey === 'PC978' || debugKey === 'PC615' || debugKey === 'PC1134' || debugKey === 'PC2088' || debugKey === 'PC2199' || debugKey === 'PC2289' || debugKey === 'PC2533') {
          console.log(`[Debug ${debugKey}] DB updated scheduled keys:`, Object.keys(payloadScheduled));
        }
      } else if ((debugKey === 'PC2088' || debugKey === 'PC2199' || debugKey === 'PC2533') && effectiveInfo.flightStatus != null) {
        console.log(`[${debugKey}] WARNING: payloadScheduled was empty so flight_status was NOT written (effectiveInfo.flightStatus =`, effectiveInfo.flightStatus, ')');
      }

      if (Object.keys(payloadActual).length > 0) {
        const { error } = await supabase.from('flights').update(payloadActual).eq('id', flight.id);
        if (error) {
          const missingCol =
            error.message?.includes("Could not find the 'actual_departure' column") ||
            error.message?.includes("Could not find the 'actual_arrival' column");
          if (!missingCol) {
            console.log('[Roster] actual update failed', { flight: flight.flight_number, id: flight.id, error: error.message });
          }
        } else if (debugKey === 'PC978' || debugKey === 'PC615' || debugKey === 'PC1134' || debugKey === 'PC2088' || debugKey === 'PC2199' || debugKey === 'PC2289') {
          console.log(`[Debug ${debugKey}] DB updated actual keys:`, Object.keys(payloadActual));
        }
      }
      // Push notifications to family are now sent only from backend cron
      // (check-flight-status-and-notify + notify-family). App no longer triggers them directly.
    };

    // Run per-flight updates with limited concurrency so total refresh süresi kısalır.
    const concurrency = 8;
    const queue = [...list];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = queue.shift();
        if (!next) break;
        await processFlight(next);
      }
    });
    await Promise.all(workers);
    if (!silent) setUpdatingTimes(false);
    setRosterLastSyncedAt();
    const todayLocal = getLocalDateString();
    const minFlightDate = getLocalDateStringPlusDays(-getRosterMinDaysAgo(exemptLandedAutoPurge, isCrew));
    if (listOverride?.length === 1) {
      const id = listOverride[0].id;
      const { data: one, error: oneErr } = await fetchCrewRosterFlightRowById(supabase, id);
      if (!oneErr && one) {
        const [normed] = mapCrewRosterFetchedRows([one]);
        setFlights((prev) => prev.map((f) => (f.id === id ? { ...f, ...normed } : f)));
      }
      return;
    }
    // Listeyi sadece güncellenen uçuşlarla değiştirme (PC1029 gibi pencerenin dışındakiler kaybolmasın).
    // Tam roster'ı DB'den tekrar çek.
    if (!crewProfile?.id) return;
    const flightIds = await fetchFlightIdsForCrew(supabase, crewProfile.id, minFlightDate);
    if (flightIds.length === 0) {
      if (!silent) setUpdatingTimes(false);
      return;
    }
    const { data: rawList, error: listErr } = await fetchCrewRosterFlightsByIds(supabase, flightIds);
    if (listErr || !rawList) return;
    const data = mapCrewRosterFetchedRows(rawList);
    const fullList = await normalizeFutureLandedInDb(data as any[]);
    const { kept, dbPurgeIds } = await removeFlightsLandedOver6hAgo(fullList, {
      adminSkipLandedPurge: exemptLandedAutoPurge,
    });
    scheduleLandedFlightsDbPurge(supabase, crewProfile.id, dbPurgeIds);
    if (kept.length > 0 || flightsRef.current.length === 0) {
      setFlights(kept);
    }
  }, [
    isCrew,
    crewProfile?.id,
    normalizeFutureLandedInDb,
    exemptLandedAutoPurge,
    getAutoRefreshList,
  ]);

  /** Crew: re-fetch list from DB so cron-updated flight_status (e.g. landed) is visible without waiting for API refresh. */
  const refreshCrewListFromDb = useCallback(async () => {
    if (!isCrew || !crewProfile?.id) return;
    const minFlightDate = getLocalDateStringPlusDays(-getRosterMinDaysAgo(exemptLandedAutoPurge, isCrew));
    const flightIds = await fetchFlightIdsForCrew(supabase, crewProfile.id, minFlightDate);
    if (flightIds.length === 0) return;
    const { data, error } = await fetchCrewRosterFlightsByIds(supabase, flightIds);
    if (error || !data) return;
    const normalized = await normalizeFutureLandedInDb(mapCrewRosterFetchedRows(data) as any[]);
    const { kept, dbPurgeIds } = await removeFlightsLandedOver6hAgo(normalized as any, {
      adminSkipLandedPurge: exemptLandedAutoPurge,
    });
    scheduleLandedFlightsDbPurge(supabase, crewProfile.id, dbPurgeIds);
    if (kept.length > 0 || flightsRef.current.length === 0) setFlights(kept);
    setRosterLastSyncedAt();
  }, [isCrew, crewProfile?.id, normalizeFutureLandedInDb, exemptLandedAutoPurge]);

  const refreshFamilyListFromDb = useCallback(async () => {
    if (isCrew || !profile?.id) return;

    let allCrewIds: string[] = [];
    if (effectivePeerView?.peerCrewId) {
      setSubscriptionAccessLoading(true);
      const peerAccess = await fetchCrewRosterAccess(effectivePeerView!.peerCrewId).catch(() => null);
      setSubscriptionAccessLoading(false);
      setSubscriptionAccess({
        role: 'crew',
        crew_id: effectivePeerView!.peerCrewId,
        plan_code: null,
        plan_title: peerAccess?.plan_title ?? 'crew_peer',
        subscription_status: (peerAccess?.subscription_status as SubscriptionAccess['subscription_status']) ?? null,
        trial_ends_at: null,
        current_period_ends_at: null,
        base_family_members: null,
        extra_family_slots: 0,
        max_extra_family_members: 0,
        extra_family_member_price_usd: null,
        max_family_members: null,
        used_family_approved: 0,
        used_family_pending: 0,
        available_family_slots: 0,
        can_invite_more: false,
        has_access: !!peerAccess?.has_access,
      });
      if (!peerAccess?.has_access) {
        setFlights([]);
        return;
      }
      allCrewIds = [effectivePeerView!.peerCrewId];
      setFamilyCrewOptions([{ id: effectivePeerView!.peerCrewId, name: effectivePeerView!.peerName }]);
      familyCrewFilterIdRef.current = effectivePeerView!.peerCrewId;
      setFamilyCrewFilterId(effectivePeerView!.peerCrewId);
      console.log('[PeerRoster] loading peer crew:', effectivePeerView!.peerCrewId, effectivePeerView!.peerName);
    } else {
      setSubscriptionAccessLoading(true);
      const access = await fetchMySubscriptionAccess().catch(() => null);
      setSubscriptionAccess(access);
      setSubscriptionAccessLoading(false);
      if (!access?.has_access) {
        setFlights([]);
        return;
      }
      const { data: conns } = await supabase
        .from('family_connections')
        .select('crew_id')
        .eq('family_id', profile.id)
        .eq('status', 'approved');
      allCrewIds = (conns ?? []).map((c: { crew_id: string }) => c.crew_id);
      console.log('[FamilyRoster] approved crew connections:', allCrewIds.length, 'crewIds:', allCrewIds.slice(0, 3));

      // Names for multi-crew picker
      if (allCrewIds.length > 0) {
        const { data: nameRows } = await supabase.rpc('get_family_connections_with_names');
        const opts: Array<{ id: string; name: string }> = [];
        for (const row of nameRows ?? []) {
          const r = row as { crew_id?: string; other_name?: string | null; status?: string };
          if (r.status !== 'approved' || !r.crew_id) continue;
          if (!allCrewIds.includes(r.crew_id)) continue;
          opts.push({ id: r.crew_id, name: (r.other_name || t('family.crewMember')).trim() });
        }
        // Deduplicate by crew id
        const seen = new Set<string>();
        const unique = opts.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
        setFamilyCrewOptions(unique);
        if (familyCrewFilterIdRef.current !== 'all' && !unique.some((o) => o.id === familyCrewFilterIdRef.current)) {
          familyCrewFilterIdRef.current = 'all';
          setFamilyCrewFilterId('all');
        }
      } else {
        setFamilyCrewOptions([]);
        familyCrewFilterIdRef.current = 'all';
        setFamilyCrewFilterId('all');
      }
    }

    const filterId = familyCrewFilterIdRef.current;
    const crewIds = effectivePeerView?.peerCrewId
      ? [effectivePeerView!.peerCrewId]
      : filterId !== 'all' && allCrewIds.includes(filterId)
        ? [filterId]
        : allCrewIds;
    if (crewIds.length === 0) {
      if (flightsRef.current.length === 0) setFlights([]);
      setViewedCrewHomeBases([]);
      return;
    }
    // Görüntülenen crew home base — aile/peer yatı (SECURITY DEFINER; RLS own-only kırılmaz).
    try {
      const { data: baseRows, error: baseErr } = await supabase.rpc('get_connected_crew_home_bases', {
        p_crew_ids: crewIds,
      });
      if (baseErr) {
        // Eski projeler: migration yoksa doğrudan select dene (policy sonrası).
        const { data: fallback } = await supabase
          .from('crew_profiles')
          .select('id, home_base_iata')
          .in('id', crewIds);
        const bases = [
          ...new Set(
            (fallback ?? [])
              .map((r: { home_base_iata?: string | null }) => (r.home_base_iata ?? '').trim().toUpperCase())
              .filter(Boolean),
          ),
        ];
        setViewedCrewHomeBases(bases);
      } else {
        const bases = [
          ...new Set(
            (baseRows ?? [])
              .map((r: { home_base_iata?: string | null }) => (r.home_base_iata ?? '').trim().toUpperCase())
              .filter(Boolean),
          ),
        ];
        setViewedCrewHomeBases(bases);
      }
    } catch {
      setViewedCrewHomeBases([]);
    }
    const minFlightDate = getLocalDateStringPlusDays(-getRosterMinDaysAgo(exemptLandedAutoPurge, isCrew));
    const flightIds = await fetchFlightIdsForFamily(supabase, crewIds, minFlightDate);
    console.log('[FamilyRoster] flightIds for family:', flightIds.length, 'minFlightDate:', minFlightDate);
    if (flightIds.length === 0) {
      if (flightsRef.current.length === 0) setFlights([]);
      return;
    }
    // Aile/peer listesi: kolon yoksa (aircraft_type vb.) düşürüp yeniden dene.
    let familyFlightCols =
      'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, delay_dep_min, delay_arr_min, is_delayed, flight_status, internal_status, diverted_to, api_refresh_phase, phase_active_locked, estimated_departure, estimated_arrival, roster_entry_kind, duty_rest_end, roster_detail, aircraft_registration, aircraft_type, fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent';
    let data: any[] | null = null;
    let error: { message: string } | null = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      const res = await supabase
        .from('flights')
        .select(familyFlightCols)
        .in('id', flightIds)
        .order('flight_date', { ascending: true });
      if (!res.error) {
        data = res.data;
        error = null;
        break;
      }
      error = res.error;
      let next = familyFlightCols;
      if (
        isMissingColumn(error.message, 'fr24_progress_dep_utc') ||
        isMissingColumn(error.message, 'fr24_progress_eta_utc') ||
        isMissingColumn(error.message, 'fr24_datetime_takeoff_utc') ||
        isMissingColumn(error.message, 'fr24_datetime_landed_utc') ||
        isMissingColumn(error.message, 'fr24_first_seen_utc') ||
        isMissingColumn(error.message, 'airlabs_progress_percent')
      ) {
        next = next.replace(
          ', fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent',
          '',
        );
      }
      if (isMissingColumn(error.message, 'aircraft_type')) {
        next = next.replace(', aircraft_type', '');
      }
      if (isMissingColumn(error.message, 'aircraft_registration')) {
        next = next.replace(', aircraft_registration', '');
      }
      if (isMissingColumn(error.message, 'roster_detail')) {
        next = next.replace(', roster_detail', '');
      }
      if (isMissingColumn(error.message, 'roster_entry_kind')) {
        next = next.replace(', roster_entry_kind, duty_rest_end', '');
      }
      if (isMissingColumn(error.message, 'api_refresh_phase')) {
        next = next.replace(', api_refresh_phase, phase_active_locked, estimated_departure, estimated_arrival', '');
      }
      if (isMissingColumn(error.message, 'diverted_to')) {
        next = next.replace(', diverted_to', '');
      }
      if (isMissingColumn(error.message, 'delay_dep_min') || isMissingColumn(error.message, 'delay_arr_min')) {
        next = next.replace(', delay_dep_min, delay_arr_min', '');
      }
      if (isMissingColumn(error.message, 'actual_departure') || isMissingColumn(error.message, 'actual_arrival')) {
        next = next.replace(', actual_departure, actual_arrival', '');
      }
      if (next === familyFlightCols) break;
      familyFlightCols = next;
    }

    const missingActual =
      error && (isMissingColumn(error.message, 'actual_departure') || isMissingColumn(error.message, 'actual_arrival'));
    const missingDivertedTo = isMissingColumn(error?.message, 'diverted_to');
    const missingDelayDep = isMissingColumn(error?.message, 'delay_dep_min') || isMissingColumn(error?.message, 'delay_dep');
    const missingDelayArr = isMissingColumn(error?.message, 'delay_arr_min') || isMissingColumn(error?.message, 'delay_arr');
    const missingApiPhaseFam = isMissingColumn(error?.message, 'api_refresh_phase');
    if (
      error &&
      missingApiPhaseFam &&
      !missingActual &&
      !missingDivertedTo &&
      !missingDelayDep &&
      !missingDelayArr
    ) {
      const { data: retry, error: retryErr } = await supabase
        .from('flights')
        .select(familyFlightCols.replace(', api_refresh_phase, phase_active_locked, estimated_departure, estimated_arrival', ''))
        .in('id', flightIds)
        .order('flight_date', { ascending: true });
      if (!retryErr && retry) {
        const list = retry.map((row: any) => ({ ...row, api_refresh_phase: null, crew_profiles: null }));
        const normalized = await normalizeFutureLandedInDb(list);
        const { kept } = await removeFlightsLandedOver6hAgo(normalized as any, {
          adminSkipLandedPurge: exemptLandedAutoPurge,
        });
        if (kept.length > 0 || flightsRef.current.length === 0) setFlights(kept);
        setRosterLastSyncedAt();
        return;
      }
    }
    if (
      missingActual ||
      missingDivertedTo ||
      missingDelayDep ||
      missingDelayArr ||
      missingApiPhaseFam
    ) {
      const fallbackCols =
        'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, internal_status, aircraft_registration';
      const { data: fallback } = await supabase
        .from('flights')
        .select(fallbackCols)
        .in('id', flightIds)
        .order('flight_date', { ascending: true });
      console.log('[FamilyRoster] flights fetched (fallback)', fallback?.length ?? 0);
      const fallbackList = (fallback ?? []).map((row: any) => ({
        ...row,
        actual_departure: row.actual_departure ?? null,
        actual_arrival: row.actual_arrival ?? null,
        diverted_to: row.diverted_to ?? null,
        crew_profiles: null,
      }));
      const normalizedFallback = await normalizeFutureLandedInDb(fallbackList);
      const { kept: fallbackKept } = await removeFlightsLandedOver6hAgo(normalizedFallback as any, {
        adminSkipLandedPurge: exemptLandedAutoPurge,
      });
      if (fallbackKept.length > 0 || flightsRef.current.length === 0) setFlights(fallbackKept);
      setRosterLastSyncedAt();
      return;
    }

    if (error) {
      console.log('[FamilyRoster] flights select failed', error.message);
    }
    const list = (data ?? []).map((row: any) => ({
      ...row,
      crew_profiles: null,
    }));
    const normalized = await normalizeFutureLandedInDb(list);
    const { kept } = await removeFlightsLandedOver6hAgo(normalized as any, {
      adminSkipLandedPurge: exemptLandedAutoPurge,
    });
    console.log('[FamilyRoster] flights fetched', (data ?? []).length, 'after landed filter', kept.length);
    if (kept.length > 0 || flightsRef.current.length === 0) setFlights(kept);
    setRosterLastSyncedAt();
  }, [isCrew, profile?.id, normalizeFutureLandedInDb, exemptLandedAutoPurge, effectivePeerView?.peerCrewId, effectivePeerView?.peerName, t]);

  /** Family: API’den güncelle (öncelik). Crew uçarken offline; family tek başına bilgi alır. */
  const refreshFamilyListFromApi = useCallback(async (silent = false, listOverride?: Flight[]) => {
    if (isCrew || !profile?.id) return;
    if (!subscriptionAccess?.has_access) return;
    const list = listOverride ?? flightsRef.current;
    if (list.length === 0) return;
    const singleFlight = listOverride?.length === 1;
    const shouldToggleRefreshing = !singleFlight && !silent;
    if (shouldToggleRefreshing) setRefreshingList(true);
    try {
      const updates: Array<{
      flightId: string;
      scheduled_departure?: string | null;
      scheduled_arrival?: string | null;
      actual_departure?: string | null;
      actual_arrival?: string | null;
      delay_dep_min?: number | null;
      delay_arr_min?: number | null;
      flight_status?: string | null;
      origin_city?: string | null;
      destination_city?: string | null;
      is_delayed?: boolean | null;
      diverted_to?: string | null;
      fr24_progress_dep_utc?: string | null;
      fr24_progress_eta_utc?: string | null;
      fr24_datetime_takeoff_utc?: string | null;
      fr24_datetime_landed_utc?: string | null;
      fr24_first_seen_utc?: string | null;
      airlabs_progress_percent?: number | null;
      aircraft_registration?: string | null;
      }> = [];
      const FAMILY_UPDATE_CONCURRENCY = 6;
      for (let i = 0; i < list.length; i += FAMILY_UPDATE_CONCURRENCY) {
        const chunk = list.slice(i, i + FAMILY_UPDATE_CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (flight) => {
            if (flight.roster_entry_kind === 'duty_off' || flight.roster_entry_kind === 'sim') {
              return { flight, info: null };
            }
            const nowMs = Date.now();
            const phase = computeApiRefreshPhase(flightPhaseComputeArgs(flight as Flight, nowMs));
            const effectivePhase: 'semi_active' | 'active' | null =
              phase === 'semi_active' || phase === 'active'
                ? phase
                : (shouldForceLookupForMissingSchedule(flight) ? 'semi_active' : null);
            const info =
              effectivePhase
                ? await pollFlightForRoster(flight.flight_number, flight.flight_date, effectivePhase)
                : null;
            return { flight, info };
          })
        );
        for (const { flight, info } of results) {
          if (!info) continue;
          if (info.groundSpeedKts != null || info.altitudeFt != null) {
            setLiveMetricsById((prev) => ({
              ...prev,
              [flight.id]: {
                gs: info.groundSpeedKts ?? prev[flight.id]?.gs,
                altFt: info.altitudeFt ?? prev[flight.id]?.altFt,
                atUtc: info.lastTrackUtc ?? prev[flight.id]?.atUtc,
              },
            }));
          }
          const famTakeoffEarly = info.fr24_datetime_takeoff_utc ?? info.datetime_takeoff_utc;
          if (famTakeoffEarly) {
            setFr24TakeoffUtcByFlightId((prev) =>
              prev[flight.id] === famTakeoffEarly ? prev : { ...prev, [flight.id]: famTakeoffEarly },
            );
          }
          if (info.first_seen_utc) {
            setFr24FirstSeenUtcByFlightId((prev) =>
              prev[flight.id] === info.first_seen_utc ? prev : { ...prev, [flight.id]: info.first_seen_utc! },
            );
          }
          const polledRegFam = String(
            info.aircraftRegistration ?? (info as { aircraft_registration?: string }).aircraft_registration ?? '',
          ).trim().toUpperCase();
          if (polledRegFam) {
            setAircraftRegById((prev) => (prev[flight.id] === polledRegFam ? prev : { ...prev, [flight.id]: polledRegFam }));
            setFlights((prev) => prev.map((f) => (f.id === flight.id ? { ...f, aircraft_registration: polledRegFam } : f)));
          }
          const u: (typeof updates)[0] = { flightId: flight.id };
          if (info.scheduled_departure_utc != null) u.scheduled_departure = info.scheduled_departure_utc;
          if (info.scheduled_arrival_utc != null) u.scheduled_arrival = info.scheduled_arrival_utc;
          if (info.actual_departure_utc != null) u.actual_departure = info.actual_departure_utc;
          if (info.actual_arrival_utc != null) u.actual_arrival = info.actual_arrival_utc;
          if (info.flightStatus != null) u.flight_status = info.flightStatus;
          if (info.originCity != null) u.origin_city = info.originCity;
          if (info.destinationCity != null) u.destination_city = info.destinationCity;
          if (info.delayed != null) u.is_delayed = info.delayed;
          if (info.delayDepMin != null) u.delay_dep_min = info.delayDepMin;
          if (info.delayArrMin != null) u.delay_arr_min = info.delayArrMin;
          if (info.divertedTo != null) u.diverted_to = info.divertedTo;
          if (info.fr24_progress_dep_utc != null) u.fr24_progress_dep_utc = info.fr24_progress_dep_utc;
          if (info.fr24_progress_eta_utc != null) u.fr24_progress_eta_utc = info.fr24_progress_eta_utc;
          const famTakeoff = info.fr24_datetime_takeoff_utc ?? info.datetime_takeoff_utc;
          if (famTakeoff != null) u.fr24_datetime_takeoff_utc = famTakeoff;
          if (info.fr24_datetime_landed_utc != null) u.fr24_datetime_landed_utc = info.fr24_datetime_landed_utc;
          if (info.first_seen_utc != null) u.fr24_first_seen_utc = info.first_seen_utc;
          if (info.airlabsProgressPercent != null) u.airlabs_progress_percent = info.airlabsProgressPercent;
          const regFamSave = String(
            info.aircraftRegistration ?? (info as { aircraft_registration?: string }).aircraft_registration ?? '',
          ).trim().toUpperCase();
          if (regFamSave) u.aircraft_registration = regFamSave;
          if (Object.keys(u).length > 1) updates.push(u);
        }
      }
      if (updates.length > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          await supabase.functions.invoke('update-flights-from-api', {
            body: { updates },
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
        }
      }
      if (singleFlight && list[0]) {
        const id = list[0].id;
        const { data: one } = await supabase
          .from('flights')
          .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, delay_dep_min, delay_arr_min, is_delayed, flight_status, internal_status, diverted_to, api_refresh_phase, phase_active_locked, estimated_departure, estimated_arrival, roster_entry_kind, duty_rest_end, roster_detail, aircraft_registration, fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent, crew_profiles(company_name)')
          .eq('id', id)
          .single();
        if (one) setFlights((prev) => prev.map((f) => (f.id === id ? { ...f, ...one } : f)));
      } else {
        await refreshFamilyListFromDb();
      }
    } finally {
      if (shouldToggleRefreshing) setRefreshingList(false);
    }
  }, [isCrew, profile?.id, refreshFamilyListFromDb, shouldForceLookupForMissingSchedule, subscriptionAccess?.has_access]);

  const refreshFamilyList = useCallback(async () => {
    if (isCrew || !profile?.id) return;
    setRefreshingList(true);
    await refreshFamilyListFromDb();
    setRefreshingList(false);
  }, [isCrew, profile?.id, refreshFamilyListFromDb]);

  /** Pull-to-refresh + “Az önce güncellendi” dokunuşu — ekstra header butonu yok. */
  const runUserRefresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (isCrew && !crewProfile?.id) return;
      if (!isCrew && !profile?.id) return;
      const silent = !!opts?.silent;
      // Sessiz arka plan: kullanıcı yenilemesini engellemesin; kendi kendine çakışmasın.
      if (silent) {
        if (syncInFlightRef.current || autoRefreshInFlightRef.current) return;
        syncInFlightRef.current = true;
        try {
          if (isCrew) {
            await refreshCrewListFromDb();
            await refreshTimesFromApi(true);
            setRosterLastSyncedAt();
          } else {
            await refreshFamilyListFromDb();
            if (flightsRef.current.length > 0) {
              await refreshFamilyListFromApi(true);
            }
            setRosterLastSyncedAt();
          }
          setSyncError(false);
        } catch {
          /* silent: keep prior label; don’t flash error on background */
        } finally {
          syncInFlightRef.current = false;
        }
        return;
      }
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      setSyncError(false);
      setRefreshingList(true);
      try {
        if (isCrew) {
          await refreshCrewListFromDb();
          await refreshTimesFromApi(true);
          setRosterLastSyncedAt();
        } else {
          await refreshFamilyListFromDb();
          if (flightsRef.current.length > 0) {
            await refreshFamilyListFromApi(true);
          }
          setRosterLastSyncedAt();
        }
        setSyncError(false);
      } catch {
        setSyncError(true);
      } finally {
        setRefreshingList(false);
        syncInFlightRef.current = false;
      }
    },
    [
      isCrew,
      crewProfile?.id,
      profile?.id,
      refreshCrewListFromDb,
      refreshTimesFromApi,
      refreshFamilyListFromDb,
      refreshFamilyListFromApi,
    ],
  );

  const handlePullToRefresh = useCallback(async () => {
    await runUserRefresh();
  }, [runUserRefresh]);

  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: !!showAdminFr24Debug,
      ...(showAdminFr24Debug
        ? {
            title: '',
            headerTitleAlign: 'center' as const,
            headerTitle: () => (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => navigation.navigate('AdminPanel')}
                style={{
                  maxWidth: Math.min(300, Dimensions.get('window').width - 128),
                  backgroundColor: colors.surface,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: '#DC2626',
                }}
              >
                <Text
                  style={{
                    color: '#DC2626',
                    fontWeight: '900',
                    fontSize: 12,
                    textAlign: 'center',
                  }}
                  numberOfLines={2}
                >
                  {t('roster.adminModeTitle')}
                </Text>
              </TouchableOpacity>
            ),
          }
        : {}),
    });
  }, [navigation, showAdminFr24Debug, t]);


  useFocusEffect(
    React.useCallback(() => {
      const addedDate = route?.params?.addedFlightDate as string | undefined;
      liveAnchorYmdPrevRef.current = undefined;
      if (addedDate && /^\d{4}-\d{2}-\d{2}$/.test(addedDate)) {
        openRosterAnchorRef.current = { kind: 'added', ymd: addedDate };
      } else {
        openRosterAnchorRef.current = { kind: 'auto' };
      }
      programmaticListScrollRef.current = true;
      lastCalendarWeekIdxRef.current = -1;
      setRosterAnchorNonce((n) => n + 1);
    }, [route?.params?.addedFlightDate]),
  );

  /** Roster açılınca: canlı uçuş → o gün tepeye; yoksa / inince → bugün. */
  useEffect(() => {
    const req = openRosterAnchorRef.current;
    if (!req) return;
    if (loading && flights.length === 0) return;

    const todayLocal = resolveRosterTodayYmd(crewUtcView, familyRosterTz);
    let anchor = todayLocal;
    if (req.kind === 'added') {
      anchor = req.ymd;
    } else {
      const liveYmd = findLiveRosterAnchorYmd(flights, crewUtcView, familyRosterTz);
      anchor = liveYmd ?? todayLocal;
    }
    openRosterAnchorRef.current = null;
    setSelectedDate(anchor);
    setCalendarMonth(anchor.slice(0, 7));
    pendingRosterAnchorRef.current = anchor;
    programmaticListScrollRef.current = true;
    setRosterAnchorNonce((n) => n + 1);
  }, [flights, loading, rosterAnchorNonce, crewUtcView, familyRosterTz]);

  /** Sayfa açıkken canlı uçuş inerse bugüne dön. */
  useEffect(() => {
    if (loading) return;
    if (openRosterAnchorRef.current) return;
    const liveYmd = findLiveRosterAnchorYmd(flights, crewUtcView, familyRosterTz);
    const prev = liveAnchorYmdPrevRef.current;
    liveAnchorYmdPrevRef.current = liveYmd;
    if (prev === undefined) return; // ilk ölçüm
    if (prev && !liveYmd) {
      const todayLocal = resolveRosterTodayYmd(crewUtcView, familyRosterTz);
      setSelectedDate(todayLocal);
      setCalendarMonth(todayLocal.slice(0, 7));
      pendingRosterAnchorRef.current = todayLocal;
      programmaticListScrollRef.current = true;
      setRosterAnchorNonce((n) => n + 1);
    }
  }, [flights, loading, crewUtcView, familyRosterTz]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      // Avoid flicker when we already have a list on screen.
      if (flightsRef.current.length === 0) setLoading(true);
      const done = () => !cancelled && setLoading(false);
      const maybeAutoRefresh = (kept: Flight[]) => {
        // Auto-refresh from APIs only for active flights.
        // Throttle to avoid excessive calls when navigating back/forth, but allow a one-time forced refresh
        // when coming back from Add Flight.
        const now = Date.now();
        const listToUpdate = getAutoRefreshList(kept);
        const forceApiRefresh = !!route?.params?.forceApiRefresh;
        if (!cancelled && forceApiRefresh && listToUpdate.length > 0) {
          lastAutoRefreshMsRef.current = now;
          refreshTimesFromApi(true, listToUpdate).catch(() => {});
          try { navigation.setParams({ forceApiRefresh: undefined }); } catch {}
          return;
        }
        if (!cancelled && listToUpdate.length > 0 && now - lastAutoRefreshMsRef.current > 120_000) {
          lastAutoRefreshMsRef.current = now;
          refreshTimesFromApi(true, listToUpdate).catch(() => {});
        }
      };

      if (isCrew && crewProfile?.id) {
        const minFlightDate = getLocalDateStringPlusDays(-getRosterMinDaysAgo(exemptLandedAutoPurge, isCrew));
        // Önce listeyi çek ve göster; silme işlemini sonra yap (yoksa silme fetch’ten önce biterse liste eksik görünüyor)
        fetchFlightIdsForCrew(supabase, crewProfile.id, minFlightDate)
          .then(async (flightIds) => {
            if (cancelled) return;
            if (flightIds.length === 0) {
              setFlights([]);
              done();
              return;
            }
            const { data, error } = await fetchCrewRosterFlightsByIds(supabase, flightIds);
            if (error) {
              console.log('[Roster] flights select failed', error.message);
              done();
              return;
            }
            const list = mapCrewRosterFetchedRows(data ?? []);
            console.log('[Roster] flights fetched', list.length);
            const { kept, dbPurgeIds } = await removeFlightsLandedOver6hAgo(list, {
              adminSkipLandedPurge: exemptLandedAutoPurge,
            });
            scheduleLandedFlightsDbPurge(supabase, crewProfile?.id, dbPurgeIds);
            if (!cancelled && (kept.length > 0 || flightsRef.current.length === 0)) setFlights(kept);
            maybeAutoRefresh(kept as any);
            done();
            // Listeyi gösterdikten sonra pencere dışı eski uçuşları temizle (admin rosterda tarih penceresi geniş; silme yok).
            if (!cancelled && crewProfile?.id && !exemptLandedAutoPurge) {
              supabase.from('flight_crew').select('flight_id').eq('crew_id', crewProfile.id).then(({ data: fcRows }) => {
                if (fcRows?.length) {
                  const ids = fcRows.map((r: { flight_id: string }) => r.flight_id);
                  supabase.from('flights').select('id').in('id', ids).lt('flight_date', minFlightDate).then(({ data: oldFlights }) => {
                    (oldFlights ?? []).forEach((f: { id: string }) => {
                      supabase.rpc('remove_me_from_flight', { p_flight_id: f.id }).then(() => {});
                    });
                  });
                }
              });
            }
          })
          .catch(() => done());
      } else if (!isCrew && profile?.id) {
        // Use shared DB loader (handles missing columns + consistent filters)
        refreshFamilyListFromDb()
          .catch(() => {})
          .finally(() => done());
      } else {
        done();
      }
      return () => { cancelled = true; };
    }, [
      profile?.id,
      crewProfile?.id,
      isCrew,
      crewUtcView,
      familyRosterTz,
      route.params?.refresh,
      refreshTimesFromApi,
      refreshFamilyListFromDb,
      getAutoRefreshList,
      exemptLandedAutoPurge,
      effectivePeerView?.peerCrewId,
    ])
  );

  // Keep live GS/ALT updated while staying on Roster screen (crew). For family, periodically refresh list from DB (Android & iOS).
  const FAMILY_REFRESH_INTERVAL_MS = 30_000; // 30 s – cron 5 dk'da DB günceller; ekran en geç 30 sn'de yansır
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      if (isCrew && crewProfile?.id) {
        // DB'den periyodik yenileme: cron'un güncellediği flight_status (landed vb.) crew ekranında da görünsün.
        const crewDbIntervalMs = 30_000;
        /** Dış API ~3 dk + jitter — Edge cron ile çakışmayı azaltır; arka planda tamamen durur (AppState). */
        const CREW_API_POLL_BASE_MS = 180_000;
        const CREW_API_POLL_JITTER_MS = 25_000;

        let dbId: ReturnType<typeof setInterval> | undefined;
        let apiId: ReturnType<typeof setInterval> | undefined;

        const dbTick = () => {
          if (!cancelled) refreshCrewListFromDb().catch(() => {});
        };

        const tick = async () => {
          if (cancelled) return;
          if (AppState.currentState !== 'active') return;
          if (autoRefreshInFlightRef.current) return;
          const list = getAutoRefreshList(flightsRef.current);
          if (list.length > 0) {
            autoRefreshInFlightRef.current = true;
            try {
              await refreshTimesFromApi(true, list);
            } catch {
            } finally {
              autoRefreshInFlightRef.current = false;
            }
          }
        };

        const startCrewIntervals = () => {
          if (cancelled || AppState.currentState !== 'active') return;
          if (dbId) clearInterval(dbId);
          if (apiId) clearInterval(apiId);
          dbId = setInterval(dbTick, crewDbIntervalMs);
          const apiMs = CREW_API_POLL_BASE_MS + Math.floor(Math.random() * CREW_API_POLL_JITTER_MS);
          apiId = setInterval(tick, apiMs);
        };

        const stopCrewIntervals = () => {
          if (dbId) clearInterval(dbId);
          if (apiId) clearInterval(apiId);
          dbId = undefined;
          apiId = undefined;
        };

        const onAppState = (s: AppStateStatus) => {
          if (cancelled) return;
          if (s === 'active') {
            dbTick();
            tick();
            startCrewIntervals();
            // Son güncelleme > 5 dk ise tam yenile (aktif uçuş poll’undan bağımsız).
            const last = getRosterLastSyncedAt();
            if (last == null || Date.now() - last >= 5 * 60_000) {
              void runUserRefresh({ silent: true });
            }
          } else {
            stopCrewIntervals();
          }
        };

        dbTick();
        if (AppState.currentState === 'active') {
          tick();
          startCrewIntervals();
        }
        const appSub = AppState.addEventListener('change', onAppState);

        return () => {
          cancelled = true;
          appSub.remove();
          stopCrewIntervals();
        };
      }

      if (!isCrew && profile?.id) {
        const tick = () => {
          if (cancelled) return;
          refreshFamilyListFromDb().catch(() => {});
        };
        const onAppState = (s: AppStateStatus) => {
          if (cancelled || s !== 'active') return;
          tick();
          const last = getRosterLastSyncedAt();
          if (last == null || Date.now() - last >= 5 * 60_000) {
            void runUserRefresh({ silent: true });
          }
        };
        const id = setInterval(tick, FAMILY_REFRESH_INTERVAL_MS);
        const appSub = AppState.addEventListener('change', onAppState);
        return () => {
          cancelled = true;
          clearInterval(id as any);
          appSub.remove();
        };
      }

      return () => { cancelled = true; };
    }, [isCrew, crewProfile?.id, profile?.id, getAutoRefreshList, refreshTimesFromApi, refreshFamilyListFromDb, refreshCrewListFromDb, runUserRefresh])
  );

  const formatDate = formatFlightDateTr;
  const formatRosterDayLabel = useCallback(
    (dateYmd: string) => {
      const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
      const tz = crewUtcView ? 'UTC' : familyRosterTz || 'UTC';
      // Öğlen UTC — takvim gününü TZ kaymasıyla bozmamak için.
      const d = new Date(`${dateYmd}T12:00:00Z`);
      if (Number.isNaN(d.getTime())) return dateYmd;
      const weekdayShort = d
        .toLocaleDateString(locale, { weekday: 'short', timeZone: tz })
        .replace(/\.$/, '');
      const dayMonth = d.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        timeZone: tz,
      });
      // tr-TR "Cumartesi" short bazen "Cum" olur; takvim şeridiyle uyum için düzelt.
      const short =
        locale === 'tr-TR'
          ? (() => {
              const long = d.toLocaleDateString(locale, { weekday: 'long', timeZone: tz }).toLocaleLowerCase('tr-TR');
              if (long.startsWith('cumartesi')) return 'Cmt';
              if (long.startsWith('cuma')) return 'Cum';
              if (long.startsWith('pazartesi')) return 'Pzt';
              if (long.startsWith('salı')) return 'Sal';
              if (long.startsWith('çarşamba')) return 'Çar';
              if (long.startsWith('perşembe')) return 'Per';
              if (long.startsWith('pazar')) return 'Paz';
              return weekdayShort;
            })()
          : weekdayShort;
      return `${short}, ${dayMonth}`;
    },
    [crewUtcView, familyRosterTz, i18n.language]
  );
  /** Nöbet kartı: "09 Eylül" (gün + ay, hafta günü yok). */
  const formatStandbyDayMonth = useCallback(
    (dateYmd: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return dateYmd;
      const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
      const d = new Date(`${dateYmd}T12:00:00Z`);
      if (Number.isNaN(d.getTime())) return dateYmd;
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = d.toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' });
      return `${day} ${month}`;
    },
    [i18n.language],
  );
  const formatTimeUTC = (iso: string | null) => formatFlightTimeUTC(iso);
  const formatTimeLocal = (iso: string | null) => formatFlightTimeLocal(iso);
  /**
   * Nöbet/SIM/off: uçuşta IATA yok; aksi belirtilmedikçe base istasyonunda nöbette olunur.
   * Saatler `home_base_iata` TZ’sinde (yoksa Europe/Istanbul).
   */
  const dutyStationIata = (layoverHomeBases[0] ?? '').trim().toUpperCase() || null;
  const dutyStationTz =
    (dutyStationIata ? getAirportTimezone(dutyStationIata) : null) ?? 'Europe/Istanbul';
  const formatTimeDutyAtBase = (iso: string | null) => formatFlightTimeInTz(iso, dutyStationTz);
  const nowMs = Date.now() + nowTick;
  /** Aile: profil TZ veya cihaz; bölge etiketi (örn. TR). */
  const familyTzResolved = familyRosterTz ?? getDeviceIanaTimeZone();
  const familyRegionTag = regionCodeForIanaTimeZone(familyTzResolved);
  const formatTimeFamilyLocal = (iso: string | null) => formatFlightTimeInTz(iso, familyTzResolved);
  const formatTimeCrewAtOrigin = (iso: string | null, origin: string | null | undefined) =>
    formatFlightTimeInTz(iso, getAirportTimezone(origin) ?? 'UTC');
  const formatTimeCrewAtDest = (iso: string | null, dest: string | null | undefined) =>
    formatFlightTimeInTz(iso, getAirportTimezone(dest) ?? 'UTC');
  const crewStationTag = (iata: string | null | undefined) => (iata || '—').toUpperCase().slice(0, 3);
  /** Parse stored datetime as UTC for status logic. */
  const parseUtcMs = (iso: string | null | undefined): number => {
    const d = parseFlightTimeAsUtc(iso);
    return d ? d.getTime() : 0;
  };

  useEffect(() => {
    // Keep progress bar moving without API refresh.
    const id = setInterval(() => setNowTick((x) => (x + 1) % 1_000_000), 30_000);
    return () => clearInterval(id as any);
  }, []);

  /** `getFlightStatus` öncesi ham faz — aktif fazda first_seen / çubuk kuralları. */
  const getRosterRefreshPhase = (f: Flight): ApiRefreshPhase | null => {
    if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') return null;
    return computeApiRefreshPhase(flightPhaseComputeArgs(f, nowMs));
  };

  /**
   * Aktif faz: kalkış yok → %0. Kalkış (FR24 datetime_takeoff) → çubuk başı.
   * Çubuk sonu = STA + kalkışa kadar kalkış gecikmesi = STA + max(0, takeoff − STD) (blok süresi korunur).
   * Diğer fazlar: bitiş için ETA / FR24 ETA / sentetik (önceki yedek).
   */
  const getFlightProgressBounds = (f: Flight): { depMs: number; endMs: number } | null => {
    if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') return null;
    const rawStatus = String(f.flight_status ?? '').toLowerCase();
    if (rawStatus === 'landed' || rawStatus === 'parked') return null;
    const landFr = parseUtcMs(f.fr24_datetime_landed_utc ?? null);
    if (landFr > 0 && nowMs >= landFr) return null;
    const actArrMs = parseUtcMs(f.actual_arrival ?? null);
    if (actArrMs > 0 && nowMs >= actArrMs) return null;

    const takeoffMs = parseUtcMs(f.fr24_datetime_takeoff_utc ?? fr24TakeoffUtcByFlightId[f.id] ?? null);
    if (!takeoffMs) return { depMs: 0, endMs: 0 };

    const depMs = takeoffMs;
    const stdMs = parseUtcMs(f.scheduled_departure ?? null);
    const staMs = parseUtcMs(f.scheduled_arrival ?? null);
    let staUse = staMs;
    if (stdMs > 0 && staMs > 0 && staMs <= stdMs) {
      staUse = staMs + 24 * 60 * 60 * 1000;
    }
    const blockMs = stdMs > 0 && staUse > stdMs ? staUse - stdMs : 0;
    const delayArrMs =
      typeof f.delay_arr_min === 'number' && f.delay_arr_min > 0 ? Math.round(f.delay_arr_min * 60_000) : 0;

    let endMs = 0;
    if (stdMs > 0 && staUse > stdMs) {
      endMs = staUse + Math.max(0, takeoffMs - stdMs);
    }
    if (endMs <= 0) {
      endMs =
        parseUtcMs(f.estimated_arrival ?? null) || parseUtcMs(f.fr24_progress_eta_utc ?? null) || 0;
      if (endMs <= 0 && staUse > 0) {
        let synthetic = staUse + delayArrMs;
        if (blockMs > 0 && depMs > 0 && depMs > stdMs) {
          synthetic = Math.max(synthetic, depMs + blockMs);
        }
        endMs = synthetic;
      }
    }
    if (endMs > 0 && depMs > 0 && endMs <= depMs && blockMs > 0) {
      endMs = depMs + blockMs;
    }
    if (depMs <= 0 || endMs <= 0 || endMs <= depMs) return null;
    return { depMs, endMs };
  };

  const formatShortDurationFromMs = (msRaw: number): string => {
    const mins = Math.max(0, Math.round(msRaw / 60000));
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    if (hours > 0) return t('roster.durationShort', { hours, mins: rest });
    return t('roster.durationMinsOnly', { mins: rest });
  };

  const getFlightProgress = (f: Flight): number | null => {
    if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') return null;
    const rawStatus = String(f.flight_status ?? '').toLowerCase();
    if (rawStatus === 'landed' || rawStatus === 'parked') return 1;
    const landFr = parseUtcMs(f.fr24_datetime_landed_utc ?? null);
    if (landFr > 0 && nowMs >= landFr) return 1;
    const actArrMs = parseUtcMs(f.actual_arrival ?? null);
    if (actArrMs > 0 && nowMs >= actArrMs) return 1;

    const bounds = getFlightProgressBounds(f);
    if (!bounds) return null;
    if (!bounds.depMs) return 0;
    if (nowMs <= bounds.depMs) return 0;
    if (nowMs >= bounds.endMs) return 1;
    const p = (nowMs - bounds.depMs) / (bounds.endMs - bounds.depMs);
    if (!Number.isFinite(p)) return null;
    return Math.min(1, Math.max(0, p));
  };

  const formatProgressPercent = (p: number): string => {
    const pct = Math.round(p * 100);
    const lang = String(i18n?.language ?? '').toLowerCase();
    return lang.startsWith('tr') ? `%${pct}` : `${pct}%`;
  };

  const formatDelayCompact = (minutesRaw: number): string => {
    const minutes = Math.max(0, Math.round(minutesRaw));
    const lang = String(i18n?.language ?? '').toLowerCase();
    const isTr = lang.startsWith('tr');
    if (minutes < 60) return isTr ? `+${minutes} dk` : `+${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (rest === 0) return isTr ? `+${hours} sa` : `+${hours} h`;
    return isTr ? `+${hours} sa ${rest} dk` : `+${hours} h ${rest} min`;
  };

  const getDelayCalendarColor = (minutes: number | null): string | null => {
    if (minutes == null || minutes <= ROSTER_DELAY_DISPLAY_MIN_EXCLUSIVE) return null;
    if (minutes < 45) return '#F59E0B';
    if (minutes < 90) return '#DC2626';
    return '#7F1D1D';
  };

  /** FR24 first_seen vs STD — DB + poll bellek önbelleği (`fr24FirstSeenUtcByFlightId`). */
  const delayMinutesFirstSeenAfterStd = (f: Flight): number | null =>
    departureDelayMinutesFirstSeenAfterStd(
      f.scheduled_departure,
      f.fr24_first_seen_utc ?? fr24FirstSeenUtcByFlightId[f.id] ?? null,
    );

  const getDelayMinutesUnfiltered = (f: Flight): number | null => {
    if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') return null;
    const status = getFlightStatus(f);
    const isAfterTakeoff = status === 'en_route' || status === 'departed' || status === 'landed' || status === 'parked';
    const depDelay = typeof f.delay_dep_min === 'number' ? f.delay_dep_min : null;
    const arrDelay = typeof f.delay_arr_min === 'number' ? f.delay_arr_min : null;
    const cached = delayById[f.id];
    const depDelayCached = typeof cached?.dep === 'number' ? cached.dep : null;
    const arrDelayCached = typeof cached?.arr === 'number' ? cached.arr : null;
    const etaMs = parseUtcMs(f.estimated_arrival ?? f.fr24_progress_eta_utc ?? null);
    const staMs = parseUtcMs(f.scheduled_arrival ?? null);
    const landMs = parseUtcMs(f.fr24_datetime_landed_utc ?? f.actual_arrival ?? null);
    const derivedArrivalDelay =
      Number.isFinite(etaMs) && Number.isFinite(staMs) ? Math.max(0, Math.round((etaMs - staMs) / 60_000)) : null;
    // İniş sonrası: gerçek ATA−STA. Stale ETA / AirLabs arr_delayed / kalkış gecikmesi göstermeyi kes.
    // 1–14 dk geç iniş normal; ≥15 dk gecikme.
    if ((status === 'landed' || status === 'parked') && landMs > 0 && staMs > 0) {
      const actualArrDelay = Math.round((landMs - staMs) / 60_000);
      return actualArrDelay >= ARRIVAL_LATE_THRESHOLD_MIN ? actualArrDelay : null;
    }
    const revisedSignal =
      (() => {
        const estDepMs = parseUtcMs(f.estimated_departure ?? null);
        const schDepMs = parseUtcMs(f.scheduled_departure ?? null);
        const estArrMs = parseUtcMs(f.estimated_arrival ?? null);
        const schArrMs = parseUtcMs(f.scheduled_arrival ?? null);
        const depShift = Number.isFinite(estDepMs) && Number.isFinite(schDepMs)
          ? Math.abs(estDepMs - schDepMs) >= 5 * 60_000
          : false;
        const arrShift = Number.isFinite(estArrMs) && Number.isFinite(schArrMs)
          ? Math.abs(estArrMs - schArrMs) >= 5 * 60_000
          : false;
        return depShift || arrShift;
      })();
    const phase = getRosterRefreshPhase(f);
    const fsDelay =
      phase === 'active' || phase === 'semi_active' ? delayMinutesFirstSeenAfterStd(f) : null;

    // Revised/estimated exists:
    // - before takeoff => show departure delay
    // - after takeoff => switch to arrival delay
    if (revisedSignal) {
      if (!isAfterTakeoff) {
        if (depDelay && depDelay > 0) return depDelay;
        if (depDelayCached && depDelayCached > 0) return depDelayCached;
        return null;
      }
      if (arrDelay && arrDelay > 0) return arrDelay;
      if (arrDelayCached && arrDelayCached > 0) return arrDelayCached;
      if (derivedArrivalDelay != null && derivedArrivalDelay > 0) return derivedArrivalDelay;
      if (depDelayCached && depDelayCached > 0) return depDelayCached;
      return null;
    }

    // No revised signal:
    // - before takeoff => keep existing departure heuristics
    // - after takeoff => prefer arrival ETA/STA based delay
    if (isAfterTakeoff) {
      if (arrDelay && arrDelay > 0) return arrDelay;
      if (arrDelayCached && arrDelayCached > 0) return arrDelayCached;
      if (derivedArrivalDelay != null && derivedArrivalDelay > 0) return derivedArrivalDelay;
      if (depDelayCached && depDelayCached > 0) return depDelayCached;
      if (fsDelay != null) return fsDelay;
      return null;
    }

    if (status === 'scheduled') {
      const fromApi = depDelay && depDelay > 0 ? depDelay : null;
      const fromCache = depDelayCached && depDelayCached > 0 ? depDelayCached : null;
      const base = fromApi ?? fromCache;
      if (base != null && fsDelay != null) return Math.max(base, fsDelay);
      return base ?? fsDelay ?? null;
    }
    if (status === 'taxi_out') {
      const fromApi = depDelay && depDelay > 0 ? depDelay : null;
      const fromCache = depDelayCached && depDelayCached > 0 ? depDelayCached : null;
      let base = fromApi ?? fromCache;
      const stdMs = parseUtcMs(f.scheduled_departure ?? null);
      if (stdMs > 0 && nowMs > stdMs + 120_000) {
        const impliedNow = Math.round((nowMs - stdMs) / 60_000);
        if (impliedNow > 0) base = base != null ? Math.max(base, impliedNow) : impliedNow;
      }
      if (fsDelay != null) base = base != null ? Math.max(base, fsDelay) : fsDelay;
      if (base != null) return base;
      if (arrDelay && arrDelay > 0) return arrDelay;
      if (arrDelayCached && arrDelayCached > 0) return arrDelayCached;
      return null;
    }
    return null;
  };

  /** Kaynak ne olursa olsun: ≤20 dk roster’da gecikme olarak gösterilmez. */
  const getDelayMinutes = (f: Flight): number | null => {
    const m = getDelayMinutesUnfiltered(f);
    if (m == null || m <= ROSTER_DELAY_DISPLAY_MIN_EXCLUSIVE) return null;
    return m;
  };

  const getNonFlightBlockStatus = (f: Flight): 'planned' | 'ongoing' | 'finished' => {
    const startMs = parseUtcMs(f.scheduled_departure ?? null);
    const endMs = parseUtcMs(f.scheduled_arrival ?? null);
    if (!startMs || !endMs) return 'planned';
    if (nowMs < startMs) return 'planned';
    if (nowMs > endMs) return 'finished';
    return 'ongoing';
  };

  const nonFlightStatusLabel = (s: 'planned' | 'ongoing' | 'finished'): string => {
    const lang = String(i18n?.language ?? '').toLowerCase();
    const tr = lang.startsWith('tr');
    if (s === 'planned') return tr ? 'Planlı' : 'Planned';
    if (s === 'ongoing') return tr ? 'Devam ediyor' : 'In progress';
    return tr ? 'Bitti' : 'Finished';
  };

  type FlightStatus = 'scheduled' | 'taxi_out' | 'departed' | 'en_route' | 'landed' | 'parked' | 'cancelled' | 'diverted' | 'incident' | 'redirected';
  /**
   * Flight status: DB flight_status + ürün kuralları. Pasif/yarı-aktif için fazı DB `api_refresh_phase`
   * yerine `computeApiRefreshPhase` ile hesaplarız — cron gecikmesinde faz noktası ile “Planlı” çelişmez.
   */
  const getFlightStatus = (f: Flight): FlightStatus => {
    const statusLower = String(f.flight_status ?? '').toLowerCase();
    if (statusLower === 'cancelled' || statusLower === 'canceled') return 'cancelled';
    if (statusLower === 'incident' || statusLower === 'redirected') return statusLower as FlightStatus;

    const refreshPhaseForUi =
      f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim'
        ? null
        : computeApiRefreshPhase(flightPhaseComputeArgs(f, nowMs));
    const refreshPhase =
      refreshPhaseForUi ??
      (f.api_refresh_phase as ApiRefreshPhase | null | undefined) ??
      null;

    // Product rule: passive_future + semi_active always render scheduled.
    if (refreshPhase === 'passive_future' || refreshPhase === 'passive_upcoming' || refreshPhase === 'semi_active') return 'scheduled';
    // Product rule: passive_past always renders landed.
    if (refreshPhase === 'passive_past') return 'landed';
    const todayLocal = getLocalDateStringPlusDays(0);
    let fromApi = f.flight_status as FlightStatus | null | undefined;
    if ((fromApi ?? '').toLowerCase() === 'diverted') {
      if (
        landedFromRow({
          flight_status: f.flight_status,
          internal_status: f.internal_status,
          actual_arrival: f.actual_arrival,
          fr24_datetime_landed_utc: f.fr24_datetime_landed_utc,
        })
      ) {
        fromApi = 'landed';
      } else {
        fromApi = airborneFromLiveFields(f.flight_status, f.internal_status) ? 'en_route' : 'scheduled';
      }
    }
    if (fromApi && ['cancelled', 'diverted', 'incident', 'redirected', 'scheduled', 'taxi_out', 'departed', 'en_route', 'landed', 'parked'].includes(fromApi)) {
      const normalized = fromApi === 'parked' ? 'landed' : fromApi;
      if (
        f.flight_date > todayLocal &&
        !f.actual_arrival &&
        normalized === 'landed'
      ) {
        return 'scheduled';
      }
      // Guardrail: future roster date must not render as landed.
      if (f.flight_date > todayLocal && normalized === 'landed') return 'scheduled';
      const depMs = parseUtcMsStatic(f.scheduled_departure);
      if (normalized === 'landed' && depMs > Date.now() + 120_000) return 'scheduled';
      return normalized;
    }
    return 'scheduled';
  };
  const statusConfig: Record<FlightStatus, { label: string }> = {
    scheduled: { label: t('roster.statusScheduled') },
    taxi_out: { label: t('roster.statusTaxiOut') },
    departed: { label: t('roster.statusDeparted') },
    en_route: { label: t('roster.statusEnRoute') },
    landed: { label: t('roster.statusLanded') },
    cancelled: { label: t('roster.statusCancelled') },
    diverted: { label: t('roster.statusDiverted') },
    incident: { label: t('roster.statusIncident') },
    redirected: { label: t('roster.statusRedirected') },
  };

  const deleteFlight = async (id: string) => {
    setFlightOpBusyMessage(t('common.flightOpDeletingFlights'));
    try {
      const err = await removeFlightForCrew(id);
      if (err) {
        Alert.alert(t('common.error'), err);
        return;
      }
      setFlights((prev) => prev.filter((f) => f.id !== id));
      Alert.alert('', t('roster.deleteFlightsSuccessOne'), [{ text: t('common.ok') }]);
    } finally {
      setFlightOpBusyMessage(null);
    }
  };

  const removeFlightForCrew = useCallback(async (id: string): Promise<string | null> => {
    if (!crewProfile?.id) return t('roster.clearAllError');
    const { error: rpcErr } = await supabase.rpc('remove_me_from_flight', { p_flight_id: id });
    if (!rpcErr) {
      await supabase.from('flights').delete().eq('id', id);
      return null;
    }

    const { error: relErr } = await supabase
      .from('flight_crew')
      .delete()
      .eq('flight_id', id)
      .eq('crew_id', crewProfile.id);
    if (!relErr) {
      await supabase.from('flights').delete().eq('id', id);
      return null;
    }

    const { error: legacyErr } = await supabase
      .from('flights')
      .delete()
      .eq('id', id)
      .eq('crew_id', crewProfile.id);
    if (!legacyErr) return null;

    return t('roster.flightDeleteFailedDetail', {
      rpc: String(rpcErr.message || '-').trim(),
      rel: String(relErr.message || '-').trim(),
      leg: String(legacyErr.message || '-').trim(),
    });
  }, [crewProfile?.id, t]);

  const handleDelete = (item: Flight) => {
    InteractionManager.runAfterInteractions(() => {
      Alert.alert(
        t('roster.deleteFlight'),
        t('roster.deleteFlightConfirm', { number: item.flight_number }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.delete'), style: 'destructive', onPress: () => void deleteFlight(item.id) },
        ],
        { cancelable: true }
      );
    });
  };

  const openAssignFlightsFromStandby = (item: Flight) => {
    if (!isCrew) return;
    InteractionManager.runAfterInteractions(() => {
      Alert.alert(
        t('roster.assignFlightsConfirmTitle'),
        t('roster.assignFlightsConfirmMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('roster.assignFlightsContinue'),
            onPress: () => {
              navigation.navigate('AddFlight', {
                prefillFlightDate: item.flight_date,
                replaceStandbyFlightId: item.id,
              });
            },
          },
        ],
        { cancelable: true },
      );
    });
  };

  const openFlightradar24 = async (flightNumber: string, flightDate: string, fr24Id?: string) => {
    try {
      if (fr24Id?.trim()) {
        const slug = flightNumber.replace(/\s+/g, '').trim().toUpperCase() || 'FLIGHT';
        const url = `https://www.flightradar24.com/${encodeURIComponent(slug)}/${encodeURIComponent(fr24Id.trim())}`;
        Linking.openURL(url).catch(() => {});
        return;
      }
      const url = await getFr24DeepLink(flightNumber, flightDate);
      if (url) {
        Linking.openURL(url).catch(() => {});
      }
    } catch {}
  };

  const openFlightradar24ByRegistration = (registration: string) => {
    const url = fr24UrlForAircraftRegistration(registration);
    if (url) Linking.openURL(url).catch(() => {});
  };

  const shareMonthSummary = useMemo(() => {
    const ym = selectedDate.slice(0, 7);
    let flights = 0;
    for (const f of displayFlights) {
      if (!listGroupDate(f).startsWith(ym)) continue;
      if (calendarDayKindForEntry(f) === 'flight') flights += 1;
    }
    let layovers = 0;
    for (const d of layoverDateSet) {
      if (d.startsWith(ym)) layovers += 1;
    }
    const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
    return {
      month: monthLabelFromYm(ym, locale, 'long'),
      flights,
      layovers,
    };
  }, [displayFlights, selectedDate, listGroupDate, i18n.language, layoverDateSet]);

  const showShareToast = useCallback((message: string) => {
    if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current);
    setShareToastMessage(message);
    shareToastTimerRef.current = setTimeout(() => {
      setShareToastMessage(null);
      shareToastTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current);
    };
  }, []);

  const performSendRosterToFamily = useCallback(async () => {
    if (!isCrew || !crewProfile?.id) return;
    setSendingToFamily(true);
    const result = await notifyFamilyTodayFlights(crewProfile.id, selectedDate);
    setSendingToFamily(false);
    if (result.ok) {
      setRosterLastSharedAt(Date.now());
      showShareToast(
        result.sent > 0 ? t('roster.shareRosterToast') : t('roster.shareRosterNoDevicesToast')
      );
    } else {
      Alert.alert(t('roster.notifyFailed'), result.error || t('roster.notifyFailedMessage'));
    }
  }, [isCrew, crewProfile?.id, selectedDate, t, showShareToast]);

  const confirmSendRosterToFamily = useCallback(() => {
    if (!isCrew || !crewProfile?.id || sendingToFamily) return;
    Alert.alert(
      t('roster.shareRosterConfirmTitle'),
      t('roster.shareRosterConfirmSummary', {
        month: shareMonthSummary.month,
        flights: shareMonthSummary.flights,
        layovers: shareMonthSummary.layovers,
      }),
      [
        { text: t('roster.shareRosterConfirmCancel'), style: 'cancel' },
        {
          text: t('roster.shareRosterConfirmShare'),
          onPress: () => {
            void performSendRosterToFamily();
          },
        },
      ]
    );
  }, [
    isCrew,
    crewProfile?.id,
    sendingToFamily,
    t,
    shareMonthSummary.month,
    shareMonthSummary.flights,
    shareMonthSummary.layovers,
    performSendRosterToFamily,
  ]);

  const openAddFlightManual = useCallback(() => {
    setAddFlightMenuVisible(false);
    navigation.navigate('AddFlight');
  }, [navigation]);

  const navigateToImportPicker = useCallback(() => {
    if (!isRosterPdfImportSupportedForCrewAirline(crewProfile?.airline_icao)) {
      Alert.alert(
        t('addFlight.importFlightsAirlineImportNotSupportedTitle'),
        t('addFlight.importFlightsAirlineImportNotSupportedMessage'),
      );
      return;
    }
    navigation.navigate('AddFlight', { openImportPicker: true });
  }, [crewProfile?.airline_icao, navigation, t]);

  const openAddFlightImport = useCallback(() => {
    setAddFlightMenuVisible(false);
    navigateToImportPicker();
  }, [navigateToImportPicker]);

  const openAddFlightMenu = useCallback(() => {
    setAddFlightMenuVisible(true);
  }, []);

  const commitPendingClearDeletes = useCallback(async (rows: Flight[]) => {
    for (const f of rows) {
      await removeFlightForCrew(f.id);
    }
  }, [removeFlightForCrew]);

  const undoPendingClear = useCallback(() => {
    const pending = pendingClearRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingClearRef.current = null;
    setFlights((prev) => {
      const ids = new Set(prev.map((f) => f.id));
      const restored = pending.rows.filter((r) => !ids.has(r.id));
      return [...prev, ...restored];
    });
    setClearUndoToast(null);
  }, []);

  const executeClearWithUndo = useCallback(
    (toDelete: Flight[]) => {
      if (toDelete.length === 0) {
        Alert.alert('', t('roster.clearNothingToDelete'));
        return;
      }
      if (pendingClearRef.current?.timer) {
        clearTimeout(pendingClearRef.current.timer);
        // Previous pending already removed from UI — commit those deletes now.
        void commitPendingClearDeletes(pendingClearRef.current.rows);
        pendingClearRef.current = null;
      }
      const ids = new Set(toDelete.map((f) => f.id));
      setFlights((prev) => prev.filter((f) => !ids.has(f.id)));
      setClearUndoToast(t('roster.clearUndoToast', { count: toDelete.length }));
      const timer = setTimeout(() => {
        pendingClearRef.current = null;
        setClearUndoToast(null);
        void commitPendingClearDeletes(toDelete);
      }, 5000);
      pendingClearRef.current = { rows: toDelete, timer };
    },
    [commitPendingClearDeletes, t],
  );

  const handleClearAllFlights = useCallback(() => {
    if (!isCrew || isPeerViewer || !crewProfile?.id) return;
    setClearConfirmVisible(true);
  }, [isCrew, isPeerViewer, crewProfile?.id]);

  const handleClearDay = useCallback(
    (dateYmd: string) => {
      if (!isCrew || isPeerViewer) return;
      let activeKept = 0;
      const toDelete: Flight[] = [];
      for (const f of flightsRef.current) {
        if (listGroupDate(f) !== dateYmd) continue;
        if (isLiveAirborneFlight(f)) {
          activeKept += 1;
          continue;
        }
        toDelete.push(f);
      }
      if (toDelete.length === 0) {
        Alert.alert('', t('roster.clearNothingToDelete'));
        return;
      }
      const note = activeKept > 0 ? `\n\n${t('roster.clearActiveKeptNote')}` : '';
      Alert.alert(
        t('roster.clearDayTitle'),
        `${t('roster.clearDayConfirm', {
          count: toDelete.length,
          date: formatRosterDayLabel(dateYmd),
        })}${note}`,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => executeClearWithUndo(toDelete),
          },
        ],
      );
    },
    [isCrew, isPeerViewer, t, executeClearWithUndo, formatRosterDayLabel, listGroupDate],
  );

  useEffect(() => {
    return () => {
      const pending = pendingClearRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingClearRef.current = null;
      void commitPendingClearDeletes(pending.rows);
    };
  }, [commitPendingClearDeletes]);

  useEffect(() => {
    const updated = route?.params?.importUpdatedCount;
    if (typeof updated !== 'number' || updated <= 0) return;
    if (infoToastTimerRef.current) clearTimeout(infoToastTimerRef.current);
    setInfoToast(t('roster.importUpdatedToast', { count: updated }));
    infoToastTimerRef.current = setTimeout(() => {
      setInfoToast(null);
      infoToastTimerRef.current = null;
    }, 4000);
    try {
      navigation.setParams({ importUpdatedCount: undefined });
    } catch {
      /* ignore */
    }
  }, [route?.params?.importUpdatedCount, t, navigation]);

  const dateRollerDates = React.useMemo(() => {
    const out: string[] = [];
    if (crewUtcView) {
      for (let d = -CALENDAR_RANGE_DAYS_BACK; d <= CALENDAR_RANGE_DAYS_AHEAD; d++) {
        out.push(getUtcDateStringPlusDays(d));
      }
      return out;
    }
    if (familyRosterTz) {
      const base = getCalendarDateStringInTimeZone(new Date(), familyRosterTz);
      for (let d = -CALENDAR_RANGE_DAYS_BACK; d <= CALENDAR_RANGE_DAYS_AHEAD; d++) {
        out.push(addCalendarDaysToYmd(base, d));
      }
      return out;
    }
    for (let d = -CALENDAR_RANGE_DAYS_BACK; d <= CALENDAR_RANGE_DAYS_AHEAD; d++) {
      out.push(getLocalDateStringPlusDays(d));
    }
    return out;
  }, [todayStr, crewUtcView, familyRosterTz]);
  const calendarRangeSet = useMemo(() => new Set(dateRollerDates), [dateRollerDates]);
  const calendarWeeks = useMemo(() => {
    if (dateRollerDates.length === 0) return [];
    return weeksCoveringRange(dateRollerDates[0], dateRollerDates[dateRollerDates.length - 1]);
  }, [dateRollerDates]);

  const focusMonthYm = selectedDate.slice(0, 7);
  const monthCalendarWeeks = useMemo(() => weeksCoveringMonth(focusMonthYm), [focusMonthYm]);
  /** Takvim görünümü veya kullanıcı expand: ayı tamamen kapsayan değişken satır. */
  const calendarEffectiveExpanded = calendarViewEnabled || calendarExpanded;
  const calendarGridWeeks = calendarEffectiveExpanded ? monthCalendarWeeks : calendarWeeks;
  const calendarGridHeight = calendarEffectiveExpanded
    ? Math.max(1, monthCalendarWeeks.length) * CALENDAR_COL_H
    : CALENDAR_COL_H;
  const listRef = useRef<FlatList>(null);
  const listDataRef = useRef(listData);
  listDataRef.current = listData;
  /** Ölçülen satır yükseklikleri — doğru güne kaydırmak için. */
  const itemHeightsRef = useRef<number[]>([]);
  /** Takvimden basılan hedef gün; viewability bunu doğrulayana kadar seçimi ezme. */
  const scrollTargetDateRef = useRef<string | null>(null);
  const scrollCorrectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calendarWeekListRef = useRef<FlatList<CalendarDayCell[]>>(null);
  const calendarWasExpandedRef = useRef(false);
  const calendarExpandedRef = useRef(false);
  const calendarMonthRef = useRef(calendarMonth);
  const calendarProgrammaticRef = useRef(false);
  const lastCalendarWeekIdxRef = useRef(-1);
  calendarMonthRef.current = calendarMonth;
  calendarExpandedRef.current = calendarEffectiveExpanded;

  const listEntryKey = useCallback((item: ListEntry, index: number) => {
    if (item.type === 'dayHeader') return `day-${item.dateYmd}`;
    if (item.type === 'layover') return `layover-${item.windowKey}-${index}`;
    return `${item.flight.id}-${index}`;
  }, []);

  const estimateListItemHeight = useCallback((entry: ListEntry | undefined) => {
    if (!entry) return 160;
    if (entry.type === 'dayHeader') return 52;
    if (entry.type === 'layover') return 100;
    // Kartlar tahmin edilenden uzun; düşük tahmin → yanlış (ileri) güne düşüyordu.
    return 168;
  }, []);

  /** 0..index-1 için offset. allMeasured=true ise yalnızca gerçek ölçüm. */
  const offsetForListIndex = useCallback(
    (index: number, requireMeasured: boolean) => {
      const data = listDataRef.current;
      const heights = itemHeightsRef.current;
      let offset = 0;
      for (let i = 0; i < index; i += 1) {
        const measured = heights[i];
        if (measured && measured > 0) {
          offset += measured;
        } else if (requireMeasured) {
          return null;
        } else {
          offset += estimateListItemHeight(data[i]);
        }
      }
      return offset;
    },
    [estimateListItemHeight],
  );

  const indexForRosterDateIn = useCallback(
    (data: ListEntry[], dateStr: string) => {
      if (data.length === 0) return -1;
      // Takvim ymd ≡ dayHeader.dateYmd — uçuş satırına değil başlığa git.
      const headerIdx = data.findIndex(
        (e) => e.type === 'dayHeader' && e.dateYmd === dateStr,
      );
      if (headerIdx >= 0) return headerIdx;
      const exact = data.findIndex(
        (e) =>
          (e.type === 'flight' && listGroupDate(e.flight) === dateStr) ||
          (e.type === 'layover' && e.dateYmd === dateStr),
      );
      if (exact >= 0) return exact;
      const next = data.findIndex((e) => {
        if (e.type === 'dayHeader') return e.dateYmd >= dateStr;
        if (e.type === 'flight') return listGroupDate(e.flight) >= dateStr;
        if (e.type === 'layover') return e.dateYmd >= dateStr;
        return false;
      });
      if (next >= 0) return next;
      return data.length - 1;
    },
    [listGroupDate],
  );

  const indexForRosterDate = useCallback(
    (dateStr: string) => indexForRosterDateIn(listDataRef.current, dateStr),
    [indexForRosterDateIn],
  );

  const applyScrollToDate = useCallback(
    (dateStr: string, animated: boolean) => {
      const data = listDataRef.current;
      const idx = indexForRosterDateIn(data, dateStr);
      if (idx < 0) return;
      programmaticListScrollRef.current = true;
      const measured = offsetForListIndex(idx, true);
      const offset = measured ?? offsetForListIndex(idx, false) ?? 0;
      try {
        listRef.current?.scrollToOffset({ offset: Math.max(0, offset), animated });
      } catch {
        /* ignore */
      }
      // Ölçüm yoksa index ile de dene (getItemLayout yok → fail handler ortalama kullanır).
      if (measured == null) {
        try {
          listRef.current?.scrollToIndex({ index: idx, animated, viewPosition: 0 });
        } catch {
          /* ignore */
        }
      }
    },
    [indexForRosterDateIn, offsetForListIndex],
  );

  /** Takvim günü → roster aynı ymd dayHeader. Ölçüm gelince düzelt. */
  const scrollListToDate = useCallback(
    (dateStr: string, animated = true) => {
      if (pendingListScrollClearTimerRef.current) {
        clearTimeout(pendingListScrollClearTimerRef.current);
        pendingListScrollClearTimerRef.current = null;
      }
      if (scrollCorrectTimerRef.current) {
        clearTimeout(scrollCorrectTimerRef.current);
        scrollCorrectTimerRef.current = null;
      }
      scrollTargetDateRef.current = dateStr;
      pendingListScrollDateRef.current = dateStr;
      applyScrollToDate(dateStr, animated);
      // Layout / virtualization sonrası ölçümle aynı güne kilitle.
      const retries = animated ? [80, 200, 400, 700] : [40, 120, 280];
      retries.forEach((ms) => {
        setTimeout(() => {
          if (scrollTargetDateRef.current !== dateStr) return;
          applyScrollToDate(dateStr, false);
        }, ms);
      });
      pendingListScrollClearTimerRef.current = setTimeout(() => {
        // Doğrulanamadıysa bile seçili günü takvimde bırak; viewability ezmesin.
        programmaticListScrollRef.current = false;
        scrollTargetDateRef.current = null;
        pendingListScrollDateRef.current = null;
        pendingListScrollClearTimerRef.current = null;
      }, animated ? 900 : 500);
    },
    [applyScrollToDate],
  );

  const recordListItemHeight = useCallback(
    (index: number, height: number) => {
      if (height <= 0) return;
      if (itemHeightsRef.current[index] === height) return;
      itemHeightsRef.current[index] = height;
      const target = scrollTargetDateRef.current;
      if (!target) return;
      const idx = indexForRosterDateIn(listDataRef.current, target);
      if (idx < 0 || index > idx) return;
      const measured = offsetForListIndex(idx, true);
      if (measured == null) return;
      programmaticListScrollRef.current = true;
      try {
        listRef.current?.scrollToOffset({ offset: measured, animated: false });
      } catch {
        /* ignore */
      }
    },
    [indexForRosterDateIn, offsetForListIndex],
  );

  /** Scroll'da görünen ilk öğeye göre tarihi senkronize et. Programatik / hedef kaydırmayı ezme. */
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    waitForInteraction: false,
  }).current;
  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: Array<{ item: ListEntry; key: string; index: number | null; isViewable: boolean }> }) => {
      const target = scrollTargetDateRef.current;
      const firstVisible =
        info.viewableItems.find((v) => v.item?.type === 'dayHeader')?.item ??
        info.viewableItems.find((v) => v.item?.type === 'flight')?.item ??
        info.viewableItems.find((v) => v.item?.type === 'layover')?.item;
      let visibleDate: string | null = null;
      if (firstVisible?.type === 'dayHeader') visibleDate = firstVisible.dateYmd;
      else if (firstVisible?.type === 'flight') visibleDate = listGroupDate(firstVisible.flight);
      else if (firstVisible?.type === 'layover') visibleDate = firstVisible.dateYmd;

      if (target) {
        // Hedef güne oturduysa kilidi bırak; seçim zaten target.
        if (visibleDate === target) {
          scrollTargetDateRef.current = null;
          pendingListScrollDateRef.current = null;
          programmaticListScrollRef.current = false;
          if (pendingListScrollClearTimerRef.current) {
            clearTimeout(pendingListScrollClearTimerRef.current);
            pendingListScrollClearTimerRef.current = null;
          }
        } else if (visibleDate) {
          // Yanlış gündeyiz — ölçümle tekrar hedefe çek.
          applyScrollToDate(target, false);
        }
        return;
      }

      if (programmaticListScrollRef.current || pendingRosterAnchorRef.current) return;
      if (!visibleDate) return;
      setSelectedDate(visibleDate);
      if (!calendarExpandedRef.current) {
        const monday = mondayYmdOf(visibleDate);
        setCalendarMonth(
          monday
            ? dominantMonthFromWeeks([weekCellsFromMonday(monday)], visibleDate.slice(0, 7))
            : visibleDate.slice(0, 7),
        );
      }
    },
    [listGroupDate, applyScrollToDate],
  );

  /** Ekran odağında / uçuş listesi gelince yerel bugüne (veya eklenen uçuş gününe) hizala. */
  React.useEffect(() => {
    const target = pendingRosterAnchorRef.current;
    if (!target || loading) return;
    setSelectedDate(target);
    setCalendarMonth(target.slice(0, 7));

    const syncCalendarToTarget = () => {
      const weekIdx = calendarWeeks.findIndex((w) => w.some((c) => c.ymd === target));
      if (weekIdx < 0) return;
      lastCalendarWeekIdxRef.current = -1;
      calendarProgrammaticRef.current = true;
      try {
        calendarWeekListRef.current?.scrollToOffset({
          offset: weekIdx * CALENDAR_COL_H,
          animated: false,
        });
      } catch {
        /* layout not ready */
      }
      lastCalendarWeekIdxRef.current = weekIdx;
      setTimeout(() => {
        calendarProgrammaticRef.current = false;
      }, 80);
    };

    const handle = InteractionManager.runAfterInteractions(() => {
      pendingListScrollDateRef.current = null;
      if (listData.length > 0) {
        scrollListToDate(target, false);
      } else {
        programmaticListScrollRef.current = false;
      }
      // Takvim haftasını da aynı güne kilitle (liste scroll’undan bağımsız).
      syncCalendarToTarget();
      // İlk layout sonrası tekrar dene (FlatList henüz mount olmamış olabilir).
      setTimeout(() => {
        if (listData.length > 0) scrollListToDate(target, false);
        syncCalendarToTarget();
      }, 120);
      pendingRosterAnchorRef.current = null;
      if (route?.params?.addedFlightDate) {
        try { navigation.setParams({ addedFlightDate: undefined }); } catch {}
      }
    });
    return () => handle.cancel();
  }, [listData, loading, scrollListToDate, navigation, route?.params?.addedFlightDate, rosterAnchorNonce, calendarWeeks]);

  /** Nöbet → görev tebliği: ilgili günleri kalıcı kırmızı (uçuş) işaretle. */
  React.useEffect(() => {
    const raw = route?.params?.markCalendarFlightDates as string[] | undefined;
    if (!Array.isArray(raw) || raw.length === 0) return;
    const dates = raw.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (dates.length === 0) return;
    setPersistedDayKinds((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const ymd of dates) {
        const merged = mergeCalendarDayKind(next[ymd], 'flight');
        if (next[ymd] !== merged) {
          next[ymd] = merged;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    try {
      navigation.setParams({ markCalendarFlightDates: undefined });
    } catch {
      /* ignore */
    }
  }, [route.params?.markCalendarFlightDates, navigation]);

  const onDateRollerChipPress = useCallback(
    (dateStr: string) => {
      scrollTargetDateRef.current = dateStr;
      pendingListScrollDateRef.current = dateStr;
      setSelectedDate(dateStr);
      const ym = dateStr.slice(0, 7);
      calendarMonthRef.current = ym;
      setCalendarMonth(ym);
      // listData (boş gün başlığı) güncellenince effect + ölçüm aynı ymd'ye kilitler.
      scrollListToDate(dateStr, true);
    },
    [scrollListToDate],
  );

  /** Boş güne basınca dayHeader listData'ya selectedDate ile eklenir — o zaman kaydır. */
  React.useEffect(() => {
    const target = pendingListScrollDateRef.current ?? scrollTargetDateRef.current;
    if (!target || loading || listData.length === 0) return;
    if (selectedDate !== target) return;
    const hasExact = listData.some((e) => e.type === 'dayHeader' && e.dateYmd === target);
    if (!hasExact) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      if ((pendingListScrollDateRef.current ?? scrollTargetDateRef.current) !== target) return;
      applyScrollToDate(target, false);
      setTimeout(() => applyScrollToDate(target, false), 100);
    });
    return () => handle.cancel();
  }, [listData, selectedDate, loading, applyScrollToDate]);

  const dayKindByDate = useMemo(() => {
    const map = new Map<string, CalendarDayKind>();
    const flightsOnly = rosterListPrefs.flights_only;
    // Liste filtresinden bağımsız varsayılan: takvim renkleri tüm roster satırlarından.
    // flights_only açıkken yalnızca uçuş günleri.
    for (const f of flights) {
      const kind = (f.roster_entry_kind ?? 'flight').toLowerCase();
      if (kind === 'sim') continue;
      const dayKind = calendarDayKindForEntry(f);
      if (flightsOnly && dayKind !== 'flight') continue;
      const ymd = listGroupDate(f);
      map.set(ymd, mergeCalendarDayKind(map.get(ymd), dayKind));
    }
    // Layover günlerini işaretle
    for (const ymd of calendarLayoverDateSet) {
      map.set(ymd, mergeCalendarDayKind(map.get(ymd), 'layover'));
    }
    const todayAnchor = rosterTodayYmd;
    for (const [ymd, kind] of Object.entries(persistedDayKinds)) {
      if (!kind || kind === 'empty') continue;
      if (flightsOnly && kind !== 'flight') continue;
      if (ymd >= todayAnchor) {
        // Bugün/gelecek: canlı veri öncelikli; yalnızca kalıcı "uçuş" (görev tebliği sonrası) turuncu nöbeti kırmızıya yükseltir.
        if (kind === 'flight') {
          map.set(ymd, mergeCalendarDayKind(map.get(ymd), 'flight'));
        }
        continue;
      }
      // Geçmiş: listeden düşen günlerin rengini koru.
      map.set(ymd, mergeCalendarDayKind(map.get(ymd), kind));
    }
    return map;
  }, [
    flights,
    listGroupDate,
    persistedDayKinds,
    rosterTodayYmd,
    calendarLayoverDateSet,
    rosterListPrefs.flights_only,
  ]);

  /** Hibrit takvim: dolgu yok; nokta (uçuş) + çizgi (yatı/nöbet) ayrı katman. */
  const calendarMarkSets = useMemo(() => {
    const flightCount = new Map<string, number>();
    const standby = new Set<string>();
    const dutyOff = new Set<string>();
    const flightsOnly = rosterListPrefs.flights_only;
    for (const f of flights) {
      const rk = (f.roster_entry_kind ?? 'flight').toLowerCase();
      if (rk === 'sim') continue;
      const ymd = listGroupDate(f);
      const kind = calendarDayKindForEntry(f);
      if (kind === 'flight') {
        flightCount.set(ymd, (flightCount.get(ymd) ?? 0) + 1);
      } else if (!flightsOnly && kind === 'standby') {
        standby.add(ymd);
      } else if (!flightsOnly && kind === 'duty_off') {
        dutyOff.add(ymd);
      }
    }
    for (const [ymd, kind] of Object.entries(persistedDayKinds)) {
      if (ymd >= rosterTodayYmd) continue;
      if (kind === 'flight' && !flightCount.has(ymd)) flightCount.set(ymd, 1);
      if (!flightsOnly && kind === 'standby') standby.add(ymd);
      if (!flightsOnly && kind === 'duty_off') dutyOff.add(ymd);
    }
    return { flightCount, standby, dutyOff };
  }, [flights, listGroupDate, persistedDayKinds, rosterTodayYmd, rosterListPrefs.flights_only]);

  const calendarMarksUserKey =
    (isCrew ? crewProfile?.id : profile?.id) ?? (isCrew ? 'crew' : 'family');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(calendarDayMarksStorageKey(calendarMarksUserKey))
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as Record<string, string>;
          const next: Record<string, CalendarDayKind> = {};
          for (const [ymd, kind] of Object.entries(parsed)) {
            if (kind === 'flight' || kind === 'standby' || kind === 'duty_off') next[ymd] = kind;
          }
          setPersistedDayKinds(next);
        } catch {
          /* ignore corrupt cache */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [calendarMarksUserKey]);

  useEffect(() => {
    if (!flights.length && Object.keys(persistedDayKinds).length === 0) return;
    const minKeep = crewUtcView
      ? getUtcDateStringPlusDays(-CALENDAR_DAY_MARKS_RETENTION_DAYS)
      : getLocalDateStringPlusDays(-CALENDAR_DAY_MARKS_RETENTION_DAYS);
    setPersistedDayKinds((prev) => {
      const next: Record<string, CalendarDayKind> = { ...prev };
      for (const f of flights) {
        const rk = (f.roster_entry_kind ?? 'flight').toLowerCase();
        if (rk === 'sim') continue;
        const ymd = listGroupDate(f);
        const kind = calendarDayKindForEntry(f);
        if (kind === 'empty') continue;
        next[ymd] = mergeCalendarDayKind(next[ymd], kind);
      }
      for (const ymd of Object.keys(next)) {
        if (ymd < minKeep) delete next[ymd];
      }
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.keys(next).every((k) => next[k] === prev[k]);
      return same ? prev : next;
    });
  }, [flights, listGroupDate, todayStr, crewUtcView]);

  useEffect(() => {
    const t = setTimeout(() => {
      void AsyncStorage.setItem(
        calendarDayMarksStorageKey(calendarMarksUserKey),
        JSON.stringify(persistedDayKinds),
      ).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [persistedDayKinds, calendarMarksUserKey]);

  const toggleCalendarExpanded = useCallback(() => {
    if (calendarViewEnabled) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCalendarExpanded((v) => {
      const next = !v;
      if (v && !next) {
        requestAnimationFrame(() => scrollListToDate(selectedDate));
      }
      return next;
    });
  }, [calendarViewEnabled, scrollListToDate, selectedDate]);

  const shiftCalendarMonth = useCallback(
    (delta: number) => {
      const nextYm = shiftYm(selectedDate.slice(0, 7), delta);
      const nextDay = clampDayInYm(selectedDate, nextYm);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      calendarMonthRef.current = nextYm;
      setCalendarMonth(nextYm);
      setSelectedDate(nextDay);
      scrollListToDate(nextDay);
    },
    [selectedDate, scrollListToDate],
  );

  const calendarLocale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';

  /** Collapsed: selectedDate'in haftası (Pzt–Paz). */
  const calendarWeekCells = useMemo(() => {
    const monday = mondayYmdOf(selectedDate);
    return monday ? weekCellsFromMonday(monday) : [];
  }, [selectedDate]);

  const collapsedDominantYm = useMemo(
    () => dominantMonthFromWeeks(calendarWeekCells.length ? [calendarWeekCells] : [], selectedDate.slice(0, 7)),
    [calendarWeekCells, selectedDate],
  );

  const calendarMonthLabel = useMemo(
    () =>
      monthLabelFromYm(
        calendarEffectiveExpanded ? selectedDate.slice(0, 7) : collapsedDominantYm || calendarMonth,
        calendarLocale,
        'long',
      ),
    [calendarEffectiveExpanded, selectedDate, calendarMonth, collapsedDominantYm, calendarLocale],
  );

  const applyVisibleWeeksMonth = useCallback((firstWeekIdx: number) => {
    if (calendarExpandedRef.current) {
      const ym = selectedDate.slice(0, 7);
      if (ym && ym !== calendarMonthRef.current) {
        calendarMonthRef.current = ym;
        setCalendarMonth(ym);
      }
      return;
    }
    const window = 1;
    const maxIdx = Math.max(0, calendarWeeks.length - window);
    const idx = Math.max(0, Math.min(firstWeekIdx, maxIdx));
    const visible = calendarWeeks.slice(idx, idx + window);
    const ym = dominantMonthFromWeeks(visible, calendarMonthRef.current);
    if (ym && ym !== calendarMonthRef.current) {
      calendarMonthRef.current = ym;
      setCalendarMonth(ym);
    }
  }, [calendarWeeks, selectedDate]);

  const scrollCalendarToWeekOf = useCallback(
    (ymd: string, animated: boolean) => {
      if (calendarExpandedRef.current) {
        // Ay grid’i scroll etmez; ay zaten selectedDate ile seçilir.
        const ym = ymd.slice(0, 7);
        if (ym !== calendarMonthRef.current) {
          calendarMonthRef.current = ym;
          setCalendarMonth(ym);
        }
        return;
      }
      if (calendarWeeks.length === 0) return;
      const idx = calendarWeeks.findIndex((w) => w.some((c) => c.ymd === ymd));
      if (idx < 0) return;
      const window = 1;
      const maxIdx = Math.max(0, calendarWeeks.length - window);
      const clamped = Math.max(0, Math.min(idx, maxIdx));
      if (clamped === lastCalendarWeekIdxRef.current && animated) return;
      const useAnim = animated && lastCalendarWeekIdxRef.current >= 0;
      lastCalendarWeekIdxRef.current = clamped;
      calendarProgrammaticRef.current = true;
      try {
        calendarWeekListRef.current?.scrollToOffset({
          offset: clamped * CALENDAR_COL_H,
          animated: useAnim,
        });
      } catch {
        /* layout not ready */
      }
      applyVisibleWeeksMonth(clamped);
      setTimeout(() => {
        calendarProgrammaticRef.current = false;
      }, useAnim ? 420 : 80);
    },
    [calendarWeeks, applyVisibleWeeksMonth],
  );

  useEffect(() => {
    if (calendarEffectiveExpanded) return;
    scrollCalendarToWeekOf(selectedDate, rosterAnchorNonce > 0 ? false : true);
  }, [selectedDate, calendarEffectiveExpanded, scrollCalendarToWeekOf, rosterAnchorNonce]);

  useEffect(() => {
    const justOpened = calendarEffectiveExpanded && !calendarWasExpandedRef.current;
    calendarWasExpandedRef.current = calendarEffectiveExpanded;
    if (!justOpened || calendarGridWeeks.length === 0) return;
    scrollCalendarToWeekOf(selectedDate, false);
  }, [calendarEffectiveExpanded, calendarGridWeeks, selectedDate, scrollCalendarToWeekOf]);
  const getCalendarDayStyle = useCallback(
    (ymd: string) => {
      const isSelected = ymd === selectedDate;
      const isToday = ymd === rosterTodayYmd;

      // Seçim = absolute çerçeve (layout’u bozmaz). Bugün = soft dolgu + primary rakam.
      // Boş günler de diğer tarihler gibi siyah (gri değil).
      return {
        backgroundColor: isToday ? colors.primaryLight : colors.surface,
        textColor: isToday ? colors.primary : cardInk.primary,
        muted: false,
        showSelectRing: isSelected,
      };
    },
    [
      cardInk.primary,
      colors.primary,
      colors.primaryLight,
      colors.surface,
      selectedDate,
      rosterTodayYmd,
    ]
  );

  const renderCalendarWeek = (week: CalendarDayCell[], extraKey: string) => (
    <View key={extraKey} style={styles.calendarWeek}>
      {week.map((cell, colIdx) => {
        const inRange = calendarRangeSet.has(cell.ymd);
        const kind = dayKindByDate.get(cell.ymd) ?? 'empty';
        const dayStyle = getCalendarDayStyle(cell.ymd);
        const isToday = cell.ymd === rosterTodayYmd;
        const isSelected = cell.ymd === selectedDate;
        const dimOutOfRange = !inRange && kind === 'empty';
        const focusYm = selectedDate.slice(0, 7);
        const dimOtherMonth = calendarEffectiveExpanded && cell.ymd.slice(0, 7) !== focusYm;
        const flightN = calendarMarkSets.flightCount.get(cell.ymd) ?? 0;
        const hasLayover = calendarLayoverDateSet.has(cell.ymd);
        const hasStandby = calendarMarkSets.standby.has(cell.ymd);
        const hasOff =
          calendarMarkSets.dutyOff.has(cell.ymd) &&
          !hasLayover &&
          !hasStandby &&
          flightN === 0;
        const isSharedOff =
          !rosterListPrefs.flights_only && sharedOffSet.has(cell.ymd);
        const barKind: 'layover' | 'standby' | 'duty_off' | null = hasLayover
          ? 'layover'
          : hasStandby
            ? 'standby'
            : hasOff
              ? 'duty_off'
              : null;
        const dayHasBarKind = (ymd: string | null | undefined, kind: typeof barKind) => {
          if (!ymd || !kind) return false;
          if (kind === 'layover') return calendarLayoverDateSet.has(ymd);
          if (kind === 'standby') return calendarMarkSets.standby.has(ymd);
          const flightsOnDay = (calendarMarkSets.flightCount.get(ymd) ?? 0) > 0;
          return (
            calendarMarkSets.dutyOff.has(ymd) &&
            !calendarLayoverDateSet.has(ymd) &&
            !calendarMarkSets.standby.has(ymd) &&
            !flightsOnDay
          );
        };
        const prevYmd = colIdx > 0 ? week[colIdx - 1]?.ymd : null;
        const nextYmd = colIdx < 6 ? week[colIdx + 1]?.ymd : null;
        const cellDate = new Date(`${cell.ymd}T00:00:00Z`);
        const prevDate = new Date(cellDate);
        prevDate.setUTCDate(prevDate.getUTCDate() - 1);
        const nextDate = new Date(cellDate);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        const prevDayYmd = prevDate.toISOString().slice(0, 10);
        const nextDayYmd = nextDate.toISOString().slice(0, 10);
        const connectLeft = Boolean(
          barKind &&
            (dayHasBarKind(prevYmd, barKind) ||
              (colIdx === 0 && dayHasBarKind(prevDayYmd, barKind))),
        );
        const connectRight = Boolean(
          barKind &&
            (dayHasBarKind(nextYmd, barKind) ||
              (colIdx === 6 && dayHasBarKind(nextDayYmd, barKind))),
        );
        const cal = calendarTokens(themeMode);
        const marks = rosterMarks(themeMode);
        const barColor =
          barKind === 'layover'
            ? cal.layoverLine
            : barKind === 'standby'
              ? cal.standbyLine
              : barKind === 'duty_off'
                ? cal.offLine
                : 'transparent';
        return (
          <View key={cell.ymd} style={styles.calendarCol}>
            <TouchableOpacity
              style={[
                styles.calendarDayInner,
                {
                  backgroundColor: dayStyle.backgroundColor,
                  borderRadius: CALENDAR_DAY_RADIUS,
                },
                dimOutOfRange && styles.calendarCellOutOfRange,
                dimOtherMonth && styles.calendarCellOtherMonth,
              ]}
              disabled={
                !inRange &&
                kind === 'empty' &&
                !(calendarEffectiveExpanded && cell.ymd.slice(0, 7) === focusYm)
              }
              onPress={() => onDateRollerChipPress(cell.ymd)}
              accessibilityLabel={
                (isToday ? `${t('roster.today')}, ` : '') +
                (isSelected ? `${t('roster.selectedDay')}, ` : '') +
                (hasLayover
                  ? t('roster.dayLayover')
                  : flightN > 0
                    ? t('roster.dayHasFlights')
                    : hasStandby
                      ? t('roster.dayStandby')
                      : calendarMarkSets.dutyOff.has(cell.ymd)
                        ? t('roster.dayOffDuty')
                        : t('roster.dayEmpty'))
              }
            >
              {dayStyle.showSelectRing ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.calendarSelectRing,
                    {
                      borderColor: colors.primary,
                      borderRadius: CALENDAR_DAY_RADIUS,
                    },
                  ]}
                />
              ) : null}
              <Text
                style={{
                  color: dayStyle.textColor,
                  fontWeight: isToday || isSelected ? '800' : '700',
                  fontSize: cell.day === 1 ? 11 : 12,
                  opacity: dayStyle.muted ? 0.55 : 1,
                }}
              >
                {cell.day}
              </Text>
              {cell.day === 1 ? (
                <Text
                  style={{
                    color: dayStyle.textColor,
                    fontWeight: '800',
                    fontSize: 7,
                    lineHeight: 8,
                    textTransform: 'capitalize',
                    marginTop: -1,
                    opacity: dayStyle.muted ? 0.55 : 1,
                  }}
                  numberOfLines={1}
                >
                  {monthAbbrevFromYmd(cell.ymd, calendarLocale)}
                </Text>
              ) : null}
              <View style={styles.calendarMarkers}>
                <View style={styles.calendarDotsRow}>
                  {flightN <= 0 && !isSharedOff ? (
                    <View style={{ height: CALENDAR_DOT_SIZE }} />
                  ) : (
                    <>
                      {flightN > 0 ? (
                        <View
                          style={{
                            width: CALENDAR_DOT_SIZE,
                            height: CALENDAR_DOT_SIZE,
                            borderRadius: CALENDAR_DOT_SIZE / 2,
                            backgroundColor: cal.flightDot,
                            marginHorizontal: 1,
                          }}
                        />
                      ) : null}
                      {isSharedOff ? (
                        <Text
                          style={{
                            fontSize: 9,
                            fontWeight: '900',
                            color: marks.sharedOffMark,
                            lineHeight: CALENDAR_DOT_SIZE + 2,
                            marginHorizontal: 1,
                          }}
                        >
                          ✓
                        </Text>
                      ) : null}
                    </>
                  )}
                </View>
                <View style={styles.calendarBarTrack}>
                  {barKind ? (
                    <View
                      style={{
                        height: CALENDAR_BAR_H,
                        backgroundColor: barColor,
                        marginLeft: connectLeft ? 0 : CALENDAR_BAR_INSET,
                        marginRight: connectRight ? 0 : CALENDAR_BAR_INSET,
                        borderTopLeftRadius: connectLeft ? 0 : 2,
                        borderBottomLeftRadius: connectLeft ? 0 : 2,
                        borderTopRightRadius: connectRight ? 0 : 2,
                        borderBottomRightRadius: connectRight ? 0 : 2,
                      }}
                    />
                  ) : (
                    <View style={{ height: CALENDAR_BAR_H }} />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );

  const onFamilyCrewFilter = (id: string) => {
    familyCrewFilterIdRef.current = id;
    setFamilyCrewFilterId(id);
    void refreshFamilyListFromDb();
  };

  // Yapı değişince (yeni boş gün başlığı vb.) indeksler kayar → yükseklikleri sıfırla.
  const listStructureKey = useMemo(
    () =>
      listData
        .map((e) =>
          e.type === 'dayHeader'
            ? `h:${e.dateYmd}`
            : e.type === 'layover'
              ? `l:${e.windowKey}`
              : `f:${e.flight.id}`,
        )
        .join('|'),
    [listData],
  );
  useEffect(() => {
    itemHeightsRef.current = [];
  }, [listStructureKey]);

  useEffect(() => {
    let cancelled = false;
    if (!crewProfile?.id || !isOwnCrewAccount || !comparePeerCrewId) {
      setSharedOffDates([]);
      return;
    }
    const minFlightDate = getLocalDateStringPlusDays(-getRosterMinDaysAgo(exemptLandedAutoPurge, true));
    const collectOffDates = async (crewId: string): Promise<Set<string>> => {
      const flightIds = await fetchFlightIdsForCrew(supabase, crewId, minFlightDate);
      if (flightIds.length === 0) return new Set();
      const { data } = await supabase
        .from('flights')
        .select('flight_date, roster_entry_kind, flight_number, duty_occupation_code')
        .in('id', flightIds)
        .gte('flight_date', minFlightDate);
      const offs = new Set<string>();
      for (const row of data ?? []) {
        const kind = calendarDayKindForEntry(row as any);
        if (kind === 'duty_off') {
          const ymd = String((row as { flight_date?: string }).flight_date ?? '').slice(0, 10);
          if (ymd) offs.add(ymd);
        }
      }
      return offs;
    };
    (async () => {
      try {
        const [mine, peer] = await Promise.all([
          collectOffDates(crewProfile.id),
          collectOffDates(comparePeerCrewId),
        ]);
        if (cancelled) return;
        const shared = [...mine].filter((d) => peer.has(d)).sort();
        setSharedOffDates(shared);
      } catch {
        if (!cancelled) setSharedOffDates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [crewProfile?.id, isOwnCrewAccount, comparePeerCrewId, exemptLandedAutoPurge]);

  const readOnlyPillChrome = statusChrome('scheduled', themeMode);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlightOperationOverlay
        visible={flightOpBusyMessage != null}
        message={flightOpBusyMessage ?? ''}
      />
      {!showAdminFr24Debug ? (
        <View style={[styles.pageHeader, { paddingTop: Math.max(insets.top, 8) }]}>
          <View style={styles.pageTitleRow}>
            <Text style={[styles.pageTitle, { color: colors.text }]} numberOfLines={1}>
              {effectivePeerView?.peerName ? effectivePeerView.peerName : t('nav.roster')}
            </Text>
            {isPeerViewer ? (
              <View style={[styles.readOnlyPill, { backgroundColor: readOnlyPillChrome.bg }]}>
                <Ionicons name="lock-closed" size={12} color={readOnlyPillChrome.text} />
              </View>
            ) : null}
          </View>
          <View style={styles.pageHeaderActions}>
            {profile ? (
              <TouchableOpacity
                onPress={() => setRosterTasksModalVisible(true)}
                style={[styles.pageIconBtn, { borderColor: colors.border }]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel={t('roster.listTaskSettings')}
              >
                <Ionicons name="settings-outline" size={18} color={colors.text} />
              </TouchableOpacity>
            ) : null}
            {isCrew ? (
              <TouchableOpacity
                onPress={confirmSendRosterToFamily}
                disabled={sendingToFamily}
                style={[styles.pageIconBtn, { borderColor: colors.border }]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel={t('roster.sendToFamily')}
              >
                {sendingToFamily ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="paper-plane-outline" size={18} color={colors.text} />
                )}
              </TouchableOpacity>
            ) : null}
            {isCrew ? (
              <TouchableOpacity
                onPress={openAddFlightMenu}
                style={[styles.pageIconBtn, styles.pageIconBtnPrimary, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel={t('roster.addFlight')}
                accessibilityRole="button"
              >
                <Ionicons name="add" size={22} color={colors.onPrimary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {isOwnCrewAccount && comparePeerCrewId && sharedOffThisMonth.length > 0 ? (
        <TouchableOpacity
          style={[
            styles.sharedOffBanner,
            {
              backgroundColor: rosterMarks(themeMode).sharedOffBannerBg,
              borderColor: rosterMarks(themeMode).sharedOffBannerBorder,
            },
          ]}
          onPress={() => {
            const days = sharedOffThisMonth;
            if (days.length === 0) return;
            const cur = selectedDate;
            const idx = days.indexOf(cur);
            const next = days[(idx >= 0 ? idx + 1 : 0) % days.length]!;
            onDateRollerChipPress(next);
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('roster.sharedOffDaysMonth', {
            count: sharedOffThisMonth.length,
            days: sharedOffThisMonth.map((d) => String(parseInt(d.slice(8, 10), 10))).join(', '),
          })}
        >
          <Text
            style={[styles.sharedOffBannerText, { color: rosterMarks(themeMode).sharedOffBannerText }]}
            numberOfLines={2}
          >
            {t('roster.sharedOffDaysMonth', {
              count: sharedOffThisMonth.length,
              days: sharedOffThisMonth.map((d) => String(parseInt(d.slice(8, 10), 10))).join(', '),
            })}
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Tarih rollerı her zaman göster (liste boş olsa da yeni format görünsün; roller–liste senkron). */}
      {(!loading || flights.length > 0) && (
        <>
          {!isCrew && familyCrewOptions.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.crewFilterRow}
              style={styles.crewFilterScroll}
            >
              <Text style={[styles.crewFilterLabel, { color: colors.textSecondary }]}>{t('roster.crewFilterLabel')}</Text>
              <TouchableOpacity
                style={[
                  styles.crewFilterChip,
                  familyCrewFilterId === 'all' && styles.crewFilterChipSelected,
                  { borderColor: colors.border, backgroundColor: familyCrewFilterId === 'all' ? colors.primary : colors.surface },
                ]}
                onPress={() => onFamilyCrewFilter('all')}
              >
                <Text style={{ color: familyCrewFilterId === 'all' ? colors.onPrimary : colors.text, fontWeight: '700', fontSize: 12 }}>
                  {t('roster.crewFilterAll')}
                </Text>
              </TouchableOpacity>
              {familyCrewOptions.map((c) => {
                const sel = familyCrewFilterId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.crewFilterChip,
                      { borderColor: colors.border, backgroundColor: sel ? colors.primary : colors.surface },
                    ]}
                    onPress={() => onFamilyCrewFilter(c.id)}
                  >
                    <Text style={{ color: sel ? colors.onPrimary : colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        <View style={styles.inlineCalendar}>
          <View style={styles.inlineCalendarHeader}>
            {calendarViewEnabled ? (
              <View style={styles.inlineCalendarTitleBtn}>
                <TouchableOpacity
                  onPress={() => shiftCalendarMonth(-1)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('roster.calendarPrevMonth')}
                >
                  <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
                </TouchableOpacity>
                <Text style={[styles.inlineCalendarTitle, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
                  {calendarMonthLabel}
                </Text>
                <TouchableOpacity
                  onPress={() => shiftCalendarMonth(1)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('roster.calendarNextMonth')}
                >
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.inlineCalendarTitleBtn}
                onPress={toggleCalendarExpanded}
                accessibilityLabel={
                  calendarEffectiveExpanded ? t('roster.calendarCollapse') : t('roster.calendarExpand')
                }
              >
                <Text style={[styles.inlineCalendarTitle, { color: colors.text }]} numberOfLines={1}>
                  {calendarMonthLabel}
                </Text>
                <Ionicons
                  name={calendarEffectiveExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.syncMetaBesideMonthBtn}
              onPress={() => {
                if (isSyncingMeta) return;
                void runUserRefresh();
              }}
              disabled={isSyncingMeta}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('roster.sync')}
            >
              <View style={styles.syncMetaBesideMonthRow}>
                {isSyncingMeta ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 4 }} />
                ) : null}
                <Text
                  style={[
                    styles.syncMetaBesideMonth,
                    {
                      color: syncMetaColor,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {syncMetaLabel}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
          <View style={styles.calendarWeekRow}>
            {(() => {
              const labels =
                i18n.language === 'tr'
                  ? ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
                  : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
              const [ty, tm, td] = rosterTodayYmd.split('-').map((x) => parseInt(x, 10));
              const todayDow =
                Number.isFinite(ty) && Number.isFinite(tm) && Number.isFinite(td)
                  ? (new Date(Date.UTC(ty, tm - 1, td)).getUTCDay() + 6) % 7
                  : -1;
              return labels.map((d, dowIdx) => {
                const isTodayCol = dowIdx === todayDow;
                return (
                  <Text
                    key={d}
                    style={[
                      styles.calendarWeekday,
                      {
                        color: isTodayCol ? colors.primary : colors.textMuted,
                        fontWeight: isTodayCol ? '800' : '700',
                      },
                    ]}
                  >
                    {d}
                  </Text>
                );
              });
            })()}
          </View>
          <FlatList
            ref={calendarWeekListRef}
            data={calendarGridWeeks}
            keyExtractor={(week) => week[0]?.ymd ?? 'week'}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            scrollEnabled={!calendarEffectiveExpanded}
            pagingEnabled={!calendarEffectiveExpanded}
            snapToInterval={calendarEffectiveExpanded ? undefined : CALENDAR_COL_H}
            disableIntervalMomentum={!calendarEffectiveExpanded}
            decelerationRate={calendarEffectiveExpanded ? 'normal' : 'fast'}
            style={{ height: calendarGridHeight }}
            getItemLayout={(_d, index) => ({
              length: CALENDAR_COL_H,
              offset: CALENDAR_COL_H * index,
              index,
            })}
            extraData={`${calendarLayoverDateSet.size}|${dayKindByDate.size}|${calendarEffectiveExpanded}|${calendarMonth}|${rosterTodayYmd}|${selectedDate}|${rosterListPrefs.flights_only}|${monthCalendarWeeks.length}`}
            scrollEventThrottle={16}
            onScroll={(e) => {
              if (calendarEffectiveExpanded) return;
              const y = e.nativeEvent.contentOffset.y;
              const first = Math.max(0, Math.floor((y + CALENDAR_COL_H / 2) / CALENDAR_COL_H));
              lastCalendarWeekIdxRef.current = first;
              applyVisibleWeeksMonth(first);
            }}
            onMomentumScrollEnd={(e) => {
              if (calendarProgrammaticRef.current || calendarEffectiveExpanded) return;
              const y = e.nativeEvent.contentOffset.y;
              const idx = Math.max(0, Math.round(y / CALENDAR_COL_H));
              const week = calendarWeeks[idx];
              if (!week) return;
              if (week.some((c) => c.ymd === selectedDate)) return;
              const pick =
                week.find((c) => calendarRangeSet.has(c.ymd))?.ymd ?? week[0]?.ymd;
              if (!pick) return;
              setSelectedDate(pick);
              const ym = pick.slice(0, 7);
              calendarMonthRef.current = ym;
              setCalendarMonth(ym);
              scrollListToDate(pick);
            }}
            renderItem={({ item: week, index }) => renderCalendarWeek(week, `w-${index}`)}
          />
        </View>
        </>
      )}

      <View style={styles.rosterContentWrap}>
        {cleanupMessage ? (
          <View style={[styles.cleanupBanner, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.cleanupBannerText, { color: colors.primary }]}>{cleanupMessage}</Text>
          </View>
        ) : null}

        {!isCrew && !subscriptionAccessLoading && subscriptionAccess && !subscriptionAccess.has_access ? (
          <View style={{ marginHorizontal: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>
              {t('paywall.title')}
            </Text>
            <Text style={{ color: colors.textSecondary, lineHeight: 20, marginBottom: 8 }}>
              {t('paywall.familyBlockedMessage')}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 3 }}>
              {t('paywall.plan')}: {subscriptionAccess.plan_title ?? '-'}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
              {t('paywall.status')}: {subscriptionAccess.subscription_status ?? '-'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: colors.primary, paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
                onPress={() => refreshFamilyListFromDb()}
              >
                <Text style={{ color: colors.onPrimary, fontWeight: '700' }}>{t('paywall.refreshInvitePlan')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
                onPress={() => navigation.navigate('Connect')}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>{t('paywall.invitations')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : loading && flights.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('common.loading')}</Text>
        ) : listData.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={[styles.empty, { color: colors.textSecondary, marginTop: 24 }]}>
              {flights.length > 0 && displayFlights.length === 0
                ? t('roster.allRosterRowsHidden')
                : isCrew
                  ? t('roster.noFlightsCrewShort')
                  : t('roster.noFlightsFamily')}
            </Text>
            {isCrew && flights.length === 0 ? (
              <View style={styles.emptyActions}>
                <PrimaryButton title={t('roster.importRosterFile')} onPress={openAddFlightImport} />
                <SecondaryButton
                  title={t('roster.addManualFlight')}
                  onPress={openAddFlightManual}
                  style={{ marginTop: 12 }}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.listAndClearContainer}>
          <FlatList
            ref={listRef}
            data={listData}
            extraData={`${themeMode}|${listFontScale}|${crewUtcView ? 'u' : 'l'}|${selectedDate}`}
            keyExtractor={(item, index) => listEntryKey(item, index)}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            scrollIndicatorInsets={{ right: 0 }}
            initialNumToRender={20}
            maxToRenderPerBatch={16}
            windowSize={27}
            updateCellsBatchingPeriod={40}
            removeClippedSubviews={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              const avg = Math.max(averageItemLength || 160, 80);
              try {
                listRef.current?.scrollToOffset({ offset: Math.max(0, index * avg), animated: false });
              } catch {
                /* ignore */
              }
              setTimeout(() => {
                const target = scrollTargetDateRef.current;
                if (target) applyScrollToDate(target, false);
                else {
                  try {
                    listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
                  } catch {
                    /* ignore */
                  }
                }
              }, 60);
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshingList}
                onRefresh={handlePullToRefresh}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item: entry, index }) => {
            const onRowLayout = (h: number) => {
              recordListItemHeight(index, h);
            };
            if (entry.type === 'dayHeader') {
              const isTodayHeader = entry.dateYmd === rosterTodayYmd;
              const dayHasRows = listData.some(
                (e) =>
                  (e.type === 'flight' && listGroupDate(e.flight) === entry.dateYmd) ||
                  (e.type === 'layover' && e.dateYmd === entry.dateYmd),
              );
              const canClearDay =
                isCrew &&
                !isPeerViewer &&
                flights.some(
                  (f) => listGroupDate(f) === entry.dateYmd && !isLiveAirborneFlight(f),
                );
              return (
                <Pressable
                  style={[styles.dayHeaderRow, { backgroundColor: colors.background }]}
                  onLayout={(e) => onRowLayout(e.nativeEvent.layout.height)}
                  onLongPress={canClearDay ? () => handleClearDay(entry.dateYmd) : undefined}
                  delayLongPress={420}
                  accessibilityRole={canClearDay ? 'button' : undefined}
                  accessibilityHint={canClearDay ? t('roster.clearDayTitle') : undefined}
                >
                  <View style={styles.dayHeaderTitleRow}>
                    <View
                      style={[
                        styles.dayHeaderAccent,
                        { backgroundColor: isTodayHeader ? colors.primary : colors.border },
                      ]}
                    />
                    <Text style={[styles.dayHeaderText, { color: colors.text }]}>
                      {formatRosterDayLabel(entry.dateYmd)}
                      {isTodayHeader ? ` · ${t('roster.today')}` : ''}
                    </Text>
                    <View
                      style={[
                        styles.dayHeaderHairline,
                        {
                          backgroundColor: isTodayHeader
                            ? colors.primary
                            : themeMode === 'dark'
                              ? 'rgba(148,163,184,0.35)'
                              : 'rgba(15,27,61,0.12)',
                        },
                      ]}
                    />
                  </View>
                  {!dayHasRows ? (
                    <Text style={[styles.dayHeaderEmpty, { color: colors.textMuted }]}>
                      {isTodayHeader ? t('roster.noDutiesToday') : t('roster.noDutiesForDay')}
                    </Text>
                  ) : null}
                </Pressable>
              );
            }
            if (entry.type === 'layover') {
              const st = (entry.station || '').toUpperCase();
              const disp = st ? getAirportDisplay(st) : null;
              const isTr = String(i18n.language || '').toLowerCase().startsWith('tr');
              const city =
                (isTr && disp?.city_tr ? disp.city_tr : disp?.city)?.trim() || '';
              const stationLabel = t('roster.layoverStation', {
                iata: st || '—',
                city: city,
              }).trim();
              const inbound = flights.find((f) => f.id === entry.inboundId);
              const arrIso =
                inbound?.estimated_arrival ||
                inbound?.scheduled_arrival ||
                null;
              const arrDisplay = arrIso
                ? crewUtcView
                  ? formatTimeUTC(arrIso)
                  : isCrew
                    ? formatTimeCrewAtDest(arrIso, inbound?.destination_airport)
                    : formatTimeFamilyLocal(arrIso)
                : null;
              return (
                <View
                  style={styles.itemWrapper}
                  onLayout={(e) => recordListItemHeight(index, e.nativeEvent.layout.height)}
                >
                  <RosterFlightCard
                    model={{
                      flightNumber: 'LAYOVER',
                      originIata: st || '—',
                      destIata: st || '—',
                      depTime: '',
                      arrTime: arrDisplay || '',
                      durationLabel: '',
                      compactKind: 'layover',
                      isNonFlightBlock: true,
                      layoverStationLabel: stationLabel,
                      isPast: entry.dateYmd < rosterTodayYmd,
                    }}
                    themeMode={themeMode}
                    fontScale={listFontScale}
                    onPress={() => onDateRollerChipPress(entry.dateYmd)}
                  />
                </View>
              );
            }
            const item = entry.flight;
            const flightIndex = entry.dayIndex;
            const runUpdateAndClose = () => {
              setUpdatingFlightIds((prev) => ({ ...prev, [item.id]: true }));
              const done = () => {
                setUpdatingFlightIds((prev) => ({ ...prev, [item.id]: false }));
                swipeableRefs.current[item.id]?.close();
              };
              if (isCrew) {
                refreshTimesFromApi(true, [item]).finally(done);
              } else {
                refreshFamilyListFromApi(false, [item]).finally(done);
              }
            };
            /** RNGH: 'left' = sol aksiyon paneli (Sync). 'right' = silme paneli — ikisinde sync çalışırsa panel hemen kapanır, silme kullanılamaz. */
            const onSwipeableOpen = (direction: 'left' | 'right') => {
              if (direction === 'left') runUpdateAndClose();
            };
            const swipeH = swipeCardHeights[item.id];
            const renderLeftActions = () => {
              const isUpdating = !!updatingFlightIds[item.id];
              return (
                <RectButton
                  style={[styles.swipeUpdate, swipeH ? { height: swipeH } : null]}
                  onPress={() => {
                    swipeableRefs.current[item.id]?.close();
                    runUpdateAndClose();
                  }}
                >
                  <Text style={styles.swipeUpdateText}>{t('roster.sync')}</Text>
                  {isUpdating && (
                    <ActivityIndicator size="small" color={colors.white} style={styles.swipeUpdateSpinner} />
                  )}
                </RectButton>
              );
            };
            const renderRightActions = () =>
              !isCrew
                ? null
                : (
                  <RectButton
                    style={[styles.swipeDelete, swipeH ? { height: swipeH } : null]}
                    onPress={() => {
                      swipeableRefs.current[item.id]?.close();
                      handleDelete(item);
                    }}
                  >
                    <Text style={styles.swipeDeleteText}>{t('common.delete')}</Text>
                  </RectButton>
                );
            const status = getFlightStatus(item);
            const displayStatus = status;
            const blockCode = (item.flight_number || '').trim().toUpperCase();
            const isSimBlock =
              item.roster_entry_kind === 'sim' ||
              isSimulatorOccupationCode(blockCode) ||
              isSimulatorOccupationCode(item.duty_occupation_code);
            const isOffDayDutyCode = isOffDayOccupationCode(blockCode);
            const isAnnualLeaveCode = isAnnualLeaveOccupationCode(blockCode);
            const isUnpaidLeaveCode = isUnpaidLeaveOccupationCode(blockCode);
            const isGroundDutyCode = isGroundDutyOccupationCode(blockCode);
            const isOfficeDutyCode = isOfficeDutyOccupationCode(blockCode);
            const isDutyOffBlock =
              !isSimBlock &&
              !isGroundDutyCode &&
              (item.roster_entry_kind === 'duty_off' || isOffDayDutyCode);
            const isGroundDutyBlock = !isSimBlock && isGroundDutyCode;
            const isNonFlightBlock = isDutyOffBlock || isSimBlock || isGroundDutyBlock;
            const isStandbyDutyCode = isStandbyOccupationCode(blockCode);
            const isReserveDutyCode =
              blockCode === 'RSV' || blockCode === 'RZV' || blockCode === 'RZVM';
            const isStandbyBlock = isDutyOffBlock && (isStandbyDutyCode || isReserveDutyCode);
            const isTr = String(i18n.language || '').toLowerCase().startsWith('tr');
            const indigoLabels = shouldUseIndigoRosterLabels({
              isCrew,
              crewAirlineIcao: crewProfile?.airline_icao,
              flightNumber: item.flight_number,
            });
            const indigoDutyTr = indigoDutyBlockTitleTr(blockCode);
            const indigoDutyEn = indigoDutyBlockTitleEn(blockCode);
            const blockLabel =
              indigoLabels && isDutyOffBlock && indigoDutyTr && indigoDutyEn
                ? (isTr ? indigoDutyTr : indigoDutyEn)
                : isReserveDutyCode
                  ? (isTr ? 'Rezerve' : 'Reserve')
                  : isStandbyDutyCode
                    ? (isTr ? 'Nöbet' : 'Standby')
                    : isTrainingOccupationCode(blockCode)
                    ? (isTr ? 'Görev' : 'Duty')
                    : isAnnualLeaveCode
                    ? (isTr ? 'Yıllık İzin' : 'Annual Leave')
                    : isUnpaidLeaveCode
                      ? (isTr ? 'Ücretsiz İzin' : 'Unpaid Leave')
                    : blockCode.includes('YERDR')
                      ? (isTr ? 'Yer Dersi' : 'Ground Training')
                      : isOfficeDutyCode
                        ? (isTr ? 'Ofis' : 'Office Duty')
                        : isOffDayDutyCode
                          ? (isTr ? 'Boş Gün' : 'Off Day')
                          : (isTr
                              ? rosterOccupationLabelTr(item.flight_number)
                              : rosterOccupationLabelEn(item.flight_number)) ?? item.flight_number;
            const blockTitle =
              isDutyOffBlock
                ? blockLabel
                : blockCode
                  ? `${blockLabel} (${blockCode})`
                  : blockLabel;
            const indigoTrainingLine =
              indigoLabels && !isNonFlightBlock && (item.roster_detail ?? '').trim().length > 0
                ? indigoRosterTrainingDetailDisplay(String(item.roster_detail), isTr)
                : null;
            const isEnRoute = displayStatus === 'en_route' || displayStatus === 'departed';
            const isLandedStatus = displayStatus === 'landed' || displayStatus === 'parked';
            const showNextDayHint = nextDayHintById[item.id] === true;
            const delayMinsLegacy = getDelayMinutes(item);
            const takeoffIso =
              item.actual_departure ||
              item.fr24_datetime_takeoff_utc ||
              fr24TakeoffUtcByFlightId[item.id] ||
              null;
            const landIso =
              item.actual_arrival || item.fr24_datetime_landed_utc || null;
            const formatCardTime = (iso: string | null | undefined, airport: string | null | undefined, end: boolean) => {
              if (!iso) return '—';
              if (crewUtcView) return formatTimeUTC(iso);
              // Nöbet/SIM/off: rota IATA yok → base istasyon TZ (aksi halde UTC’ye düşüyordu).
              if (isNonFlightBlock) return formatTimeDutyAtBase(iso);
              if (isCrew) {
                return end
                  ? formatTimeCrewAtDest(iso, airport)
                  : formatTimeCrewAtOrigin(iso, airport);
              }
              return formatTimeFamilyLocal(iso);
            };
            const skewMinsBetween = (actualIso: string | null | undefined, plannedIso: string | null | undefined) => {
              const a = parseUtcMs(actualIso ?? null);
              const b = parseUtcMs(plannedIso ?? null);
              if (a <= 0 || b <= 0) return null;
              const m = Math.round((a - b) / 60_000);
              return m === 0 ? null : m;
            };

            let displayDepIso =
              delayMinsLegacy != null && item.estimated_departure
                ? item.estimated_departure
                : item.scheduled_departure;
            let displayArrIso =
              delayMinsLegacy != null && item.estimated_arrival
                ? item.estimated_arrival
                : item.scheduled_arrival;
            let depStruck: string | null =
              delayMinsLegacy != null && item.estimated_departure && item.scheduled_departure
                ? formatCardTime(item.scheduled_departure, item.origin_airport, false)
                : null;
            let arrStruck: string | null =
              delayMinsLegacy != null && item.estimated_arrival && item.scheduled_arrival
                ? formatCardTime(item.scheduled_arrival, item.destination_airport, true)
                : null;

            // Havada: gerçek kalkış (ATD) planlıdan farklıysa üstü çizili STD + gerçek saat.
            if (isEnRoute && takeoffIso && item.scheduled_departure) {
              const atdMs = parseUtcMs(takeoffIso);
              const stdMs0 = parseUtcMs(item.scheduled_departure);
              if (atdMs > 0 && stdMs0 > 0 && Math.abs(atdMs - stdMs0) >= 60_000) {
                depStruck = formatCardTime(item.scheduled_departure, item.origin_airport, false);
                displayDepIso = takeoffIso;
              } else if (atdMs > 0) {
                displayDepIso = takeoffIso;
                depStruck = null;
              }
            }
            // İniş: ATA aynı yerde; planlıdan ≥15 dk geç / erken sapma varsa STA üstü çizili.
            if (isLandedStatus && landIso) {
              displayArrIso = landIso;
              if (item.scheduled_arrival) {
                const landSkewMin = Math.round(
                  (parseUtcMs(landIso) - parseUtcMs(item.scheduled_arrival)) / 60_000,
                );
                const significantArr = significantArrivalSkewMins(landSkewMin);
                if (significantArr != null) {
                  arrStruck = formatCardTime(item.scheduled_arrival, item.destination_airport, true);
                } else {
                  arrStruck = null;
                }
              } else {
                arrStruck = null;
              }
              if (takeoffIso && item.scheduled_departure) {
                displayDepIso = takeoffIso;
                if (Math.abs(parseUtcMs(takeoffIso) - parseUtcMs(item.scheduled_departure)) >= 60_000) {
                  depStruck = formatCardTime(item.scheduled_departure, item.origin_airport, false);
                } else {
                  depStruck = null;
                }
              }
            }
            // ETA değiştiyse planlı üstü çizili (delay yoksa da estimated varsa).
            if (
              !isLandedStatus &&
              !arrStruck &&
              item.estimated_arrival &&
              item.scheduled_arrival &&
              Math.abs(parseUtcMs(item.estimated_arrival) - parseUtcMs(item.scheduled_arrival)) >= 60_000
            ) {
              arrStruck = formatCardTime(item.scheduled_arrival, item.destination_airport, true);
              displayArrIso = item.estimated_arrival;
            }

            const depTime = formatCardTime(displayDepIso, item.origin_airport, false);
            const arrTime = formatCardTime(displayArrIso, item.destination_airport, true);
            const depSkewMins = skewMinsBetween(displayDepIso, item.scheduled_departure);
            const arrSkewRaw = skewMinsBetween(displayArrIso, item.scheduled_arrival);
            // İniş gecikmesi: yalnızca ≥15 dk geç sayılır (1–14 normal).
            const arrSkewMins = isLandedStatus
              ? significantArrivalSkewMins(arrSkewRaw)
              : arrSkewRaw;
            // Rozet sapması: inişte ATA; havada ATD; aksi halde ETD/ETA.
            const delayMinsRaw = isLandedStatus
              ? arrSkewMins
              : isEnRoute
                ? depSkewMins ?? arrSkewMins
                : depSkewMins ?? arrSkewMins ?? (delayMinsLegacy != null ? delayMinsLegacy : null);
            const delayMins = isLandedStatus
              ? significantArrivalSkewMins(delayMinsRaw)
              : delayMinsRaw;
            const depMs = parseUtcMs(item.scheduled_departure);
            const arrMs = parseUtcMs(item.scheduled_arrival);
            let durationMins = 0;
            if (depMs > 0 && arrMs > 0) {
              let end = arrMs;
              if (end <= depMs) end += 24 * 60 * 60 * 1000;
              durationMins = Math.round((end - depMs) / 60000);
            }
            const durH = Math.floor(durationMins / 60);
            const durM = durationMins % 60;
            const durationLabel =
              durationMins > 0
                ? durH > 0
                  ? t('roster.durationShort', { hours: durH, mins: durM })
                  : t('roster.durationMinsOnly', { mins: durM })
                : ' ';
            // +1: kalkış/varış istasyon yerel takvim günü (UTC görünümünde bile yerel +1 doğru).
            const legCrossesNextDay = (depIso: string | null | undefined, arrIso: string | null | undefined) => {
              if (!depIso || !arrIso) return false;
              const otz = getAirportTimezone(item.origin_airport) ?? 'UTC';
              const dtz = getAirportTimezone(item.destination_airport) ?? 'UTC';
              const d0 = calendarDateFromUtcIsoInTimeZone(depIso, otz);
              const d1 = calendarDateFromUtcIsoInTimeZone(arrIso, dtz);
              if (d0 && d1 && d0 !== d1) return true;
              const a = parseUtcMs(depIso);
              const b = parseUtcMs(arrIso);
              return a > 0 && b > 0 && b <= a;
            };
            const plusOneDay =
              !isNonFlightBlock &&
              (showNextDayHint ||
                legCrossesNextDay(item.scheduled_departure, item.scheduled_arrival) ||
                legCrossesNextDay(displayDepIso, displayArrIso));
            const rawProgress = getFlightProgress(item);
            const progress = isEnRoute && !isNonFlightBlock ? rawProgress : null;
            const progressBounds =
              isEnRoute && !isNonFlightBlock ? getFlightProgressBounds(item) : null;
            const progressRemainLabel =
              progress != null && progressBounds && progressBounds.endMs > 0
                ? t('roster.progressRemain', {
                    remain: formatShortDurationFromMs(Math.max(0, progressBounds.endMs - nowMs)),
                  })
                : null;
            const progressNearingArrival =
              !!progressBounds &&
              progressBounds.endMs > nowMs &&
              progressBounds.endMs - nowMs <= 30 * 60_000;
            const msToDep = depMs > 0 ? depMs - nowMs : null;
            const withinTwoHoursToDep =
              msToDep != null && msToDep <= 2 * 60 * 60 * 1000 && msToDep > -6 * 60 * 60 * 1000;
            const showLiveTrack = !isNonFlightBlock && (isEnRoute || !!withinTwoHoursToDep);
            const dayYmd = listGroupDate(item);
            const isPast =
              dayYmd < rosterTodayYmd ||
              displayStatus === 'landed';
            const cityFor = (code: string | null | undefined, fallback: string | null | undefined) => {
              const d = code ? getAirportDisplay(code) : null;
              if (isTr && d?.city_tr) return d.city_tr;
              return (fallback || d?.city || '').trim() || undefined;
            };
            const originCityName = isNonFlightBlock
              ? undefined
              : cityFor(item.origin_airport, item.origin_city);
            const destCityName = isNonFlightBlock
              ? undefined
              : cityFor(item.destination_airport, item.destination_city);

            const onCardPress = () => {
              if (isCrew) {
                if (showAdminFr24Debug && !isNonFlightBlock) {
                  navigation.navigate('AdminFlightApiDebug', { flightId: item.id });
                } else if (isNonFlightBlock) {
                  navigation.navigate('EditDuty', { flightId: item.id });
                } else {
                  navigation.navigate('EditFlight', { flightId: item.id });
                }
              } else if (isNonFlightBlock) {
                navigation.navigate('EditDuty', { flightId: item.id, readOnly: true });
              } else {
                navigation.navigate('EditFlight', { flightId: item.id, readOnly: true });
              }
            };

            const cardModel = {
              flightNumber: item.flight_number,
              originIata: (item.origin_airport || '').toUpperCase().slice(0, 3) || '—',
              destIata: (item.destination_airport || '').toUpperCase().slice(0, 3) || '—',
              originCity: originCityName,
              destCity: destCityName,
              depTime,
              arrTime,
              depStruck,
              arrStruck,
              durationLabel,
              plusOneDay: !!plusOneDay,
              delayMins,
              depSkewMins,
              arrSkewMins,
              rosterEntryKind: item.roster_entry_kind,
              flightStatus: item.flight_status ?? displayStatus,
              isStandbyDutyCode: isStandbyDutyCode || isReserveDutyCode,
              isNonFlightBlock,
              blockTitle: isSimBlock
                ? `${t('roster.simulatorBlockType')} ${blockTitle}`.trim()
                : isStandbyBlock
                  ? undefined
                  : isNonFlightBlock
                    ? isAnnualLeaveCode ||
                        isUnpaidLeaveCode ||
                        isGroundDutyBlock ||
                        isOfficeDutyCode ||
                        isTrainingOccupationCode(blockCode)
                      ? blockTitle
                      : t('roster.restDay')
                    : undefined,
              compactKind: (isStandbyBlock
                ? 'standby'
                : isNonFlightBlock
                  ? 'off'
                  : null) as 'standby' | 'off' | null,
              /** Nöbet: base IATA — aksi yoksa herkes base’te nöbettedir. */
              layoverStationLabel: isStandbyBlock ? dutyStationIata : undefined,
              standbyScheduleLine: isStandbyBlock
                ? `${formatStandbyDayMonth(item.flight_date)} · ${depTime} – ${arrTime}`
                : undefined,
              progress,
              progressRemainLabel,
              progressNearingArrival,
              showLiveTrack,
              footerHint: null,
              showAssignAction: isStandbyBlock && isCrew,
              showSuggestOccupation:
                isCrew &&
                isNonFlightBlock &&
                !isStandbyBlock &&
                !!blockCode &&
                !isOccupationCodeDefined(blockCode, crewProfile?.airline_icao) &&
                occupationSuggestTick >= 0,
              aircraftReg: isEnRoute
                ? aircraftRegById[item.id] ||
                  formatAircraftRegistration(item.aircraft_registration) ||
                  null
                : null,
              aircraftType: null,
              isPast,
            };

            const cardInner = (
              <RosterFlightCard
                model={cardModel}
                themeMode={themeMode}
                fontScale={listFontScale}
                onPress={onCardPress}
                onLiveTrack={
                  showLiveTrack
                    ? () => openFlightradar24(item.flight_number, item.flight_date, fr24IdByFlightId[item.id])
                    : undefined
                }
                onFooterAction={
                  isStandbyBlock && isCrew ? () => openAssignFlightsFromStandby(item) : undefined
                }
                onSuggestOccupation={
                  isCrew &&
                  isNonFlightBlock &&
                  !isStandbyBlock &&
                  !isOccupationCodeDefined(blockCode, crewProfile?.airline_icao)
                    ? () => setSuggestOccupation({ code: blockCode, flightId: item.id })
                    : undefined
                }
              />
            );
            const cardContent = (
                <Swipeable
                  ref={(r) => { swipeableRefs.current[item.id] = r; }}
                  renderLeftActions={renderLeftActions}
                  renderRightActions={renderRightActions}
                  leftThreshold={20}
                  onSwipeableOpen={onSwipeableOpen}
                  overshootLeft={false}
                  overshootRight={false}
                >
                  <View
                    onLayout={(e) => {
                      const h = Math.round(e.nativeEvent.layout.height);
                      if (h <= 0) return;
                      setSwipeCardHeights((prev) => (prev[item.id] === h ? prev : { ...prev, [item.id]: h }));
                    }}
                  >
                    {cardInner}
                  </View>
                </Swipeable>
              );
            return (
              <View
                style={styles.itemWrapper}
                onLayout={(e) => recordListItemHeight(index, e.nativeEvent.layout.height)}
              >
                {cardContent}
              </View>
            );
          }}
          />
        </View>
        )}
      </View>

      {shareToastMessage ? (
        <View
          pointerEvents="none"
          style={[
            styles.shareToast,
            {
              backgroundColor: colors.text,
              bottom: Math.max(insets.bottom, 12) + 72,
            },
          ]}
        >
          <Text style={[styles.shareToastText, { color: colors.background }]}>{shareToastMessage}</Text>
        </View>
      ) : null}

      {clearUndoToast ? (
        <View
          style={[
            styles.shareToast,
            styles.clearUndoToast,
            {
              backgroundColor: colors.text,
              bottom: Math.max(insets.bottom, 12) + 72,
            },
          ]}
        >
          <Text style={[styles.shareToastText, { color: colors.background, flex: 1 }]} numberOfLines={2}>
            {clearUndoToast}
          </Text>
          <TouchableOpacity onPress={undoPendingClear} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.clearUndoAction, { color: colors.onPrimary }]}>
              {t('roster.clearUndoAction')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {infoToast ? (
        <View
          style={[
            styles.shareToast,
            styles.clearUndoToast,
            {
              backgroundColor: colors.text,
              bottom: Math.max(insets.bottom, 12) + (clearUndoToast ? 128 : 72),
            },
          ]}
        >
          <Text style={[styles.shareToastText, { color: colors.background, flex: 1 }]} numberOfLines={2}>
            {infoToast}
          </Text>
        </View>
      ) : null}

      <Modal
        visible={addFlightMenuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddFlightMenuVisible(false)}
      >
        <View style={styles.addMenuRoot}>
          <Pressable
            style={styles.addMenuBackdrop}
            onPress={() => setAddFlightMenuVisible(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          />
          <View
            style={[
              styles.addMenuSheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 16) + 8,
              },
            ]}
          >
            <View style={[styles.addMenuHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.addMenuTitle, { color: colors.text }]}>{t('roster.addFlightSheetTitle')}</Text>
            <TouchableOpacity
              style={[styles.addMenuRow, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={openAddFlightManual}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={[styles.addMenuIconWrap, { backgroundColor: colors.primaryLight }]}>
                <Text style={styles.addMenuEmoji} accessibilityElementsHidden>
                  ✈️
                </Text>
              </View>
              <View style={styles.addMenuTextCol}>
                <Text style={[styles.addMenuItemText, { color: colors.text }]}>{t('roster.addManualFlight')}</Text>
                <Text style={[styles.addMenuItemHint, { color: colors.textMuted }]}>
                  {t('roster.addManualFlightHint')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addMenuRow, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={openAddFlightImport}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={[styles.addMenuIconWrap, { backgroundColor: colors.primaryLight }]}>
                <Text style={styles.addMenuEmoji} accessibilityElementsHidden>
                  📄
                </Text>
              </View>
              <View style={styles.addMenuTextCol}>
                <Text style={[styles.addMenuItemText, { color: colors.text }]}>{t('roster.importRosterFile')}</Text>
                <Text style={[styles.addMenuItemHint, { color: colors.textMuted }]}>
                  {t('roster.importRosterFileHint')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            {isCrew && !isPeerViewer && flights.length > 0 ? (
              <TouchableOpacity
                style={[
                  styles.addMenuRow,
                  {
                    backgroundColor: themeMode === 'dark' ? '#3A1A1A' : '#FEF3F2',
                    borderColor: themeMode === 'dark' ? '#5C2A2A' : '#FECACA',
                    marginTop: 4,
                  },
                ]}
                onPress={() => {
                  setAddFlightMenuVisible(false);
                  handleClearAllFlights();
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('roster.clearFlightsMenu')}
              >
                <View
                  style={[
                    styles.addMenuIconWrap,
                    { backgroundColor: themeMode === 'dark' ? '#5C2A2A' : '#FEE2E2' },
                  ]}
                >
                  <Ionicons name="trash-outline" size={22} color={colors.error} />
                </View>
                <View style={styles.addMenuTextCol}>
                  <Text style={[styles.addMenuItemText, { color: colors.error }]}>
                    {t('roster.clearFlightsMenu')}
                  </Text>
                  <Text style={[styles.addMenuItemHint, { color: colors.textMuted }]}>
                    {t('roster.clearFlightsMenuHint')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.error} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>

      <ClearFlightsConfirmModal
        visible={clearConfirmVisible}
        flights={flights}
        todayYmd={rosterTodayYmd}
        onCancel={() => setClearConfirmVisible(false)}
        onConfirm={(toDelete) => {
          setClearConfirmVisible(false);
          executeClearWithUndo(toDelete as Flight[]);
        }}
      />
      <SuggestOccupationModal
        visible={!!suggestOccupation}
        code={suggestOccupation?.code || ''}
        onClose={() => setSuggestOccupation(null)}
        onSubmit={async (payload) => {
          await setLocalOccupationOverride({
            code: payload.code,
            label_tr: payload.label_tr,
            label_en: payload.label_en,
            category: payload.category,
            airline_icao: crewProfile?.airline_icao ?? null,
          });
          const uid = session?.user?.id;
          if (!uid) throw new Error('Oturum yok');
          const { error } = await supabase.from('roster_occupation_suggestions').insert({
            user_id: uid,
            code: payload.code.replace(/\s/g, '').toUpperCase(),
            label_tr: payload.label_tr,
            label_en: payload.label_en,
            category: payload.category,
            note: payload.note || null,
            crew_airline_icao: (crewProfile?.airline_icao || '').trim().toUpperCase() || null,
            sample_flight_id: suggestOccupation?.flightId || null,
            status: 'pending',
          });
          if (error) throw new Error(error.message);
        }}
      />

      <RosterListTasksModal
        visible={rosterTasksModalVisible}
        onClose={() => setRosterTasksModalVisible(false)}
        mode={profile?.role === 'crew' ? 'crew' : 'family'}
        crewProfileId={crewProfile?.id ?? null}
        profileUserId={profile?.id ?? null}
        prefsSeed={rosterListPrefs}
        refreshProfile={refreshProfile}
        onAfterSave={reloadFamilyRosterPrefs}
        onClearAllFlights={isCrew && !isPeerViewer ? handleClearAllFlights : undefined}
      />
    </View>
  );
}

function createRosterStyles(fs: (n: number) => number, themeMode: 'light' | 'dark') {
  const cardTok = rosterCardStyleTokens(themeMode);
  const ink = rosterCardInk(themeMode);
  const onPrimary = colors.onPrimary;
  return StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 0, paddingBottom: 0 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    gap: 12,
  },
  pageTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  readOnlyPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readOnlyPillText: {
    fontSize: fs(10),
    fontWeight: '700',
  },
  sharedOffBanner: {
    marginHorizontal: 0,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  sharedOffBannerText: {
    fontSize: fs(13),
    fontWeight: '700',
  },
  pageTitle: {
    flexShrink: 1,
    fontSize: fs(28),
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  pageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: -10 },
  pageIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  pageIconBtnPrimary: {
    borderWidth: 0,
  },
  headerRoundIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
  },
  /** Primary header üzerinde her zaman açık cam — koyu modda siyah cam kayboluyordu. */
  headerRoundIconBtnLight: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.4)',
  },
  headerRoundIconBtnDark: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.36)',
  },
  headerRoundIconBtnDisabled: { opacity: 0.55 },
  inlineCalendar: {
    marginBottom: 0,
    marginHorizontal: 0,
    paddingHorizontal: 12,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: colors.background,
  },
  inlineCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 2,
    minHeight: 32,
    paddingHorizontal: 2,
  },
  inlineCalendarTitleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
    flexShrink: 1,
    paddingVertical: 4,
    minHeight: 32,
  },
  inlineCalendarTitle: {
    fontSize: fs(15),
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  syncMetaBesideMonthBtn: {
    flexShrink: 1,
    maxWidth: '52%',
    minHeight: 28,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  syncMetaBesideMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  syncMetaBesideMonth: {
    fontSize: fs(11),
    fontWeight: '500',
    textAlign: 'right',
  },
  addMenuRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  addMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,27,61,0.45)',
  },
  addMenuSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
    minHeight: 220,
  },
  addMenuHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  addMenuTitle: {
    fontSize: fs(17),
    fontWeight: '800',
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  addMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addMenuIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMenuEmoji: {
    fontSize: 22,
  },
  addMenuTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  addMenuItemText: {
    fontSize: fs(16),
    fontWeight: '700',
  },
  addMenuItemHint: {
    fontSize: fs(13),
    fontWeight: '500',
  },
  crewFilterScroll: { marginBottom: 4, maxHeight: 36 },
  crewFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  crewFilterLabel: { fontSize: 12, fontWeight: '700', marginRight: 2 },
  crewFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 140,
  },
  crewFilterChipSelected: {},
  calendarWeekRow: { flexDirection: 'row', marginBottom: 0 },
  calendarWeekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', paddingVertical: 2 },
  calendarWeek: { flexDirection: 'row', height: CALENDAR_COL_H },
  calendarCol: {
    flex: 1,
    height: CALENDAR_COL_H,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  calendarDayInner: {
    height: '100%',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 3,
    borderRadius: CALENDAR_DAY_RADIUS,
    overflow: 'hidden',
  },
  calendarSelectRing: {
    position: 'absolute',
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderWidth: 2,
    zIndex: 2,
  },
  /** Nokta + çubuk her hücrede aynı dibe — rakam/ay kısaltması çubuğu kaydırmasın. */
  calendarMarkers: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: CALENDAR_MARK_BOTTOM,
    alignItems: 'center',
  },
  calendarDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: CALENDAR_DOT_SIZE + 1,
    minHeight: CALENDAR_DOT_SIZE + 1,
  },
  calendarBarTrack: {
    width: '100%',
    height: CALENDAR_BAR_H,
    marginTop: CALENDAR_DOT_BAR_GAP,
    justifyContent: 'center',
  },
  calendarLegendBar: {
    width: 12,
    height: calendarMarkSize.barHeight,
    borderRadius: calendarMarkSize.barHeight / 2,
  },
  calendarCellOutOfRange: {
    opacity: 0.32,
  },
  calendarCellOtherMonth: {
    opacity: 0.35,
  },

  syncedDateWrap: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  syncedDateText: { fontSize: fs(18), fontWeight: '800' },
  syncedDateSublabel: { fontSize: fs(13), fontStyle: 'italic', fontWeight: '600' },
  daySeparatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  daySeparatorLine: {
    flex: 1,
    height: 1,
  },
  daySeparatorDate: {
    fontSize: fs(12),
    fontStyle: 'italic',
    textAlign: 'center',
  },
  rosterContentWrap: { flex: 1, minHeight: 0 },
  rosterActionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  dayHeaderEmpty: {
    marginTop: 4,
    marginLeft: 11,
    fontSize: fs(12),
    fontWeight: '500',
  },
  shareToast: {
    position: 'absolute',
    left: 24,
    right: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.button,
    alignItems: 'center',
    zIndex: 20,
  },
  shareToastText: {
    fontSize: fs(14),
    fontWeight: '600',
    textAlign: 'center',
  },
  cleanupBanner: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 0,
    marginBottom: 8,
    borderRadius: radius.button,
  },
  cleanupBannerText: {
    fontSize: fs(14),
    fontWeight: '600',
  },
  rosterActionButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: colors.primary,
    paddingVertical: 0,
    paddingHorizontal: 10,
    borderRadius: radius.button,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  rosterActionButtonOutline: {
    flex: 1,
    minHeight: 44,
    backgroundColor: colors.surface,
    paddingVertical: 0,
    paddingHorizontal: 10,
    borderRadius: radius.button,
    borderWidth: 1.5,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  rosterActionButtonCenter: {},
  rosterActionButtonDanger: {
    backgroundColor: colors.error,
    borderWidth: 1,
    borderColor: colors.error,
  },
  rosterActionButtonContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  rosterActionButtonTextDark: {
    color: colors.text,
    fontWeight: '700',
    fontSize: fs(13),
  },
  dayHeaderRow: {
    paddingTop: 14,
    paddingBottom: 8,
    paddingHorizontal: 2,
    zIndex: 2,
  },
  dayHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 20,
  },
  dayHeaderAccent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    opacity: 0.85,
  },
  dayHeaderHairline: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    minHeight: 1,
    borderRadius: 1,
    opacity: 0.9,
  },
  dayHeaderText: {
    fontSize: fs(13),
    fontWeight: '700',
    flexShrink: 0,
  },
  calendarLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
  },
  calendarLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  calendarLegendDot: { width: calendarMarkSize.dot, height: calendarMarkSize.dot, borderRadius: calendarMarkSize.dot / 2 },
  calendarLegendSwatch: { width: 10, height: 10, borderRadius: 3 },
  calendarLegendText: { fontSize: fs(10), fontWeight: '500' },
  rosterActionButtonLabelCol: {
    flexShrink: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  rosterActionButtonSubText: {
    color: onPrimary,
    fontWeight: '600',
    fontSize: fs(11),
    lineHeight: fs(12),
    textAlign: 'center',
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  rosterActionButtonDeleteLine1: {
    color: colors.white,
    fontWeight: '700',
    fontSize: fs(11),
    lineHeight: fs(12),
    textAlign: 'center',
    maxWidth: '100%',
    ...Platform.select({
      android: { includeFontPadding: false, fontSize: fs(10), lineHeight: fs(11) },
      default: {},
    }),
  },
  rosterActionButtonDeleteLine2: {
    color: colors.white,
    fontWeight: '700',
    fontSize: fs(10),
    lineHeight: fs(11),
    textAlign: 'center',
    maxWidth: '100%',
    ...Platform.select({
      android: { includeFontPadding: false, fontSize: fs(9), lineHeight: fs(10) },
      default: {},
    }),
  },
  rosterActionButtonText: {
    color: onPrimary,
    fontWeight: '700',
    fontSize: fs(12),
    lineHeight: fs(13),
    flexShrink: 1,
    textAlign: 'center',
    ...Platform.select({
      android: { includeFontPadding: false, textAlignVertical: 'center' },
      default: {},
    }),
  },
  rosterActionButtonDangerText: {
    color: colors.white,
  },
  listAndClearContainer: { flex: 1 },
  listFlex: { flex: 1 },
  list: { paddingBottom: rosterListSpacing.listBottomPad, paddingRight: 10 },
  clearAllButtonWrap: {
    paddingHorizontal: 0,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: colors.background,
    gap: 8,
    marginBottom: 0,
  },
  clearAllButton: {
    backgroundColor: colors.error,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7A0000',
  },
  clearAllButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clearAllButtonText: { color: colors.white, fontWeight: '700', fontSize: fs(16) },
  itemWrapper: { marginBottom: rosterListSpacing.cardGapSameDay },
  dayRailRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  dayRail: {
    width: 4,
    borderRadius: 3,
  },
  dayRailFirst: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  dayRailLast: {
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  dayRailCardWrap: {
    flex: 1,
  },
  groupDivider: {
    position: 'absolute',
    top: -8,
    left: 8,
    right: 8,
    height: 2,
    borderRadius: 1,
  },
  /** Uçuş kartları (crew + family aynı) — `theme/rosterCardVisual.ts`. */
  card: {
    backgroundColor: cardTok.flightBg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: cardTok.flightBorder,
    overflow: 'hidden',
  },
  /** Boş Gün */
  cardOffDuty: {
    backgroundColor: cardTok.offDutyBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: cardTok.offDutyBorder,
  },
  /** Nöbet */
  cardStandby: {
    backgroundColor: cardTok.standbyBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: cardTok.standbyBorder,
  },
  dateRowNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: themeMode === 'dark' ? colors.text : '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dateRowNumberNonFlight: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.text,
  },
  dateRowNumberSelection: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dateRowNumberSelectionActive: {
    backgroundColor: colors.primary,
  },
  dateRowNumberText: {
    color: themeMode === 'dark' ? '#0B0D11' : '#FFFFFF',
    fontSize: fs(12),
    fontWeight: '700',
  },
  dateRowNumberTextNonFlight: {
    color: ink.primary,
    fontSize: fs(16),
    fontWeight: '900',
    lineHeight: fs(18),
    textAlign: 'center',
    ...Platform.select({
      android: { includeFontPadding: false, textAlignVertical: 'center' },
      default: {},
    }),
  },
  /** Kalkış yapmış (en_route / departed) */
  cardInFlight: {
    backgroundColor: cardTok.inFlightBg,
    borderWidth: 2,
    borderColor: cardTok.inFlightBorder,
  },
  /** İnen uçuş */
  cardLanded: {
    backgroundColor: cardTok.landedBg,
    borderWidth: 2,
    borderColor: colors.success,
  },
  cardSelected: {
    borderWidth: 3,
    borderColor: colors.primary,
  },
  cardRow: { flexDirection: 'row', alignItems: 'stretch', padding: 16, paddingRight: 0 },
  cardMain: { flex: 1, paddingRight: 12, position: 'relative' },
  cardMainWrap: { flex: 1, justifyContent: 'space-between', position: 'relative' },
  phaseDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 2,
  },
  /** Faz noktası ile tarih/satır çakışmasın */
  cardMainBodyWithPhaseDot: { paddingRight: 12 },
  cardMainBottom: {},
  sideDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  cardMainTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  statusBox: {
    backgroundColor: 'transparent',
    paddingTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 4,
    borderRadius: 0,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: 104,
    alignSelf: 'stretch',
  },
  statusBoxInner: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
  },
  statusContentCenter: {
    flex: 1,
    alignSelf: 'stretch',
    width: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  /** Statü + kuyruk üstte; ikon ayrı orta bölgede. */
  statusTopCluster: {
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
    paddingTop: 0,
    paddingHorizontal: 2,
  },
  statusIconArea: {
    flex: 1,
    alignSelf: 'stretch',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: fs(34),
    marginTop: fs(4),
  },
  statusLabel: { fontSize: fs(19), fontWeight: '800', textAlign: 'center', lineHeight: fs(22) },
  aircraftRegBelowStatusWrap: { alignSelf: 'center', marginTop: 2, marginBottom: 0 },
  aircraftRegText: { fontSize: fs(11), fontWeight: '700', textAlign: 'center', letterSpacing: 0.2 },
  statusLabelScheduled: { fontSize: fs(17), lineHeight: fs(20) },
  statusClockCenter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusClockIcon: { fontSize: fs(30), lineHeight: fs(34) },
  trackInStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
    paddingTop: 2,
    alignSelf: 'stretch',
  },
  trackInStatusText: { fontSize: fs(12), fontWeight: '700', fontStyle: 'italic', textAlign: 'center' },
  assignFlightsLinkText: { fontSize: fs(12), fontWeight: '700', fontStyle: 'normal', textAlign: 'center' },
  nextDayHint: { marginTop: 6, fontSize: fs(11), opacity: 0.85 },
  nextDayHintText: { fontStyle: 'italic' },
  date: { fontSize: fs(12), marginBottom: 2 },
  crew: { fontSize: fs(12), marginBottom: 2 },
  route: { fontSize: fs(16), fontWeight: '600', marginTop: 2 },
  divertSubline: { fontSize: fs(13), fontWeight: '600', marginTop: 4 },
  routeLabel: { fontWeight: '600' },
  flightNumber: { fontWeight: '800', fontSize: fs(19) },
  delayText: { fontWeight: '800', fontSize: fs(15) },
  indigoRosterDetailLine: { fontSize: fs(13), fontWeight: '500', marginTop: 4, lineHeight: Math.round(fs(18)) },
  progressWrap: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  progressBar: {
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'visible',
    position: 'relative',
    flexShrink: 1,
    width: '72%',
  },
  progressFill: {
    height: 4,
    backgroundColor: 'transparent',
    borderRadius: 999,
    overflow: 'hidden',
  },
  planeWrap: {
    position: 'absolute',
    // Center the 20px icon on the 4px bar.
    top: -10,
    // No rotation: pick an icon that already faces right.
    transform: [{ translateX: -10 }],
  },
  progressPct: { fontSize: fs(12), fontWeight: '800', minWidth: fs(38), textAlign: 'right', marginLeft: 6 },
  depArrLine: { fontSize: fs(13), marginTop: 6 },
  depArrPrefix: { fontWeight: '600' },
  depArrTimes: { fontWeight: '400', fontSize: fs(13) },
  /** Tek katman RectButton: width + backgroundColor + ölçülen height. */
  swipeUpdate: {
    width: 90,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  swipeUpdateText: { color: colors.white, fontWeight: '700', fontSize: fs(14) },
  swipeUpdateSpinner: { marginTop: 6 },
  swipeDelete: {
    width: 90,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  swipeDeleteText: { color: colors.white, fontWeight: '700', fontSize: fs(14) },
  empty: { textAlign: 'center', marginTop: 48, fontSize: fs(16) },
  emptyWrap: { flex: 1, paddingHorizontal: 8 },
  emptyActions: { marginTop: 20, paddingHorizontal: 8 },
  clearUndoToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    pointerEvents: 'auto',
  },
  clearUndoAction: {
    fontSize: fs(14),
    fontWeight: '800',
  },
});
}

const rosterStylesCache = new Map<string, ReturnType<typeof createRosterStyles>>();

function getCachedRosterStyles(themeMode: 'light' | 'dark') {
  const key = themeMode;
  const hit = rosterStylesCache.get(key);
  if (hit) return hit;
  // Chrome / takvim sabit pt — yazı boyutu yalnızca liste kartı metninde.
  const created = createRosterStyles((n) => n, themeMode);
  rosterStylesCache.set(key, created);
  return created;
}
