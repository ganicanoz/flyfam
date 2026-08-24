import React, { useState, useCallback, useLayoutEffect, useRef, useEffect, useMemo } from 'react';
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
  type AppStateStatus,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addCalendarDaysToYmd,
  calendarDateFromUtcIsoInTimeZone,
  formatFlightDateTr,
  formatFlightDateYmdInIanaTz,
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
import { rosterOccupationLabelEn, rosterOccupationLabelTr, isOffDayOccupationCode, isAnnualLeaveOccupationCode, isGroundDutyOccupationCode, isOfficeDutyOccupationCode, isStandbyOccupationCode, isTrainingOccupationCode } from '../lib/pdfRosterImport';
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
import { RosterListTasksModal } from '../components/RosterListTasksModal';
import FlightOperationOverlay from '../components/FlightOperationOverlay';
import { formatCityAndCode, formatDivertDestination, getAirportDisplay, getAirportTimezone } from '../constants/airports';
import { colors, useThemeMode } from '../theme/colors';
import {
  rosterCardStyleTokens,
  rosterCardInk,
  rosterCardChrome,
  type RosterCardVisualKind,
} from '../theme/rosterCardVisual';
import { useFontScaleMultiplier } from '../theme/fontScale';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';
import { isSimulatorOccupationCode } from '../lib/pdfRosterImport';
import { setRosterLastSyncedAt } from '../lib/rosterSyncMeta';

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

type CalendarDayKind = 'empty' | 'flight' | 'standby' | 'duty_off' | 'layover';

function calendarDayKindForEntry(f: {
  roster_entry_kind?: string | null;
  flight_number?: string | null;
  duty_occupation_code?: string | null;
}): CalendarDayKind {
  const blockCode = (f.flight_number || '').trim().toUpperCase();
  const occCode = (f.duty_occupation_code || '').trim().toUpperCase();
  const isSim = f.roster_entry_kind === 'sim' || isSimulatorOccupationCode(blockCode);
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

/**
 * Detects layover date ranges from a sorted flight list.
 * A layover occurs when a crew arrives at a station and the next departure
 * from that same station is ≥ LAYOVER_MIN_HOURS later.
 * Returns a Set of YYYY-MM-DD strings that are layover days.
 */
function computeLayoverDates(flights: readonly { flight_date: string; origin_airport: string | null; destination_airport: string | null; scheduled_departure: string | null; scheduled_arrival: string | null; roster_entry_kind?: string | null }[]): Set<string> {
  const layoverDates = new Set<string>();
  const realFlights = flights.filter(f => (f.roster_entry_kind ?? 'flight') === 'flight' && f.destination_airport);

  for (let i = 0; i < realFlights.length; i++) {
    const inbound = realFlights[i];
    const station = inbound.destination_airport!;
    const arrMs = parseUtcMsStatic(inbound.scheduled_arrival);
    if (!arrMs) continue;

    // Find next departure from same station
    let outbound: typeof realFlights[0] | null = null;
    for (let j = i + 1; j < realFlights.length; j++) {
      if (realFlights[j].origin_airport === station) {
        outbound = realFlights[j];
        break;
      }
    }
    if (!outbound) continue;
    const depMs = parseUtcMsStatic(outbound.scheduled_departure);
    if (!depMs) continue;

    const gapHours = (depMs - arrMs) / (1000 * 60 * 60);
    if (gapHours >= LAYOVER_MIN_HOURS) {
      // Mark all calendar days between arrival date and departure date (inclusive) as layover
      const arrDate = new Date(arrMs);
      const depDate = new Date(depMs);
      const startYmd = arrDate.toISOString().slice(0, 10);
      const endYmd = depDate.toISOString().slice(0, 10);
      let cur = startYmd;
      while (cur <= endYmd) {
        layoverDates.add(cur);
        const d = new Date(cur + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        cur = d.toISOString().slice(0, 10);
      }
    }
  }
  return layoverDates;
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
  'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, delay_dep_min, delay_arr_min, is_delayed, flight_status, internal_status, diverted_to, api_refresh_phase, phase_active_locked, estimated_departure, estimated_arrival, roster_entry_kind, duty_rest_end, roster_detail, aircraft_registration, fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent';

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

export default function Roster({
  showAdminFr24Debug = false,
  exemptLandedAutoPurge = false,
}: { showAdminFr24Debug?: boolean; exemptLandedAutoPurge?: boolean } = {}) {
  const { t, i18n } = useTranslation();
  const { profile, crewProfile, refreshProfile } = useSession();
  const themeMode = useThemeMode();
  const isDark = themeMode === 'dark';
  const fontScale = useFontScaleMultiplier();
  const styles = useMemo(
    () => createRosterStyles((n) => Math.round(n * fontScale), themeMode),
    [fontScale, themeMode],
  );
  const cardInk = useMemo(() => rosterCardInk(themeMode), [themeMode]);
  const [flights, setFlights] = useState<Flight[]>([]);
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
  const [sendingToFamily, setSendingToFamily] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isCrew = profile?.role === 'crew';
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFlightIds, setSelectedFlightIds] = useState<Record<string, boolean>>({});
  const todayStr = getLocalDateString();
  const [selectedDate, setSelectedDate] = useState<string>(() => todayStr);
  const [familyRosterListPrefs, setFamilyRosterListPrefs] = useState<RosterListShowPrefs>(() =>
    normalizeRosterListShow(null)
  );
  const [rosterTasksModalVisible, setRosterTasksModalVisible] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => todayStr.slice(0, 7));
  /** Geçmiş gün takvim renkleri (uçuş listeden düşünce de kırmızı/turuncu/yeşil kalsın). */
  const [persistedDayKinds, setPersistedDayKinds] = useState<Record<string, CalendarDayKind>>({});
  const [familyCrewOptions, setFamilyCrewOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [familyCrewFilterId, setFamilyCrewFilterId] = useState<string>('all');
  const familyCrewFilterIdRef = useRef('all');
  const [flightOpBusyMessage, setFlightOpBusyMessage] = useState<string | null>(null);
  const [subscriptionAccess, setSubscriptionAccess] = useState<SubscriptionAccess | null>(null);
  const [subscriptionAccessLoading, setSubscriptionAccessLoading] = useState(false);

  const rosterListPrefs = React.useMemo(() => {
    if (isCrew) return normalizeRosterListShow(crewProfile?.roster_list_show);
    return familyRosterListPrefs;
  }, [isCrew, crewProfile?.roster_list_show, familyRosterListPrefs]);

  const crewUtcView = isCrew && rosterListPrefs.time_display === 'utc';
  /** Aile: profil `timezone_iana` veya cihaz — liste günü ve sıra bu TZ’ye göre. */
  const familyRosterTz = !isCrew ? (profile?.timezone_iana?.trim() || getDeviceIanaTimeZone()) : null;

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
      setSelectedDate(v === 'utc' ? getUtcDateString() : getLocalDateString());
    }
  }, [isCrew, rosterListPrefs.time_display]);

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
    if (profile?.id && profile.role === 'family') {
      void loadFamilyRosterListShow(profile.id).then(setFamilyRosterListPrefs);
    }
  }, [profile?.id, profile?.role]);

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
  /**
   * Önce roster günü (`flight_date`), sonra aynı gün içinde kalkış saati.
   * Sadece UTC kalkışa göre global sıralama yapılırsa farklı günler iç içe geçer;
   * gün ayırıcı aynı tarih için iki kez üretilir → `day-2026-04-04` duplicate key hatası.
   */
  const allFlightsSorted = React.useMemo(() => {
    const copy = [...displayFlights];
    copy.sort((a, b) => {
      const ga = listGroupDate(a);
      const gb = listGroupDate(b);
      if (ga !== gb) return ga.localeCompare(gb);
      return sortByDepartureAsc(a, b);
    });
    return copy;
  }, [displayFlights, sortByDepartureAsc, listGroupDate]);
  const sameDutyFlightGroup = useCallback((a: Flight, b: Flight): boolean => {
    const aKind = (a.roster_entry_kind ?? 'flight') as string;
    const bKind = (b.roster_entry_kind ?? 'flight') as string;
    // Aynı uçuş görevi: aynı duty bitişi.
    if (aKind === 'flight' && bKind === 'flight') {
      if (listGroupDate(a) !== listGroupDate(b)) return false;
      const da = (a.duty_rest_end ?? '').trim();
      const db = (b.duty_rest_end ?? '').trim();
      return da.length > 0 && da === db;
    }
    // Aynı non-flight görev bloğu: aynı kod + aynı duty bitişi.
    if (aKind === 'duty_off' && bKind === 'duty_off') {
      const da = (a.duty_rest_end ?? '').trim();
      const db = (b.duty_rest_end ?? '').trim();
      const ca = (a.flight_number ?? '').trim().toUpperCase();
      const cb = (b.flight_number ?? '').trim().toUpperCase();
      return da.length > 0 && da === db && ca.length > 0 && ca === cb;
    }
    return false;
  }, [listGroupDate]);

  /**
   * Tarih ayırıcı satırı yok; boşlukla gruplama:
   * - `tight`: aynı duty_rest_end içindeki ardışık uçuşlar
   * - `normal`: diğer tüm geçişler
   */
  type ListEntry = {
    type: 'flight';
    flight: Flight;
    dayIndex: number;
    dayGroupIndex: number;
    isFirstInDay: boolean;
    isLastInDay: boolean;
    gapBefore: 'none' | 'tight' | 'normal';
  };
  const listData = React.useMemo((): ListEntry[] => {
    const out: ListEntry[] = [];
    let prevDate: string | null = null;
    let dayGroupIndex = -1;
    let dayIndex = 0;
    let prevFlight: Flight | null = null;
    for (const f of allFlightsSorted) {
      const g = listGroupDate(f);
      if (g !== prevDate) {
        prevDate = g;
        dayGroupIndex += 1;
        dayIndex = 0;
      }
      dayIndex += 1;
      const gapBefore: 'none' | 'tight' | 'normal' =
        prevFlight == null ? 'none' : sameDutyFlightGroup(prevFlight, f) ? 'tight' : 'normal';
      out.push({
        type: 'flight',
        flight: f,
        dayIndex,
        dayGroupIndex,
        isFirstInDay: dayIndex === 1,
        isLastInDay: false,
        gapBefore,
      });
      prevFlight = f;
    }
    for (let i = 0; i < out.length; i += 1) {
      const cur = out[i];
      const next = out[i + 1];
      if (!next || next.dayGroupIndex !== cur.dayGroupIndex) cur.isLastInDay = true;
    }
    return out;
  }, [allFlightsSorted, listGroupDate, sameDutyFlightGroup]);
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
    const allCrewIds = (conns ?? []).map((c: { crew_id: string }) => c.crew_id);
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

    const filterId = familyCrewFilterIdRef.current;
    const crewIds =
      filterId !== 'all' && allCrewIds.includes(filterId) ? [filterId] : allCrewIds;
    if (crewIds.length === 0) {
      if (flightsRef.current.length === 0) setFlights([]);
      return;
    }
    const minFlightDate = getLocalDateStringPlusDays(-getRosterMinDaysAgo(exemptLandedAutoPurge, isCrew));
    const flightIds = await fetchFlightIdsForFamily(supabase, crewIds, minFlightDate);
    console.log('[FamilyRoster] flightIds for family:', flightIds.length, 'minFlightDate:', minFlightDate);
    if (flightIds.length === 0) {
      if (flightsRef.current.length === 0) setFlights([]);
      return;
    }
    // Aile listesi: flights tablosundan sadece sütunları al (flight_crew ilişkisi şemada yoksa hata veriyor).
    const familyFlightCols =
      'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, delay_dep_min, delay_arr_min, is_delayed, flight_status, internal_status, diverted_to, api_refresh_phase, phase_active_locked, estimated_departure, estimated_arrival, roster_entry_kind, duty_rest_end, roster_detail, aircraft_registration, fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent';
    let { data, error } = await supabase
      .from('flights')
      .select(familyFlightCols)
      .in('id', flightIds)
      .order('flight_date', { ascending: true });

    if (
      error &&
      (isMissingColumn(error.message, 'fr24_progress_dep_utc') ||
        isMissingColumn(error.message, 'fr24_progress_eta_utc') ||
        isMissingColumn(error.message, 'fr24_datetime_takeoff_utc') ||
        isMissingColumn(error.message, 'fr24_datetime_landed_utc') ||
        isMissingColumn(error.message, 'airlabs_progress_percent'))
    ) {
      const stripFr24 = familyFlightCols.replace(
        ', fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent',
        '',
      );
      const { data: retryFr, error: errFr } = await supabase
        .from('flights')
        .select(stripFr24)
        .in('id', flightIds)
        .order('flight_date', { ascending: true });
      if (!errFr && retryFr) {
        data = retryFr;
        error = null;
      }
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
  }, [isCrew, profile?.id, normalizeFutureLandedInDb, exemptLandedAutoPurge]);

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

  const handlePullToRefresh = useCallback(async () => {
    if (isCrew) {
      setRefreshingList(true);
      await refreshTimesFromApi(true);
      setRefreshingList(false);
    } else {
      setRefreshingList(true);
      try {
        await refreshFamilyListFromDb().catch(() => {});
        await refreshFamilyListFromApi(false);
      } finally {
        setRefreshingList(false);
      }
    }
  }, [isCrew, refreshTimesFromApi, refreshFamilyListFromApi, refreshFamilyListFromDb]);

  const rosterHeaderTitleStyle = React.useMemo(
    () => ({
      color: colors.onPrimary,
      fontWeight: '800' as const,
      fontSize: Math.round(20 * fontScale),
    }),
    [fontScale, themeMode],
  );

  useLayoutEffect(() => {
    const syncButton = isCrew ? (
      <TouchableOpacity
        onPress={() => refreshTimesFromApi()}
        disabled={updatingTimes || flights.length === 0}
        style={[
          styles.headerRoundIconBtn,
          isDark ? styles.headerRoundIconBtnDark : styles.headerRoundIconBtnLight,
          (updatingTimes || flights.length === 0) && styles.headerRoundIconBtnDisabled,
        ]}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={t('roster.sync')}
      >
        {updatingTimes ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <Ionicons name="sync" size={18} color={colors.onPrimary} />
        )}
      </TouchableOpacity>
    ) : profile ? (
      <TouchableOpacity
        onPress={() => refreshFamilyListFromApi(false)}
        disabled={refreshingList || flights.length === 0}
        style={[
          styles.headerRoundIconBtn,
          isDark ? styles.headerRoundIconBtnDark : styles.headerRoundIconBtnLight,
          (refreshingList || flights.length === 0) && styles.headerRoundIconBtnDisabled,
        ]}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={t('roster.sync')}
      >
        {refreshingList ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <Ionicons name="sync" size={18} color={colors.onPrimary} />
        )}
      </TouchableOpacity>
    ) : null;

    const adminModeTitleText = t('roster.adminModeTitle');
    const adminHeaderBadgeMaxW = Math.min(300, Dimensions.get('window').width - 128);

    navigation.setOptions({
      title: showAdminFr24Debug ? '' : t('nav.roster'),
      ...(showAdminFr24Debug
        ? {
            headerTitleAlign: 'center' as const,
            headerTitleContainerStyle: {
              flexGrow: 1,
              maxWidth: Dimensions.get('window').width - 88,
              paddingHorizontal: 4,
              alignItems: 'center' as const,
              justifyContent: 'center' as const,
            },
          }
        : {
            headerTitleAlign: undefined,
            headerTitleContainerStyle: undefined,
          }),
      headerTitle: showAdminFr24Debug
        ? () => (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('AdminPanel')}
              style={{
                maxWidth: adminHeaderBadgeMaxW,
                backgroundColor: colors.surface,
                paddingHorizontal: Math.round(10 * fontScale),
                paddingVertical: Math.round(7 * fontScale),
                borderRadius: 10,
                borderWidth: 2,
                borderColor: '#DC2626',
              }}
              accessibilityLabel={adminModeTitleText}
            >
              <Text
                style={{
                  color: '#DC2626',
                  fontWeight: '900',
                  fontSize: Math.round(12 * fontScale),
                  textAlign: 'center',
                  lineHeight: Math.round(16 * fontScale),
                }}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                allowFontScaling
              >
                {adminModeTitleText}
              </Text>
            </TouchableOpacity>
          )
        : undefined,
      headerTitleStyle: showAdminFr24Debug ? undefined : rosterHeaderTitleStyle,
      headerLeft: profile
        ? () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 2 }}>
              <TouchableOpacity
                onPress={() => setRosterTasksModalVisible(true)}
                style={[styles.headerRoundIconBtn, isDark ? styles.headerRoundIconBtnDark : styles.headerRoundIconBtnLight]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel={t('roster.listTaskSettings')}
              >
                <Ionicons name="settings-outline" size={18} color={colors.onPrimary} />
              </TouchableOpacity>
            </View>
          )
        : undefined,
      headerRight: profile ? () => syncButton : undefined,
    });
  }, [
    navigation,
    isCrew,
    profile,
    refreshTimesFromApi,
    refreshFamilyListFromApi,
    updatingTimes,
    refreshingList,
    flights.length,
    t,
    isDark,
    showAdminFr24Debug,
    rosterHeaderTitleStyle,
    fontScale,
  ]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      // Bugün: crew UTC görünümü → UTC günü; aile → profil/cihaz TZ takvim günü; crew yerel → cihaz günü.
      setSelectedDate(
        crewUtcView
          ? getUtcDateString()
          : familyRosterTz
            ? getCalendarDateStringInTimeZone(new Date(), familyRosterTz)
            : getLocalDateString()
      );
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
            const addedDate = route?.params?.addedFlightDate as string | undefined;
            if (!cancelled && addedDate && /^\d{4}-\d{2}-\d{2}$/.test(addedDate)) setSelectedDate(addedDate);
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
        const id = setInterval(tick, FAMILY_REFRESH_INTERVAL_MS);
        return () => {
          cancelled = true;
          clearInterval(id as any);
        };
      }

      return () => { cancelled = true; };
    }, [isCrew, crewProfile?.id, profile?.id, getAutoRefreshList, refreshTimesFromApi, refreshFamilyListFromDb, refreshCrewListFromDb])
  );

  const formatDate = formatFlightDateTr;
  const formatRosterDayLabel = useCallback(
    (dateYmd: string) => {
      if (crewUtcView) return formatUtcCalendarDateLabel(dateYmd);
      if (familyRosterTz) return formatFlightDateYmdInIanaTz(dateYmd, familyRosterTz);
      return formatDate(dateYmd);
    },
    [crewUtcView, familyRosterTz]
  );
  const formatTimeUTC = (iso: string | null) => formatFlightTimeUTC(iso);
  const formatTimeLocal = (iso: string | null) => formatFlightTimeLocal(iso);
  /** Boş Gün / SIM: PDF’deki (L) saatler TR yerelde yorumlanıp UTC’ye yazılıyor; gösterim cihaz TZ’sine göre olmamalı. */
  const formatTimeRosterPdfLocal = (iso: string | null) => formatFlightTimeInTz(iso, 'Europe/Istanbul');
  const rosterPdfLocalTzTag = 'TR';
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
  const getFlightProgress = (f: Flight): number | null => {
    if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') return null;
    const rawStatus = String(f.flight_status ?? '').toLowerCase();
    if (rawStatus === 'landed' || rawStatus === 'parked') return 1;
    const landFr = parseUtcMs(f.fr24_datetime_landed_utc ?? null);
    if (landFr > 0 && nowMs >= landFr) return 1;
    const actArrMs = parseUtcMs(f.actual_arrival ?? null);
    if (actArrMs > 0 && nowMs >= actArrMs) return 1;

    const takeoffMs = parseUtcMs(f.fr24_datetime_takeoff_utc ?? fr24TakeoffUtcByFlightId[f.id] ?? null);
    if (!takeoffMs) return 0;

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

    // STA+kaydırma: kalkış + planlı çift varsa her zaman (faz gecikse bile). Yoksa semi_active’te
    // ETD−30dk eşiği nedeniyle yanlış ETA tabanlı yüzde çıkıyordu (DB flight_status gecikmesi vb.).
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

    if (nowMs <= depMs) return 0;
    if (nowMs >= endMs) return 1;
    const p = (nowMs - depMs) / (endMs - depMs);
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
    if ((status === 'landed' || status === 'parked') && landMs > 0 && staMs > 0) {
      const actualArrDelay = Math.round((landMs - staMs) / 60_000);
      return actualArrDelay > 0 ? actualArrDelay : null;
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

  const toggleSelectFlight = useCallback((id: string) => {
    setSelectedFlightIds((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }, []);

  const enterSelectionModeWith = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedFlightIds((prev) => ({ ...prev, [id]: true }));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedFlightIds({});
  }, []);

  const selectAllVisible = useCallback(() => {
    const all: Record<string, boolean> = {};
    for (const f of displayFlights) all[f.id] = true;
    setSelectedFlightIds(all);
  }, [displayFlights]);

  const selectedCount = Object.keys(selectedFlightIds).length;

  const deleteSelectedFlights = useCallback(() => {
    if (!isCrew) return;
    const ids = Object.keys(selectedFlightIds);
    if (ids.length === 0) return;
    const selectionSnapshot = { ...selectedFlightIds };
    InteractionManager.runAfterInteractions(() => {
      Alert.alert(
        t('roster.deleteFlight'),
        t('roster.deleteSelectedConfirm', { count: ids.length }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              setFlightOpBusyMessage(t('common.flightOpDeletingFlights'));
              try {
                const failed: string[] = [];
                for (const id of ids) {
                  const err = await removeFlightForCrew(id);
                  if (err) failed.push(err);
                }
                if (failed.length > 0) {
                  Alert.alert(t('common.error'), failed[0]!);
                  return;
                }
                setFlights((prev) => prev.filter((f) => !selectionSnapshot[f.id]));
                exitSelectionMode();
              } finally {
                setFlightOpBusyMessage(null);
              }
            },
          },
        ],
        { cancelable: true }
      );
    });
  }, [isCrew, selectedFlightIds, t, removeFlightForCrew, exitSelectionMode]);

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

  const handleSendFlightsToFamily = useCallback(async () => {
    if (!isCrew || !crewProfile?.id) return;
    setSendingToFamily(true);
    const result = await notifyFamilyTodayFlights(crewProfile.id, selectedDate);
    setSendingToFamily(false);
    if (result.ok) {
      Alert.alert(
        t('roster.notifySent'),
        result.sent > 0 ? t('roster.notifySentMessage', { count: result.sent }) : t('roster.notifyNoDevices')
      );
    } else {
      Alert.alert(t('roster.notifyFailed'), result.error || t('roster.notifyFailedMessage'));
    }
  }, [isCrew, crewProfile?.id, selectedDate, t]);

  const handleClearAllFlights = useCallback(() => {
    if (!isCrew || !crewProfile?.id) return;
    Alert.alert(
      t('roster.clearAllTitle'),
      t('roster.clearAllMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('roster.clearAllConfirm'),
          style: 'destructive',
          onPress: async () => {
            if (!crewProfile?.id) {
              Alert.alert(t('common.error'), t('roster.clearAllError'));
              return;
            }
            setFlightOpBusyMessage(t('common.flightOpClearingFlights'));
            try {
              // Primary path: security-definer RPC.
              const { error: rpcErr } = await supabase.rpc('remove_me_from_all_flights');
              if (rpcErr) {
                // Fallback #1: remove only this crew's memberships (new schema table).
                const { error: relErr } = await supabase
                  .from('flight_crew')
                  .delete()
                  .eq('crew_id', crewProfile.id);
                if (relErr) {
                  // Fallback #2: legacy schema (no RPC, no flight_crew): delete only my own rows.
                  const { error: legacyErr } = await supabase
                    .from('flights')
                    .delete()
                    .eq('crew_id', crewProfile.id);
                  if (legacyErr) {
                    const rpcMsg = String(rpcErr.message || '').trim();
                    const relMsg = String(relErr.message || '').trim();
                    const legMsg = String(legacyErr.message || '').trim();
                    Alert.alert(
                      t('common.error'),
                      t('roster.flightsDeleteFailedDetail', { rpc: rpcMsg || '-', rel: relMsg || '-', leg: legMsg || '-' })
                    );
                    return;
                  }
                }
              }
              setFlights([]);
              Alert.alert('', t('roster.clearAllSuccess'), [{ text: t('common.ok') }]);
            } finally {
              setFlightOpBusyMessage(null);
            }
          },
        },
      ]
    );
  }, [isCrew, crewProfile?.id, t]);

  const dateRollerDates = React.useMemo(() => {
    const out: string[] = [];
    const back = getRosterMinDaysAgo(exemptLandedAutoPurge, isCrew);
    if (crewUtcView) {
      for (let d = -back; d <= ROSTER_MAX_DAYS_AHEAD; d++) {
        out.push(getUtcDateStringPlusDays(d));
      }
      return out;
    }
    if (familyRosterTz) {
      const base = getCalendarDateStringInTimeZone(new Date(), familyRosterTz);
      for (let d = -back; d <= ROSTER_MAX_DAYS_AHEAD; d++) {
        out.push(addCalendarDaysToYmd(base, d));
      }
      return out;
    }
    for (let d = -back; d <= ROSTER_MAX_DAYS_AHEAD; d++) {
      out.push(getLocalDateStringPlusDays(d));
    }
    return out;
  }, [todayStr, crewUtcView, familyRosterTz, exemptLandedAutoPurge, isCrew]);

  const listRef = useRef<FlatList>(null);

  /** Tarih seçilince listeyi o tarihe kaydır. */
  const scrollListToDate = useCallback(
    (dateStr: string) => {
      const idx = listData.findIndex((e) => listGroupDate(e.flight) === dateStr);
      if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
    },
    [listData, listGroupDate]
  );

  /** Scroll'da görünen ilk öğeye göre tarihi senkronize et. */
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: Array<{ item: ListEntry; key: string; index: number | null; isViewable: boolean }> }) => {
      const first = info.viewableItems[0]?.item;
      const date = first ? listGroupDate(first.flight) : null;
      if (!date) return;
      setSelectedDate(date);
      setCalendarMonth(date.slice(0, 7));
    },
    [listGroupDate]
  );

  /** Yeni eklenen uçuşun tarihine scroll (AddFlight sonrası). */
  React.useEffect(() => {
    const addedDate = route?.params?.addedFlightDate as string | undefined;
    if (!addedDate || !/^\d{4}-\d{2}-\d{2}$/.test(addedDate) || listData.length === 0) return;
    setSelectedDate(addedDate);
    setCalendarMonth(addedDate.slice(0, 7));
    const idx = listData.findIndex((e) => e.flight.flight_date === addedDate);
    if (idx === -1) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
      try { navigation.setParams({ addedFlightDate: undefined }); } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [listData, route.params?.addedFlightDate, navigation]);

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

  const onDateRollerChipPress = useCallback((dateStr: string) => {
    setSelectedDate(dateStr);
    setCalendarMonth(dateStr.slice(0, 7));
    scrollListToDate(dateStr);
  }, [scrollListToDate]);

  const layoverDateSet = useMemo(() => computeLayoverDates(flights), [flights]);

  const dayKindByDate = useMemo(() => {
    const map = new Map<string, CalendarDayKind>();
    // Liste filtresinden bağımsız: takvim renkleri tüm roster satırlarından.
    for (const f of flights) {
      const kind = (f.roster_entry_kind ?? 'flight').toLowerCase();
      if (kind === 'sim') continue;
      const ymd = listGroupDate(f);
      map.set(ymd, mergeCalendarDayKind(map.get(ymd), calendarDayKindForEntry(f)));
    }
    // Layover günlerini işaretle
    for (const ymd of layoverDateSet) {
      map.set(ymd, mergeCalendarDayKind(map.get(ymd), 'layover'));
    }
    const todayAnchor = crewUtcView ? getUtcDateString() : todayStr;
    for (const [ymd, kind] of Object.entries(persistedDayKinds)) {
      if (!kind || kind === 'empty') continue;
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
  }, [flights, listGroupDate, persistedDayKinds, todayStr, crewUtcView, layoverDateSet]);

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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCalendarExpanded((v) => !v);
  }, []);

  const calendarCells = useMemo(() => {
    const [yStr, mStr] = calendarMonth.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return [];
    const first = new Date(Date.UTC(y, m - 1, 1));
    // Monday-first grid
    const jsDow = first.getUTCDay(); // 0 Sun
    const mondayIndex = (jsDow + 6) % 7;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: Array<{ ymd: string | null; day: number | null }> = [];
    for (let i = 0; i < mondayIndex; i++) cells.push({ ymd: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${yStr}-${mStr}-${String(d).padStart(2, '0')}`;
      cells.push({ ymd, day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ ymd: null, day: null });
    return cells;
  }, [calendarMonth]);

  /** Collapsed: selectedDate'in haftası (Pzt–Paz). */
  const calendarWeekCells = useMemo(() => {
    const ymd = selectedDate;
    const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10));
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return [];
    const noon = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    const jsDow = noon.getUTCDay();
    const mondayOffset = (jsDow + 6) % 7;
    const monday = new Date(noon);
    monday.setUTCDate(noon.getUTCDate() - mondayOffset);
    const cells: Array<{ ymd: string; day: number }> = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(monday);
      dt.setUTCDate(monday.getUTCDate() + i);
      const yy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(dt.getUTCDate()).padStart(2, '0');
      cells.push({ ymd: `${yy}-${mm}-${dd}`, day: dt.getUTCDate() });
    }
    return cells;
  }, [selectedDate]);

  const calendarMonthLabel = useMemo(() => {
    const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
    const [yStr, mStr] = calendarMonth.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return calendarMonth;
    const d = new Date(Date.UTC(y, m - 1, 15));
    return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [calendarMonth, i18n.language]);

  const shiftCalendarMonth = (delta: number) => {
    const [yStr, mStr] = calendarMonth.split('-');
    let y = Number(yStr);
    let m = Number(mStr) + delta;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    setCalendarMonth(`${y}-${String(m).padStart(2, '0')}`);
    if (!calendarExpanded) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setCalendarExpanded(true);
    }
  };

  const getCalendarDayStyle = useCallback(
    (ymd: string, selected: boolean) => {
      const kind = dayKindByDate.get(ymd) ?? 'empty';
      if (kind === 'empty') {
        return {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF',
          borderColor: selected ? colors.primary : (isDark ? 'rgba(255,255,255,0.14)' : '#E5E7EB'),
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          textColor: selected ? colors.primary : cardInk.muted,
        };
      }
      // Görev/uçuş günleri: kırmızı; nöbet turuncu; izin yeşil.
      if (kind === 'layover') {
        return {
          backgroundColor: isDark ? '#3A2226' : '#FFEBEE',
          borderColor: selected ? colors.primary : (isDark ? '#E57373' : '#EF9A9A'),
          borderWidth: selected ? 2 : 1,
          textColor: selected ? colors.primary : cardInk.primary,
        };
      }
      if (kind === 'flight') {
        return {
          backgroundColor: isDark ? '#3A2226' : '#FFEBEE',
          borderColor: selected ? colors.primary : (isDark ? '#E57373' : '#EF9A9A'),
          borderWidth: selected ? 2 : 1,
          textColor: selected ? colors.primary : cardInk.primary,
        };
      }
      const visual: RosterCardVisualKind = kind === 'standby' ? 'standby' : 'duty_off';
      const chrome = rosterCardChrome(visual, themeMode);
      return {
        backgroundColor: chrome.backgroundColor,
        borderColor: selected ? colors.primary : chrome.borderColor,
        borderWidth: selected ? 2 : Math.max(chrome.borderWidth, 1),
        textColor: selected ? colors.primary : cardInk.primary,
      };
    },
    [dayKindByDate, isDark, themeMode, cardInk.primary, cardInk.muted]
  );

  const onFamilyCrewFilter = (id: string) => {
    familyCrewFilterIdRef.current = id;
    setFamilyCrewFilterId(id);
    void refreshFamilyListFromDb();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlightOperationOverlay
        visible={flightOpBusyMessage != null}
        message={flightOpBusyMessage ?? ''}
      />
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
            <TouchableOpacity
              onPress={() => shiftCalendarMonth(-1)}
              hitSlop={10}
              style={styles.inlineCalendarNavBtn}
              accessibilityLabel={t('roster.calendarPrevMonth')}
            >
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inlineCalendarTitleBtn}
              onPress={toggleCalendarExpanded}
              accessibilityLabel={calendarExpanded ? t('roster.calendarCollapse') : t('roster.calendarExpand')}
            >
              <Text style={[styles.inlineCalendarTitle, { color: colors.text }]} numberOfLines={1}>
                {calendarMonthLabel}
              </Text>
              <Ionicons
                name={calendarExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => shiftCalendarMonth(1)}
              hitSlop={10}
              style={styles.inlineCalendarNavBtn}
              accessibilityLabel={t('roster.calendarNextMonth')}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.calendarWeekRow}>
            {(i18n.language === 'tr'
              ? ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
              : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            ).map((d) => (
              <Text key={d} style={[styles.calendarWeekday, { color: colors.textMuted }]}>
                {d}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {(calendarExpanded ? calendarCells : calendarWeekCells).map((cell, idx, arr) => {
              if (!cell.ymd) {
                return <View key={`e-${idx}`} style={styles.calendarCell} />;
              }
              const inRange = dateRollerDates.includes(cell.ymd);
              const kind = dayKindByDate.get(cell.ymd) ?? 'empty';
              const sel = cell.ymd === selectedDate;
              const dayStyle = getCalendarDayStyle(cell.ymd, sel);
              const dimOutOfRange = !inRange && kind === 'empty';

              const isLayover = kind === 'layover';
              const prevYmd = idx > 0 ? arr[idx - 1]?.ymd : null;
              const nextYmd = idx < arr.length - 1 ? arr[idx + 1]?.ymd : null;
              const prevIsLayover = prevYmd ? (dayKindByDate.get(prevYmd) ?? 'empty') === 'layover' : false;
              const nextIsLayover = nextYmd ? (dayKindByDate.get(nextYmd) ?? 'empty') === 'layover' : false;
              const colIdx = idx % 7;
              const isRowStart = colIdx === 0;
              const isRowEnd = colIdx === 6;

              let borderRadiusStyle: any = {};
              if (isLayover) {
                const connectLeft = prevIsLayover && !isRowStart;
                const connectRight = nextIsLayover && !isRowEnd;
                borderRadiusStyle = {
                  borderTopLeftRadius: connectLeft ? 0 : 17,
                  borderBottomLeftRadius: connectLeft ? 0 : 17,
                  borderTopRightRadius: connectRight ? 0 : 17,
                  borderBottomRightRadius: connectRight ? 0 : 17,
                  marginLeft: connectLeft ? 0 : 2,
                  marginRight: connectRight ? 0 : 2,
                };
              }

              return (
                <TouchableOpacity
                  key={cell.ymd}
                  style={[
                    styles.calendarCell,
                    {
                      backgroundColor: dayStyle.backgroundColor,
                      borderColor: dayStyle.borderColor,
                      borderWidth: dayStyle.borderWidth,
                    },
                    dimOutOfRange && styles.calendarCellOutOfRange,
                    borderRadiusStyle,
                  ]}
                  disabled={!inRange && kind === 'empty'}
                  onPress={() => onDateRollerChipPress(cell.ymd!)}
                  accessibilityLabel={
                    kind === 'layover'
                      ? t('roster.dayLayover')
                      : kind === 'flight'
                        ? t('roster.dayHasFlights')
                        : kind === 'standby'
                          ? t('roster.dayStandby')
                          : kind === 'duty_off'
                            ? t('roster.dayOffDuty')
                            : t('roster.dayEmpty')
                  }
                >
                  <Text style={{ color: dayStyle.textColor, fontWeight: sel ? '800' : '700', fontSize: 12 }}>
                    {cell.day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        </>
      )}

      <View style={styles.rosterContentWrap}>
        {cleanupMessage ? (
          <View style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.primary + '20', marginHorizontal: 16, marginBottom: 8, borderRadius: 8 }}>
            <Text style={{ color: colors.primary, fontSize: Math.round(14 * fontScale) }}>{cleanupMessage}</Text>
          </View>
        ) : null}

        {!isCrew && !subscriptionAccessLoading && subscriptionAccess && !subscriptionAccess.has_access ? (
          <View style={{ marginHorizontal: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.text, fontSize: Math.round(18 * fontScale), fontWeight: '700', marginBottom: 6 }}>
              {t('paywall.title')}
            </Text>
            <Text style={{ color: colors.textSecondary, lineHeight: 20, marginBottom: 8 }}>
              {t('paywall.familyBlockedMessage')}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: Math.round(13 * fontScale), marginBottom: 3 }}>
              {t('paywall.plan')}: {subscriptionAccess.plan_title ?? '-'}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: Math.round(13 * fontScale), marginBottom: 12 }}>
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
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            {flights.length > 0 && displayFlights.length === 0
              ? t('roster.allRosterRowsHidden')
              : isCrew
                ? t('roster.noFlightsCrew')
                : t('roster.noFlightsFamily')}
          </Text>
        ) : (
          <View style={styles.listAndClearContainer}>
          <FlatList
            ref={listRef}
            data={listData}
            extraData={themeMode}
            keyExtractor={(item, index) => `${item.flight.id}-${index}`}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            scrollIndicatorInsets={{ right: 0 }}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onScrollToIndexFailed={() => {}}
            refreshControl={
              <RefreshControl
                refreshing={refreshingList || (isCrew && updatingTimes)}
                onRefresh={handlePullToRefresh}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item: entry }) => {
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
            const statusBox = statusConfig[displayStatus];
            const depCity = formatCityAndCode(item.origin_airport, item.origin_city);
            const arrCity = formatCityAndCode(item.destination_airport, item.destination_city);
            const blockCode = (item.flight_number || '').trim().toUpperCase();
            const isSimBlock = item.roster_entry_kind === 'sim' || isSimulatorOccupationCode(blockCode);
            const isOffDayDutyCode = isOffDayOccupationCode(blockCode);
            const isAnnualLeaveCode = isAnnualLeaveOccupationCode(blockCode);
            const isGroundDutyCode = isGroundDutyOccupationCode(blockCode);
            const isOfficeDutyCode = isOfficeDutyOccupationCode(blockCode);
            /** Yer dersi/ofis: gri görev kutusu (uçuş chrome); yeşil off değil. */
            const isDutyOffBlock =
              !isSimBlock &&
              !isGroundDutyCode &&
              (item.roster_entry_kind === 'duty_off' || isOffDayDutyCode);
            const isGroundDutyBlock = !isSimBlock && isGroundDutyCode;
            const isNonFlightBlock = isDutyOffBlock || isSimBlock || isGroundDutyBlock;
            const nonFlightStatus = isNonFlightBlock ? getNonFlightBlockStatus(item) : null;
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
            const showNextDayHint = nextDayHintById[item.id] === true;
            const statusLabelText =
              (displayStatus === 'en_route' || displayStatus === 'departed' || displayStatus === 'landed' || displayStatus === 'taxi_out' || displayStatus === 'scheduled' || displayStatus === 'diverted' || displayStatus === 'cancelled') ? null
                  : statusBox.label;
            const statusWithCenterIcon =
              displayStatus === 'en_route' || displayStatus === 'departed' || displayStatus === 'landed'
              || displayStatus === 'taxi_out' || displayStatus === 'scheduled' || displayStatus === 'diverted' || displayStatus === 'cancelled';
            const statusIsError = displayStatus === 'cancelled';
            const statusCenterIcon =
              displayStatus === 'landed' ? '✅'
              : (displayStatus === 'en_route' || displayStatus === 'departed') ? '⏰'
              : null;
            const aircraftRegDisplay = !isNonFlightBlock
              ? formatAircraftRegistration(aircraftRegById[item.id] ?? item.aircraft_registration)
              : null;
            const aircraftRegBelowStatus = aircraftRegDisplay ? (
              <Pressable
                onPress={() => openFlightradar24ByRegistration(aircraftRegDisplay)}
                hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                accessibilityRole="link"
                accessibilityLabel={t('roster.trackAircraftFr24A11y', { reg: aircraftRegDisplay })}
                style={styles.aircraftRegBelowStatusWrap}
              >
                <Text style={[styles.aircraftRegText, { color: cardInk.onAccent }]}>
                  ({aircraftRegDisplay})
                </Text>
              </Pressable>
            ) : null;
            const delayMins = getDelayMinutes(item);
            const calendarDelayColor = getDelayCalendarColor(delayMins);
            const isSelected = !!selectedFlightIds[item.id];
            const cardInner = (
              <View style={styles.cardRow}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    if (isCrew && selectionMode) {
                      toggleSelectFlight(item.id);
                      return;
                    }
                    if (isCrew) {
                      if (showAdminFr24Debug && !isNonFlightBlock) {
                        navigation.navigate('AdminFlightApiDebug', { flightId: item.id });
                      } else {
                        navigation.navigate('EditFlight', { flightId: item.id });
                      }
                    } else if (!isNonFlightBlock) {
                      navigation.navigate('EditFlight', { flightId: item.id, readOnly: true });
                    }
                  }}
                  onLongPress={() => {
                    if (isCrew) enterSelectionModeWith(item.id);
                  }}
                  style={styles.cardMain}
                >
                  <View style={styles.cardMainWrap}>
                    {!isNonFlightBlock &&
                      (() => {
                        const phase = computeApiRefreshPhase(flightPhaseComputeArgs(item, nowMs));
                        return phase ? (
                          <View
                            style={[styles.phaseDot, { backgroundColor: apiRefreshPhaseDotColor(phase, isDark) }]}
                            accessibilityLabel={t(`roster.phase.${phase}`)}
                          />
                        ) : null;
                      })()}
                    <View style={!isNonFlightBlock ? styles.cardMainBodyWithPhaseDot : undefined}>
                      <View style={styles.cardMainTop}>
                        <View
                          style={[
                            styles.dateRowNumber,
                            !selectionMode && isNonFlightBlock && styles.dateRowNumberNonFlight,
                            selectionMode && styles.dateRowNumberSelection,
                            selectionMode && isSelected && styles.dateRowNumberSelectionActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dateRowNumberText,
                              !selectionMode && isNonFlightBlock && styles.dateRowNumberTextNonFlight,
                            ]}
                          >
                            {selectionMode
                              ? (isSelected ? '✓' : '')
                              : isDutyOffBlock
                                ? ''
                                : isSimBlock
                                  ? ''
                                  : flightIndex}
                          </Text>
                        </View>
                        <Text style={[styles.date, { color: cardInk.secondary }]}>
                          {formatRosterDayLabel(listGroupDate(item))}
                        </Text>
                      </View>
                      {!isCrew && <View />}
                      {isNonFlightBlock ? (
                        <Text style={[styles.route, { color: cardInk.primary }]}>
                          <>
                            <Text style={styles.routeLabel}>
                              {isSimBlock ? t('roster.simulatorBlockType') : t('roster.offDutyType')}{' '}
                            </Text>
                            <Text style={[styles.flightNumber, { color: cardInk.primary }]}>{blockTitle}</Text>
                          </>
                        </Text>
                      ) : (
                        <View>
                          <Text style={[styles.route, { color: cardInk.primary }]}>
                            <Text style={styles.routeLabel}>{t('roster.flightNo')} </Text>
                            <Text style={[styles.flightNumber, { color: cardInk.primary }]}>{item.flight_number}</Text>
                            {delayMins != null ? (
                              <Text style={[styles.delayText, { color: cardInk.error }]}> ({formatDelayCompact(delayMins)})</Text>
                            ) : null}
                          </Text>
                          {indigoTrainingLine ? (
                            <Text
                              style={[styles.indigoRosterDetailLine, { color: cardInk.muted }]}
                              numberOfLines={3}
                            >
                              {indigoTrainingLine}
                            </Text>
                          ) : null}
                          {item.diverted_to && displayStatus !== 'cancelled' && displayStatus !== 'landed' ? (
                            <Text style={[styles.divertSubline, { color: cardInk.error }]}>
                              {t('roster.divertExtra', { place: formatDivertDestination(item.diverted_to) })}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </View>
                    <View style={styles.cardMainBottom}>
                      {isNonFlightBlock ? (
                        <>
                          <Text style={[styles.depArrLine, { color: cardInk.primary }]} numberOfLines={1} ellipsizeMode="tail">
                            <Text style={styles.depArrPrefix}>{t('roster.dutyPeriodStart')} </Text>
                            <Text style={[styles.depArrTimes, { color: cardInk.muted }]}>
                              {crewUtcView ? (
                                <>{formatTimeUTC(item.scheduled_departure)} (Z)</>
                              ) : (
                                <>
                                  {formatTimeRosterPdfLocal(item.scheduled_departure)} ({rosterPdfLocalTzTag}) /{' '}
                                  {formatTimeUTC(item.scheduled_departure)} (Z)
                                </>
                              )}
                            </Text>
                          </Text>
                          <Text style={[styles.depArrLine, { color: cardInk.primary }]} numberOfLines={1} ellipsizeMode="tail">
                            <Text style={styles.depArrPrefix}>{t('roster.dutyPeriodEnd')} </Text>
                            <Text style={[styles.depArrTimes, { color: cardInk.muted }]}>
                              {crewUtcView ? (
                                <>{formatTimeUTC(item.scheduled_arrival)} (Z)</>
                              ) : (
                                <>
                                  {formatTimeRosterPdfLocal(item.scheduled_arrival)} ({rosterPdfLocalTzTag}) /{' '}
                                  {formatTimeUTC(item.scheduled_arrival)} (Z)
                                </>
                              )}
                            </Text>
                          </Text>
                        </>
                      ) : (
                        <>
                          {/* Roster kartı: STD/STA gösterim; çubuk başlangıç ETD (yoksa ATD), bitiş ETA. */}
                          <Text
                            style={[styles.depArrLine, { color: cardInk.primary }]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            <Text style={styles.depArrPrefix}>{t('roster.dep')} </Text>
                            {depCity}
                            <Text style={[styles.depArrTimes, { color: cardInk.muted }]}>
                              {' '}
                              –{' '}
                              {crewUtcView ? (
                                <>{formatTimeUTC(item.scheduled_departure)} (Z)</>
                              ) : isCrew ? (
                                <>
                                  {`${formatTimeCrewAtOrigin(item.scheduled_departure, item.origin_airport)} (${crewStationTag(item.origin_airport)})`}{' '}
                                  / {formatTimeUTC(item.scheduled_departure)} (Z)
                                </>
                              ) : (
                                <>
                                  {formatTimeFamilyLocal(item.scheduled_departure)} ({familyRegionTag}) /{' '}
                                  {formatTimeUTC(item.scheduled_departure)} (Z)
                                </>
                              )}
                            </Text>
                          </Text>
                          <Text
                            style={[styles.depArrLine, { color: cardInk.primary }]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            <Text style={styles.depArrPrefix}>{t('roster.arr')} </Text>
                            {arrCity}
                            <Text style={[styles.depArrTimes, { color: cardInk.muted }]}>
                              {' '}
                              –{' '}
                              {crewUtcView ? (
                                <>{formatTimeUTC(item.scheduled_arrival)} (Z)</>
                              ) : isCrew ? (
                                <>
                                  {`${formatTimeCrewAtDest(item.scheduled_arrival, item.destination_airport)} (${crewStationTag(item.destination_airport)})`}{' '}
                                  / {formatTimeUTC(item.scheduled_arrival)} (Z)
                                </>
                              ) : (
                                <>
                                  {formatTimeFamilyLocal(item.scheduled_arrival)} ({familyRegionTag}) /{' '}
                                  {formatTimeUTC(item.scheduled_arrival)} (Z)
                                </>
                              )}
                            </Text>
                          </Text>
                          {(() => {
                            const p = getFlightProgress(item);
                            if (p == null) return null;
                            const leftPct = `${Math.round(p * 1000) / 10}%`;
                            const pctText = formatProgressPercent(p);
                            return (
                              <View style={styles.progressWrap}>
                                <View style={styles.progressBar}>
                                  <View style={[styles.progressFill, { width: leftPct }]}>
                                    <LinearGradient
                                      colors={
                                        themeMode === 'dark'
                                          ? ['#3D5468', '#2C5070', '#1E3648']
                                          : ['#93C5FD', '#3B82F6', '#1D4ED8']
                                      }
                                      start={{ x: 0, y: 0 }}
                                      end={{ x: 1, y: 0 }}
                                      style={StyleSheet.absoluteFill}
                                    />
                                  </View>
                                  <View style={[styles.planeWrap, { left: leftPct }]}>
                                    <Ionicons name="airplane" size={24} color={colors.secondary} />
                                  </View>
                                </View>
                                <Text style={[styles.progressPct, { color: cardInk.primary }]}>{pctText}</Text>
                              </View>
                            );
                          })()}
                          {showNextDayHint && (
                            <Text style={[styles.nextDayHint, { color: cardInk.muted }]} accessibilityLabel={t('roster.nextDayTimesA11y')}>
                              <Text style={styles.nextDayHintText}>{t('roster.nextDay')}</Text>
                            </Text>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={[styles.sideDivider, { backgroundColor: colors.border }]} />
                <TouchableOpacity
                  style={styles.statusBox}
                  activeOpacity={isNonFlightBlock ? 1 : 0.8}
                  disabled={isNonFlightBlock}
                  onPress={
                    isNonFlightBlock
                      ? undefined
                      : () => openFlightradar24(item.flight_number, item.flight_date, fr24IdByFlightId[item.id])
                  }
                  accessibilityLabel={
                    isSimBlock
                      ? t('roster.simulatorBlockA11y')
                      : isDutyOffBlock
                        ? t('roster.offDutyBlockA11y')
                        : t('roster.trackFr24A11y')
                  }
                >
                  <View style={styles.statusBoxInner}>
                    <View style={styles.statusContentCenter}>
                      {isNonFlightBlock ? (
                        <>
                          <View style={styles.statusTopCluster}>
                            <Text style={[styles.statusLabel, styles.statusLabelScheduled, { color: cardInk.primary }]}>
                              {nonFlightStatusLabel(nonFlightStatus ?? 'planned')}
                            </Text>
                          </View>
                          <View style={styles.statusIconArea}>
                            <View style={styles.statusClockCenter}>
                              <Ionicons
                                name={
                                  nonFlightStatus === 'ongoing'
                                    ? 'time-outline'
                                    : nonFlightStatus === 'finished'
                                      ? 'checkmark-circle-outline'
                                      : 'calendar-outline'
                                }
                                size={32}
                                color={nonFlightStatus === 'finished' ? cardInk.success : cardInk.primary}
                              />
                            </View>
                          </View>
                        </>
                      ) : statusWithCenterIcon ? (
                        <>
                          <View style={styles.statusTopCluster}>
                            <Text
                              style={[
                                styles.statusLabel,
                                displayStatus === 'scheduled' && styles.statusLabelScheduled,
                                { color: statusIsError ? cardInk.error : displayStatus === 'landed' ? cardInk.success : cardInk.primary },
                              ]}
                            >
                              {statusBox.label}
                              {displayStatus === 'landed' && item.diverted_to ? (
                                <Text style={{ color: cardInk.error }}>
                                  {' ('}
                                  {formatDivertDestination(item.diverted_to)}
                                  {')'}
                                </Text>
                              ) : null}
                            </Text>
                            {aircraftRegBelowStatus}
                          </View>
                          <View style={styles.statusIconArea}>
                            <View style={styles.statusClockCenter}>
                              {displayStatus === 'taxi_out' ? (
                                <Ionicons name="radio-outline" size={32} color={cardInk.primary} />
                              ) : displayStatus === 'scheduled' ? (
                                <Ionicons name="calendar-outline" size={32} color={calendarDelayColor ?? cardInk.primary} />
                              ) : displayStatus === 'cancelled' ? (
                                <Ionicons name="close-circle-outline" size={32} color={cardInk.error} />
                              ) : (
                                <Text style={styles.statusClockIcon}>{statusCenterIcon}</Text>
                              )}
                            </View>
                          </View>
                        </>
                      ) : (
                        <View style={styles.statusTopCluster}>
                          <Text style={[styles.statusLabel, { color: cardInk.primary }]}>
                            {statusLabelText}
                          </Text>
                          {aircraftRegBelowStatus}
                        </View>
                      )}
                    </View>
                    {!isNonFlightBlock ? (
                      <View style={styles.trackInStatusRow}>
                        <Ionicons name="location-outline" size={12} color={cardInk.onAccent} />
                        <Text style={[styles.trackInStatusText, { color: cardInk.onAccent }]}>{t('roster.trackOnFr24')}</Text>
                      </View>
                    ) : isStandbyBlock && isCrew ? (
                      <Pressable
                        style={styles.trackInStatusRow}
                        onPress={() => openAssignFlightsFromStandby(item)}
                        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('roster.assignFlightsA11y')}
                      >
                        <Text style={[styles.assignFlightsLinkText, { color: cardInk.error }]}>
                          {t('roster.assignFlights')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </TouchableOpacity>
              </View>
            );
            const cardContent = selectionMode
              ? (
                <View
                  style={[
                    styles.card,
                    isDutyOffBlock && !isStandbyDutyCode && styles.cardOffDuty,
                    isDutyOffBlock && isStandbyDutyCode && styles.cardStandby,
                    (displayStatus === 'en_route' || displayStatus === 'departed') && styles.cardInFlight,
                    displayStatus === 'landed' && styles.cardLanded,
                    isSelected && [styles.cardSelected, { borderColor: colors.primary }],
                  ]}
                >
                  {cardInner}
                </View>
              )
              : (
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
                    style={[
                      styles.card,
                      isDutyOffBlock && !isStandbyDutyCode && styles.cardOffDuty,
                      isDutyOffBlock && isStandbyDutyCode && styles.cardStandby,
                      (displayStatus === 'en_route' || displayStatus === 'departed') && styles.cardInFlight,
                      displayStatus === 'landed' && styles.cardLanded,
                    ]}
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
                style={[
                  styles.itemWrapper,
                  entry.gapBefore === 'tight'
                    ? styles.itemWrapperTightGroup
                    : entry.gapBefore === 'normal'
                      ? styles.itemWrapperNormalGroup
                      : null,
                ]}
              >
                <View style={styles.dayRailRow}>
                  <View
                    style={[
                      styles.dayRail,
                      entry.isFirstInDay ? styles.dayRailFirst : null,
                      entry.isLastInDay ? styles.dayRailLast : null,
                      !entry.isFirstInDay && {
                        marginTop: entry.gapBefore === 'normal' ? -10 : entry.gapBefore === 'tight' ? -2 : 0,
                      },
                      !entry.isLastInDay && { marginBottom: -6 },
                      {
                        backgroundColor:
                          entry.dayGroupIndex % 2 === 0
                            ? isDark
                              ? colors.border
                              : '#AEB7C2'
                            : isDark
                              ? colors.textMuted
                              : '#D3D8DF',
                      },
                    ]}
                  />
                  <View style={styles.dayRailCardWrap}>{cardContent}</View>
                </View>
              </View>
            );
          }}
          />
        </View>
        )}
      </View>

      {isCrew && (
        <View style={styles.rosterActionsRow}>
          {selectionMode ? (
            <>
              <TouchableOpacity style={styles.rosterActionButton} onPress={selectAllVisible}>
              <View style={styles.rosterActionButtonContent}>
                  <Ionicons name="checkmark-done-outline" size={15} color={colors.onPrimary} />
                  <Text style={styles.rosterActionButtonText}>{t('roster.selectAllVisible')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rosterActionButton, styles.rosterActionButtonCenter]}
                onPress={exitSelectionMode}
              >
                <View style={styles.rosterActionButtonContent}>
                  <Ionicons name="close-circle-outline" size={15} color={colors.onPrimary} />
                  <Text style={styles.rosterActionButtonText}>{t('roster.cancelSelectionCount', { count: selectedCount })}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rosterActionButton, styles.rosterActionButtonDanger]}
                onPress={deleteSelectedFlights}
                accessibilityLabel={t('roster.removeSelectedCount', { count: selectedCount })}
              >
                <View style={styles.rosterActionButtonContent}>
                  <Ionicons name="trash-outline" size={15} color={colors.white} />
                  <Text style={styles.rosterActionButtonText}>{t('roster.removeSelected')}</Text>
                </View>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={styles.rosterActionButton}
                onPress={() => navigation.navigate('AddFlight')}
                accessibilityLabel={t('roster.addFlight')}
              >
                <View style={styles.rosterActionButtonContent}>
                  <Ionicons name="add-circle-outline" size={14} color={colors.onPrimary} />
                  <Text
                    style={styles.rosterActionButtonText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {t('roster.addFlight')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rosterActionButton, styles.rosterActionButtonCenter]}
                onPress={() => setSelectionMode(true)}
              >
                <View style={styles.rosterActionButtonContent}>
                  <Ionicons name="checkbox-outline" size={14} color={colors.onPrimary} />
                  <Text
                    style={styles.rosterActionButtonText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                  >
                    {t('roster.selectFlights')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rosterActionButton, sendingToFamily && styles.sendToFamilyButtonDisabled]}
                onPress={handleSendFlightsToFamily}
                disabled={sendingToFamily}
              >
                {sendingToFamily ? (
                  <View style={styles.rosterActionButtonContent}>
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  </View>
                ) : (
                  <View style={styles.rosterActionButtonContent}>
                    <Ionicons name="paper-plane-outline" size={14} color={colors.onPrimary} />
                    <Text
                      style={styles.rosterActionButtonText}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.78}
                    >
                      {t('roster.sendToFamily')}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
      <RosterListTasksModal
        visible={rosterTasksModalVisible}
        onClose={() => setRosterTasksModalVisible(false)}
        mode={isCrew ? 'crew' : 'family'}
        crewProfileId={crewProfile?.id ?? null}
        profileUserId={profile?.id ?? null}
        prefsSeed={rosterListPrefs}
        refreshProfile={refreshProfile}
        onAfterSave={reloadFamilyRosterPrefs}
      />
    </View>
  );
}

function createRosterStyles(fs: (n: number) => number, themeMode: 'light' | 'dark') {
  const cardTok = rosterCardStyleTokens(themeMode);
  const ink = rosterCardInk(themeMode);
  const onPrimary = colors.onPrimary;
  return StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 0 },
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
    marginBottom: 4,
    marginHorizontal: -8,
    paddingHorizontal: 4,
    paddingTop: 0,
    paddingBottom: 0,
  },
  inlineCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  inlineCalendarNavBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineCalendarTitleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  inlineCalendarTitle: {
    fontSize: fs(15),
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  crewFilterScroll: { marginBottom: 8, maxHeight: 40 },
  crewFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  crewFilterLabel: { fontSize: 12, fontWeight: '700', marginRight: 2 },
  crewFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 140,
  },
  crewFilterChipSelected: {},
  calendarWeekRow: { flexDirection: 'row', marginBottom: 2 },
  calendarWeekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: {
    width: '14.2857%',
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    marginBottom: 2,
  },
  calendarCellOutOfRange: {
    opacity: 0.32,
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
  rosterContentWrap: { flex: 1 },
  rosterActionsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 6,
    paddingBottom: 2,
  },
  rosterActionButton: {
    flex: 1,
    height: 40,
    backgroundColor: colors.primary,
    paddingVertical: 0,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  rosterActionButtonCenter: {},
  rosterActionButtonDanger: {
    backgroundColor: colors.error,
    borderWidth: 1,
    borderColor: '#7A0000',
  },
  rosterActionButtonContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 2,
  },
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
  sendToFamilyButtonDisabled: { opacity: 0.6 },
  listAndClearContainer: { flex: 1 },
  listFlex: { flex: 1 },
  list: { paddingBottom: 20, paddingRight: 10 },
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
  itemWrapper: { marginBottom: 6 },
  itemWrapperTightGroup: { marginTop: 2 },
  itemWrapperNormalGroup: { marginTop: 10 },
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
});
}
