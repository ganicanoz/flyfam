import React, { useState, useCallback, useLayoutEffect, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Swipeable } from 'react-native-gesture-handler';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { formatFlightDateTr, formatFlightTimeLocal, formatFlightTimeUTC, getLocalDateString, getLocalDateStringPlusDays, parseFlightTimeAsUtc } from '../lib/dateUtils';
import { fetchFlightByNumber, getFr24DeepLink } from '../lib/flightApi';
import { notifyFamilyTodayFlights } from '../lib/notifyFamily';
import { formatCityAndCode, getAirportDisplay } from '../constants/airports';
import { colors } from '../theme/colors';

const LANDED_DELETE_AFTER_MS = 10 * 60 * 60 * 1000; // Hide landed flights 10 hrs after scheduled arrival (AE timetable)

function parseUtcMsStatic(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return 0;
  let s = iso.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return 0;
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) s = s.replace(/\.\d+$/, '') + (s.includes('.') ? 'Z' : '.000Z');
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function isMissingColumn(errMsg: string | undefined | null, column: string): boolean {
  if (!errMsg) return false;
  const m = String(errMsg).toLowerCase();
  const c = String(column).toLowerCase();
  // Supabase/PostgREST error messages vary:
  // - "Could not find the 'schedule_unconfirmed' column"
  // - "column flights.schedule_unconfirmed does not exist"
  return m.includes(c) && (m.includes('could not find') || m.includes('does not exist'));
}

/** Hide flights 10+ hours after landing (no DB deletes). Uses flight_status landed/parked OR actual_arrival so flights are hidden even if status was never updated. */
async function removeFlightsLandedOver6hAgo<
  T extends { id: string; scheduled_arrival: string | null; actual_arrival?: string | null; flight_status?: string | null; flight_date?: string | null }
>(list: T[]): Promise<T[]> {
  const now = Date.now();
  const todayLocal = getLocalDateString();
  const toHide = list.filter((f) => {
    const fd = f.flight_date;
    if (fd && String(fd).slice(0, 10) >= todayLocal) return false;
    const status = (f.flight_status ?? '').toLowerCase();
    const isLandedByStatus = status === 'landed' || status === 'parked';
    const arrMsSched = parseUtcMsStatic(f.scheduled_arrival);
    const arrMsActual = parseUtcMsStatic(f.actual_arrival);
    const landingMs = arrMsActual > 0 ? arrMsActual : arrMsSched;
    if (landingMs <= 0) return false;
    if (now - landingMs < LANDED_DELETE_AFTER_MS) return false;
    if (isLandedByStatus) return true;
    if (arrMsActual > 0) return true;
    return false;
  });
  return list.filter((f) => !toHide.includes(f));
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
  is_diverted?: boolean | null;
  flight_status?: string | null;
  schedule_unconfirmed?: boolean | null;
  schedule_source_hint?: string | null;
  diverted_to?: string | null;
  crew_profiles?: { company_name: string | null } | { company_name: string | null }[] | null;
};

export default function Roster() {
  const { t } = useTranslation();
  const { profile, crewProfile } = useSession();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [liveMetricsById, setLiveMetricsById] = useState<Record<string, { gs?: number; altFt?: number; atUtc?: string }>>({});
  const [airborneSeenById, setAirborneSeenById] = useState<Record<string, boolean>>({});
  const [nextDayHintById, setNextDayHintById] = useState<Record<string, boolean>>({});
  const [scheduleSourceHintById, setScheduleSourceHintById] = useState<Record<string, 'fr24_first_last_seen'>>({});
  const [fr24IdByFlightId, setFr24IdByFlightId] = useState<Record<string, string>>({});
  const airborneSeenRef = useRef<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [updatingTimes, setUpdatingTimes] = useState(false);
  const [refreshingList, setRefreshingList] = useState(false);
  const [sendingToFamily, setSendingToFamily] = useState(false);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isCrew = profile?.role === 'crew';
  const flightsRef = useRef<Flight[]>([]);
  flightsRef.current = flights;
  const lastAutoRefreshMsRef = useRef<number>(0);
  const lastDashRefreshMsRef = useRef<number>(0);
  const autoRefreshInFlightRef = useRef<boolean>(false);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const [updatingFlightIds, setUpdatingFlightIds] = useState<Record<string, boolean>>({});

  const DASH_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour for flights with no times (dash)
  const getDashFlights = useCallback((list: Flight[]) => {
    return list.filter(
      (f) => !(f.scheduled_departure ?? '').trim() && !(f.scheduled_arrival ?? '').trim()
    );
  }, []);

  const getAutoRefreshList = useCallback((list: Flight[]) => {
    const now = Date.now();
    const todayLocal = getLocalDateString();
    const yesterdayLocal = getLocalDateStringPlusDays(-1);
    const maxAheadMs = 12 * 60 * 60 * 1000; // next 12 hours only (reduce API cost)
    return list.filter((f) => {
      if (f.flight_date < yesterdayLocal) return false;
      // Dash (saat yok): dün veya bugün olsun API'den doldurmak için listeye al.
      const isDash = !(f.scheduled_departure ?? '').trim() && !(f.scheduled_arrival ?? '').trim();
      if (isDash && (f.flight_date === todayLocal || f.flight_date === yesterdayLocal)) return true;
      if (f.flight_date < todayLocal) return false;
      // Always keep live flights updated.
      if (f.flight_status === 'en_route' || f.flight_status === 'departed' || f.flight_status === 'taxi_out') return true;
      if (f.actual_departure && !f.actual_arrival) return true;
      // If flight looks en_route by times, keep it updated (even if flight_status isn't set).
      const depMs = parseUtcMsStatic(f.actual_departure ?? f.scheduled_departure);
      const arrMs = parseUtcMsStatic(f.actual_arrival ?? f.scheduled_arrival);
      const looksEnRouteByTimes = depMs > 0 && depMs <= now && (arrMs === 0 || now < arrMs + 2 * 60 * 60 * 1000) && !f.actual_arrival;
      if (looksEnRouteByTimes) return true;
      // Only upcoming departures in the next 12 hours.
      if (depMs > 0) return depMs > now && depMs - now <= maxAheadMs;
      // If we don't have a departure time yet, we still allow today's flights to refresh.
      return f.flight_date === todayLocal;
    });
  }, []);

  // Always sort by departure time (user's local order: earliest first). Do not change sort order.
  const sortByDepartureAsc = useCallback((a: Flight, b: Flight) => {
    const aMs = parseUtcMsStatic(a.actual_departure ?? a.scheduled_departure);
    const bMs = parseUtcMsStatic(b.actual_departure ?? b.scheduled_departure);
    const aHas = aMs > 0;
    const bHas = bMs > 0;
    if (aHas && bHas) return aMs - bMs;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (a.flight_date !== b.flight_date) return a.flight_date.localeCompare(b.flight_date);
    return a.flight_number.localeCompare(b.flight_number);
  }, []);

  const flightsSorted = React.useMemo(() => {
    const copy = [...flights];
    copy.sort(sortByDepartureAsc);
    return copy;
  }, [flights, sortByDepartureAsc]);

  const refreshTimesFromApi = useCallback(async (silent = false, listOverride?: Flight[]) => {
    if (!isCrew || !crewProfile?.id) return;
    const list = listOverride ?? flightsRef.current;
    if (list.length === 0) return;
    if (!silent) setUpdatingTimes(true);
    const isoDayPlusDays = (isoDay: string, delta: number) => {
      const [yy, mm, dd] = isoDay.split('-').map(Number);
      const dt = new Date(Date.UTC(yy, (mm ?? 1) - 1, dd ?? 1, 0, 0, 0));
      dt.setUTCDate(dt.getUTCDate() + delta);
      return dt.toISOString().slice(0, 10);
    };
    const localUnconfirmedById: Record<string, boolean> = {};

    const processFlight = async (flight: Flight) => {
      const info = await fetchFlightByNumber(flight.flight_number, flight.flight_date);
      const debugKey = flight.flight_number.toUpperCase();
      if (debugKey === 'PC2289') {
        console.log('\n========== PC2289 DEBUG START ==========');
        console.log('[PC2289] fetchFlightByNumber result:', JSON.stringify({
          date: flight.flight_date,
          origin: info?.origin,
          destination: info?.destination,
          schedDep: info?.scheduled_departure_utc,
          schedArr: info?.scheduled_arrival_utc,
          actDep: info?.actual_departure_utc,
          actArr: info?.actual_arrival_utc,
          status: info?.flightStatus,
          gsKts: info?.groundSpeedKts,
          altFt: info?.altitudeFt,
          lastTrackUtc: info?.lastTrackUtc,
          fr24Id: info?.fr24Id,
        }, null, 2));
      }
      if (debugKey === 'PC978' || debugKey === 'PC615' || debugKey === 'PC1915' || debugKey === 'PC1134' || debugKey === 'PC2088' || debugKey === 'PC2199' || debugKey === 'PC2289' || debugKey === 'PC2550' || debugKey === 'PC656' || debugKey === 'PC2533') {
        if (debugKey !== 'PC2289') {
          console.log(`[Debug ${debugKey}] fetchFlightByNumber result:`, {
            date: flight.flight_date,
            origin: info?.origin,
            destination: info?.destination,
            schedDep: info?.scheduled_departure_utc,
            schedArr: info?.scheduled_arrival_utc,
            actDep: info?.actual_departure_utc,
            actArr: info?.actual_arrival_utc,
            status: info?.flightStatus,
            gsKts: info?.groundSpeedKts,
            altFt: info?.altitudeFt,
            lastTrackUtc: info?.lastTrackUtc,
            fr24Id: info?.fr24Id,
          });
        }
      }
      // If API didn't provide anything, or didn't provide scheduled times, try previous day's scheduled as placeholder.
      const needsScheduleFallback =
        !info ||
        (info.scheduled_departure_utc == null && info.scheduled_arrival_utc == null);

      let effectiveInfo = info;
      if (needsScheduleFallback) {
        const prevDate = isoDayPlusDays(flight.flight_date, -1);
        const { data: prev } = await supabase
          .from('flights')
          .select('scheduled_departure, scheduled_arrival')
          .eq('crew_id', crewProfile.id)
          .eq('flight_number', flight.flight_number)
          .eq('flight_date', prevDate)
          .limit(1)
          .maybeSingle();
        if (prev?.scheduled_departure || prev?.scheduled_arrival) {
          effectiveInfo = effectiveInfo ?? ({ origin: '', destination: '', depTime: '', arrTime: '' } as any);
          (effectiveInfo as any).scheduled_departure_utc = prev.scheduled_departure;
          (effectiveInfo as any).scheduled_arrival_utc = prev.scheduled_arrival;
          (effectiveInfo as any).scheduleUnconfirmed = true;
          if (debugKey === 'PC615') console.log('[Debug PC615] DB fallback prev-day schedule used', { prevDate });
        }
      }

      // Skip this flight when API and fallback both returned nothing (cannot use continue — not in a loop).
      if (!effectiveInfo) {
        if (debugKey === 'PC2088' || debugKey === 'PC2199' || debugKey === 'PC2533') {
          console.log(`[${debugKey}] Skipped: no effectiveInfo (API returned null or empty)`);
        }
        return;
      }
      if (debugKey === 'PC2088' || debugKey === 'PC2199' || debugKey === 'PC2533') {
        console.log(`[${debugKey}] effectiveInfo.flightStatus =`, effectiveInfo.flightStatus, 'schedDep =', effectiveInfo.scheduled_departure_utc, 'schedArr =', effectiveInfo.scheduled_arrival_utc, 'actual_arrival_utc =', effectiveInfo.actual_arrival_utc);
      }
      if (effectiveInfo.fr24Id?.trim()) {
        setFr24IdByFlightId((prev) => (prev[flight.id] === effectiveInfo!.fr24Id!.trim() ? prev : { ...prev, [flight.id]: effectiveInfo!.fr24Id!.trim() }));
      }
      if (effectiveInfo.scheduleUnconfirmed === true) localUnconfirmedById[flight.id] = true;
      if (effectiveInfo.nextDayHint != null) {
        setNextDayHintById((prev) => ({ ...prev, [flight.id]: effectiveInfo.nextDayHint === true }));
      }
      if (effectiveInfo.scheduleSourceHint === 'fr24_first_last_seen') {
        setScheduleSourceHintById((prev) => ({ ...prev, [flight.id]: 'fr24_first_last_seen' }));
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
      if (effectiveInfo.flightStatus != null) payloadScheduled.flight_status = effectiveInfo.flightStatus;
      if (effectiveInfo.delayed != null) payloadScheduled.is_delayed = effectiveInfo.delayed;
      if (effectiveInfo.scheduleUnconfirmed != null) payloadScheduled.schedule_unconfirmed = effectiveInfo.scheduleUnconfirmed;
      if (effectiveInfo.scheduleSourceHint != null) payloadScheduled.schedule_source_hint = effectiveInfo.scheduleSourceHint;
      if (effectiveInfo.divertedTo != null) payloadScheduled.diverted_to = effectiveInfo.divertedTo;

      const payloadActual = {} as Record<string, unknown>;
      if (effectiveInfo.actual_departure_utc != null) payloadActual.actual_departure = effectiveInfo.actual_departure_utc;
      if (effectiveInfo.actual_arrival_utc != null) payloadActual.actual_arrival = effectiveInfo.actual_arrival_utc;

      if (Object.keys(payloadScheduled).length > 0) {
        if (debugKey === 'PC2088' || debugKey === 'PC2199') console.log(`[${debugKey}] Updating DB with payloadScheduled.flight_status =`, payloadScheduled.flight_status);
        let { error } = await supabase.from('flights').update(payloadScheduled).eq('id', flight.id);
        // If DB hasn't been migrated yet, don't let schedule_unconfirmed block schedule updates.
        if (isMissingColumn(error?.message, 'schedule_unconfirmed')) {
          const { schedule_unconfirmed, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (error && isMissingColumn(error?.message, 'schedule_source_hint')) {
          const { schedule_source_hint: _sh, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (error && isMissingColumn(error?.message, 'diverted_to')) {
          const { diverted_to: _dt, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
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
    const todayLocal = getLocalDateString();
    const minFlightDate = getLocalDateStringPlusDays(-1);
    if (listOverride?.length === 1) {
      const id = listOverride[0].id;
      const { data: one } = await supabase
        .from('flights')
        .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed, schedule_source_hint, diverted_to')
        .eq('id', id)
        .single();
      if (one) setFlights((prev) => prev.map((f) => (f.id === id ? { ...f, ...one } : f)));
      return;
    }
    let { data, error } = await supabase
      .from('flights')
      .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed, schedule_source_hint, diverted_to')
      .eq('crew_id', crewProfile.id)
      .gte('flight_date', minFlightDate)
      .order('flight_date', { ascending: true });
    if (isMissingColumn(error?.message, 'schedule_unconfirmed') || isMissingColumn(error?.message, 'schedule_source_hint') || isMissingColumn(error?.message, 'diverted_to')) {
      const { data: data2 } = await supabase
        .from('flights')
        .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed')
        .eq('crew_id', crewProfile.id)
        .gte('flight_date', minFlightDate)
        .order('flight_date', { ascending: true });
      data = (data2 as any)?.map((row: any) => ({
        ...row,
        schedule_unconfirmed: localUnconfirmedById[row.id] ?? null,
        diverted_to: null,
      }));
    }
    const freshList = data ?? [];
    const kept = await removeFlightsLandedOver6hAgo(freshList);
    setFlights(kept);
  }, [isCrew, crewProfile?.id]);

  const refreshFamilyListFromDb = useCallback(async () => {
    if (isCrew || !profile?.id) return;
    const { data: conns } = await supabase
      .from('family_connections')
      .select('crew_id')
      .eq('family_id', profile.id)
      .eq('status', 'approved');
    const crewIds = (conns ?? []).map((c: { crew_id: string }) => c.crew_id);
    console.log('[FamilyRoster] approved crew connections:', crewIds.length);
    if (crewIds.length === 0) {
      setFlights([]);
      return;
    }
    const minFlightDate = getLocalDateStringPlusDays(-1);
    let { data, error } = await supabase
      .from('flights')
      .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed, schedule_source_hint, diverted_to, crew_profiles(company_name)')
      .in('crew_id', crewIds)
      .gte('flight_date', minFlightDate)
      .order('flight_date', { ascending: true })
      .limit(50);

    const missingActual =
      error && (isMissingColumn(error.message, 'actual_departure') || isMissingColumn(error.message, 'actual_arrival'));
    const missingUnconfirmed = isMissingColumn(error?.message, 'schedule_unconfirmed');
    const missingSourceHint = isMissingColumn(error?.message, 'schedule_source_hint');
    const missingDivertedTo = isMissingColumn(error?.message, 'diverted_to');
    if (missingActual || missingUnconfirmed || missingSourceHint || missingDivertedTo) {
      const selectCols = missingUnconfirmed
        ? 'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, crew_profiles(company_name)'
        : 'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, is_delayed, flight_status, schedule_unconfirmed, crew_profiles(company_name)';
      const { data: fallback } = await supabase
        .from('flights')
        .select(selectCols)
        .in('crew_id', crewIds)
        .gte('flight_date', minFlightDate)
        .order('flight_date', { ascending: true })
        .limit(50);
      console.log('[FamilyRoster] flights fetched (fallback)', fallback?.length ?? 0);
      setFlights((fallback ?? []).map((row) => ({ ...(row as any), actual_departure: (row as any).actual_departure ?? null, actual_arrival: (row as any).actual_arrival ?? null, schedule_source_hint: null, diverted_to: (row as any).diverted_to ?? null })));
      return;
    }

    if (error) console.log('[FamilyRoster] flights select failed', error.message);
    console.log('[FamilyRoster] flights fetched', (data ?? []).length);
    setFlights(data ?? []);
  }, [isCrew, profile?.id]);

  /** Family: API’den güncelle (öncelik). Crew uçarken offline; family tek başına bilgi alır. */
  const refreshFamilyListFromApi = useCallback(async (listOverride?: Flight[]) => {
    if (isCrew || !profile?.id) return;
    const list = listOverride ?? flightsRef.current;
    if (list.length === 0) return;
    const singleFlight = listOverride?.length === 1;
    if (!singleFlight) setRefreshingList(true);
    const updates: Array<{
      flightId: string;
      scheduled_departure?: string | null;
      scheduled_arrival?: string | null;
      actual_departure?: string | null;
      actual_arrival?: string | null;
      flight_status?: string | null;
      origin_city?: string | null;
      destination_city?: string | null;
      is_delayed?: boolean | null;
      schedule_unconfirmed?: boolean | null;
      schedule_source_hint?: string | null;
      diverted_to?: string | null;
    }> = [];
    const FAMILY_UPDATE_CONCURRENCY = 6;
    for (let i = 0; i < list.length; i += FAMILY_UPDATE_CONCURRENCY) {
      const chunk = list.slice(i, i + FAMILY_UPDATE_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (flight) => {
          const info = await fetchFlightByNumber(flight.flight_number, flight.flight_date);
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
        const u: (typeof updates)[0] = { flightId: flight.id };
        if (info.scheduled_departure_utc != null) u.scheduled_departure = info.scheduled_departure_utc;
        if (info.scheduled_arrival_utc != null) u.scheduled_arrival = info.scheduled_arrival_utc;
        if (info.actual_departure_utc != null) u.actual_departure = info.actual_departure_utc;
        if (info.actual_arrival_utc != null) u.actual_arrival = info.actual_arrival_utc;
        if (info.flightStatus != null) u.flight_status = info.flightStatus;
        if (info.originCity != null) u.origin_city = info.originCity;
        if (info.destinationCity != null) u.destination_city = info.destinationCity;
        if (info.delayed != null) u.is_delayed = info.delayed;
        if (info.scheduleUnconfirmed != null) u.schedule_unconfirmed = info.scheduleUnconfirmed;
        if (info.scheduleSourceHint != null) u.schedule_source_hint = info.scheduleSourceHint;
        if (info.divertedTo != null) u.diverted_to = info.divertedTo;
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
        .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed, schedule_source_hint, diverted_to, crew_profiles(company_name)')
        .eq('id', id)
        .single();
      if (one) setFlights((prev) => prev.map((f) => (f.id === id ? { ...f, ...one } : f)));
    } else {
      await refreshFamilyListFromDb();
    }
    if (!singleFlight) setRefreshingList(false);
  }, [isCrew, profile?.id, refreshFamilyListFromDb]);

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
      await refreshFamilyListFromApi();
    }
  }, [isCrew, refreshTimesFromApi, refreshFamilyListFromApi]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: isCrew
        ? () => (
            <TouchableOpacity
              onPress={() => refreshTimesFromApi()}
              disabled={updatingTimes || flights.length === 0}
              style={styles.headerButton}
            >
              {updatingTimes ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <View style={styles.headerButtonContent}>
                  <Ionicons name="sync-outline" size={20} color={colors.white} />
                  <Text style={styles.headerButtonText}>{t('roster.sync')}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        : profile
          ? () => (
              <TouchableOpacity
                onPress={() => refreshFamilyListFromApi()}
                disabled={refreshingList || flights.length === 0}
                style={styles.headerButton}
              >
                {refreshingList ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <View style={styles.headerButtonContent}>
                    <Ionicons name="sync-outline" size={20} color={colors.white} />
                    <Text style={styles.headerButtonText}>{t('roster.sync')}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )
          : undefined,
    });
  }, [navigation, isCrew, profile, refreshTimesFromApi, refreshFamilyListFromApi, updatingTimes, refreshingList, flights.length]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      setLoading(true);
      const done = () => !cancelled && setLoading(false);
      const maybeAutoRefresh = (kept: Flight[]) => {
        // Auto-refresh from APIs (silent) so en_route flights get actual times without forcing user to tap Update.
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
        const dashList = getDashFlights(kept);
        if (!cancelled && dashList.length > 0 && now - lastDashRefreshMsRef.current >= DASH_REFRESH_INTERVAL_MS) {
          lastDashRefreshMsRef.current = now;
          refreshTimesFromApi(true, dashList).catch(() => {});
        }
      };

      if (isCrew && crewProfile?.id) {
        const minFlightDate = getLocalDateStringPlusDays(-1);
        const selectCols =
          'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed, schedule_source_hint, diverted_to';
        supabase
          .from('flights')
          .select(selectCols)
          .eq('crew_id', crewProfile.id)
          .gte('flight_date', minFlightDate)
          .order('flight_date', { ascending: true })
          .then(async ({ data, error }) => {
            if (error) {
              console.log('[Roster] flights select failed', error.message);
              const missingActual =
                isMissingColumn(error.message, 'actual_departure') || isMissingColumn(error.message, 'actual_arrival');
              const missingUnconfirmed = isMissingColumn(error.message, 'schedule_unconfirmed');
              const missingSourceHint = isMissingColumn(error.message, 'schedule_source_hint');
              const missingDivertedTo = isMissingColumn(error.message, 'diverted_to');

              if (missingActual || missingUnconfirmed || missingSourceHint || missingDivertedTo) {
                let fallbackCols = selectCols;
                if (missingActual) fallbackCols = fallbackCols.replace(', actual_departure, actual_arrival', '');
                if (missingUnconfirmed) fallbackCols = fallbackCols.replace(', schedule_unconfirmed', '');
                if (missingSourceHint) fallbackCols = fallbackCols.replace(', schedule_source_hint', '');
                if (missingDivertedTo) fallbackCols = fallbackCols.replace(', diverted_to', '');

                const { data: fallback, error: err2 } = await supabase
                  .from('flights')
                  .select(fallbackCols)
                  .eq('crew_id', crewProfile.id)
                  .gte('flight_date', minFlightDate)
                  .order('flight_date', { ascending: true });

                if (!err2 && fallback && !cancelled) {
                  console.log('[Roster] flights fetched (fallback cols)', fallback.length);
                  const list = fallback.map((row) => ({
                    ...(row as any),
                    actual_departure: (row as any).actual_departure ?? null,
                    actual_arrival: (row as any).actual_arrival ?? null,
                    schedule_unconfirmed: (row as any).schedule_unconfirmed ?? null,
                    schedule_source_hint: (row as any).schedule_source_hint ?? null,
                    diverted_to: (row as any).diverted_to ?? null,
                  }));
                  const kept = await removeFlightsLandedOver6hAgo(list);
                  setFlights(kept);
                  maybeAutoRefresh(kept as any);
                }
              }
              done();
              return;
            }
            const list = data ?? [];
            console.log('[Roster] flights fetched', list.length);
            const kept = await removeFlightsLandedOver6hAgo(list);
            if (!cancelled) setFlights(kept);
            maybeAutoRefresh(kept as any);
            done();
          });
      } else if (!isCrew && profile?.id) {
        // Use shared DB loader (handles missing columns + consistent filters)
        refreshFamilyListFromDb()
          .catch(() => {})
          .finally(() => done());
      } else {
        done();
      }
      return () => { cancelled = true; };
    }, [profile?.id, crewProfile?.id, isCrew, route.params?.refresh, refreshTimesFromApi, refreshFamilyListFromDb, getAutoRefreshList, getDashFlights])
  );

  // Keep live GS/ALT updated while staying on Roster screen.
  useFocusEffect(
    React.useCallback(() => {
      if (!isCrew || !crewProfile?.id) return () => {};
      let cancelled = false;
      const tick = async () => {
        if (cancelled) return;
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
        const dashList = getDashFlights(flightsRef.current);
        if (cancelled || dashList.length === 0) return;
        if (Date.now() - lastDashRefreshMsRef.current < DASH_REFRESH_INTERVAL_MS) return;
        lastDashRefreshMsRef.current = Date.now();
        autoRefreshInFlightRef.current = true;
        try {
          await refreshTimesFromApi(true, dashList);
        } catch {
        } finally {
          autoRefreshInFlightRef.current = false;
        }
      };
      // run once immediately, then every 120s
      tick();
      const id = setInterval(tick, 120_000);
      return () => {
        cancelled = true;
        clearInterval(id as any);
      };
    }, [isCrew, crewProfile?.id, getAutoRefreshList, getDashFlights, refreshTimesFromApi])
  );

  const formatDate = formatFlightDateTr;
  const formatTimeUTC = (iso: string | null) => formatFlightTimeUTC(iso);
  const formatTimeLocal = (iso: string | null) => formatFlightTimeLocal(iso);
  const localTzTag = (() => {
    try {
      const loc = (Intl as any)?.DateTimeFormat?.()?.resolvedOptions?.()?.locale as string | undefined;
      const s = typeof loc === 'string' ? loc : '';
      const m = s.match(/[-_](\w{2})\b/);
      const region = m?.[1]?.toUpperCase();
      return region && region.length === 2 ? region : 'LOCAL';
    } catch {
      return 'LOCAL';
    }
  })();
  /** Parse stored datetime as UTC for status logic. */
  const parseUtcMs = (iso: string | null | undefined): number => {
    const d = parseFlightTimeAsUtc(iso);
    return d ? d.getTime() : 0;
  };

  type FlightStatus = 'scheduled' | 'taxi_out' | 'departed' | 'en_route' | 'landed' | 'parked' | 'cancelled' | 'diverted' | 'incident' | 'redirected';
  /**
   * Flight status: from DB flight_status only. Statü türetme kaldırıldı — baştan yazılacak.
   */
  const getFlightStatus = (f: Flight): FlightStatus => {
    const fromApi = f.flight_status as FlightStatus | null | undefined;
    if (fromApi && ['cancelled', 'diverted', 'incident', 'redirected', 'scheduled', 'taxi_out', 'departed', 'en_route', 'landed', 'parked'].includes(fromApi)) {
      return fromApi === 'parked' ? 'landed' : fromApi;
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
    const { error } = await supabase.from('flights').delete().eq('id', id);
    if (error) return;
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  const handleDelete = (item: Flight) => {
    Alert.alert(t('roster.deleteFlight'), t('roster.deleteFlightConfirm', { number: item.flight_number }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteFlight(item.id) },
    ]);
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

  const handleSendFlightsToFamily = useCallback(async () => {
    if (!isCrew || !crewProfile?.id) return;
    setSendingToFamily(true);
    const date = getLocalDateString();
    const result = await notifyFamilyTodayFlights(crewProfile.id, date);
    setSendingToFamily(false);
    if (result.ok) {
      Alert.alert(
        t('roster.notifySent'),
        result.sent > 0 ? t('roster.notifySentMessage', { count: result.sent }) : t('roster.notifyNoDevices')
      );
    } else {
      Alert.alert(t('roster.notifyFailed'), result.error || t('roster.notifyFailedMessage'));
    }
  }, [isCrew, crewProfile?.id, t]);

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
            const { error } = await supabase.from('flights').delete().eq('crew_id', crewProfile.id);
            if (error) {
              Alert.alert(t('common.error'), t('roster.clearAllError'));
              return;
            }
            setFlights([]);
          },
        },
      ]
    );
  }, [isCrew, crewProfile?.id, t]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isCrew && (
        <TouchableOpacity
          style={[styles.sendToFamilyButton, sendingToFamily && styles.sendToFamilyButtonDisabled]}
          onPress={handleSendFlightsToFamily}
          disabled={sendingToFamily}
        >
{sendingToFamily ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <View style={styles.sendToFamilyButtonContent}>
                <Ionicons name="paper-plane-outline" size={20} color={colors.white} />
                <Text style={styles.sendToFamilyButtonText}>{t('roster.sendToFamily')}</Text>
              </View>
            )}
        </TouchableOpacity>
      )}

      {!isCrew && (
        <View />
      )}

      {loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('common.loading')}</Text>
      ) : flights.length === 0 ? (
        <>
          {isCrew && (
            <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddFlight')}>
              <View style={styles.addButtonContent}>
                <Ionicons name="add-circle-outline" size={22} color={colors.white} />
                <Text style={styles.addButtonText}>{t('roster.addFlight')}</Text>
              </View>
            </TouchableOpacity>
          )}
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            {isCrew ? t('roster.noFlightsCrew') : t('roster.noFlightsFamily')}
          </Text>
        </>
      ) : (
        <View style={styles.listAndClearContainer}>
          <FlatList
            data={flightsSorted}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            refreshControl={
              <RefreshControl
                refreshing={refreshingList || (isCrew && updatingTimes)}
                onRefresh={handlePullToRefresh}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item, index }) => {
            const runUpdateAndClose = () => {
              setUpdatingFlightIds((prev) => ({ ...prev, [item.id]: true }));
              const done = () => {
                setUpdatingFlightIds((prev) => ({ ...prev, [item.id]: false }));
                swipeableRefs.current[item.id]?.close();
              };
              if (isCrew) {
                refreshTimesFromApi(true, [item]).finally(done);
              } else {
                refreshFamilyListFromApi([item]).finally(done);
              }
            };
            const renderLeftActions = () => {
              const isUpdating = !!updatingFlightIds[item.id];
              return (
                <View style={[styles.swipeActionsRow, styles.swipeUpdate]}>
                  <View style={styles.swipeUpdateContent}>
                    <Text style={styles.swipeUpdateText}>{t('roster.sync')}</Text>
                    {isUpdating && (
                      <ActivityIndicator size="small" color={colors.white} style={styles.swipeUpdateSpinner} />
                    )}
                  </View>
                </View>
              );
            };
            const renderRightActions = () =>
              !isCrew
                ? null
                : (
                  <View style={styles.swipeActionsRow}>
                    <TouchableOpacity
                      style={styles.swipeDelete}
                      onPress={() => handleDelete(item)}
                    >
                      <Text style={styles.swipeDeleteText}>{t('common.delete')}</Text>
                    </TouchableOpacity>
                  </View>
                );
            const status = getFlightStatus(item);
            const displayStatus = status;
            const statusBox = statusConfig[displayStatus];
            const depCity = formatCityAndCode(item.origin_airport, item.origin_city);
            const arrCity = formatCityAndCode(item.destination_airport, item.destination_city);
            const isEnRoute = displayStatus === 'en_route' || displayStatus === 'departed';
            const showNextDayHint = nextDayHintById[item.id] === true;
            const statusLabelText =
              (displayStatus === 'en_route' || displayStatus === 'departed' || displayStatus === 'landed' || displayStatus === 'taxi_out' || displayStatus === 'scheduled' || displayStatus === 'diverted' || displayStatus === 'cancelled') ? null
                  : statusBox.label;
            const statusWithCenterIcon =
              displayStatus === 'en_route' || displayStatus === 'departed' || displayStatus === 'landed'
              || displayStatus === 'taxi_out' || displayStatus === 'scheduled' || displayStatus === 'diverted' || displayStatus === 'cancelled';
            const statusIsError = displayStatus === 'diverted' || displayStatus === 'cancelled';
            const statusCenterIcon =
              displayStatus === 'landed' ? '✅'
              : (displayStatus === 'en_route' || displayStatus === 'departed') ? '⏰'
              : null;
            const flightIndex = index + 1;
            const cardInner = (
              <View style={styles.cardRow}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => isCrew && navigation.navigate('EditFlight', { flightId: item.id })}
                  style={styles.cardMain}
                >
                  <View style={styles.cardMainWrap}>
                    <View>
                      <View style={styles.cardMainTop}>
                        <View style={styles.dateRowNumber}>
                          <Text style={styles.dateRowNumberText}>{flightIndex}</Text>
                        </View>
                        <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDate(item.flight_date)}</Text>
                      </View>
                      {!isCrew && <View />}
                      <Text style={[styles.route, { color: colors.text }]}>
                        <Text style={styles.routeLabel}>{t('roster.flightNo')} </Text>
                        <Text style={styles.flightNumber}>{item.flight_number}</Text>
                      </Text>
                    </View>
                    <View style={styles.cardMainBottom}>
                      <Text
                        style={[styles.depArrLine, { color: colors.text }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        <Text style={styles.depArrPrefix}>{t('roster.dep')} </Text>
                        {depCity}
                        <Text style={styles.depArrTimes}> – {formatTimeLocal(item.scheduled_departure)} ({localTzTag}) / {formatTimeUTC(item.scheduled_departure)} (Z)</Text>
                      </Text>
                      <Text
                        style={[styles.depArrLine, { color: colors.text }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        <Text style={styles.depArrPrefix}>{t('roster.arr')} </Text>
                        {arrCity}
                        <Text style={styles.depArrTimes}> – {formatTimeLocal(item.scheduled_arrival)} ({localTzTag}) / {formatTimeUTC(item.scheduled_arrival)} (Z)</Text>
                      </Text>
                      {item.schedule_unconfirmed === true && item.schedule_source_hint !== 'fr24_first_last_seen' && !scheduleSourceHintById[item.id] && (
                        <Text style={[styles.toBeUpdated, { color: colors.textMuted }]} accessibilityLabel="Schedule to be updated">
                          <Text style={styles.toBeUpdatedItalic}>{t('roster.toBeUpdated')}</Text>
                        </Text>
                      )}
                      {(item.schedule_source_hint === 'fr24_first_last_seen' || scheduleSourceHintById[item.id] === 'fr24_first_last_seen') && (
                        <Text style={[styles.prevDayDataBox, { color: colors.textMuted }]} accessibilityLabel="Önceki günün verisi">
                          <Text style={styles.prevDayDataText}>{t('roster.prevDayData')}</Text>
                        </Text>
                      )}
                      {showNextDayHint && (
                        <Text style={[styles.nextDayHint, { color: colors.textMuted }]} accessibilityLabel="Times are for next day">
                          <Text style={styles.nextDayHintText}>{t('roster.nextDay')}</Text>
                        </Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={styles.sideDivider} />
                <TouchableOpacity
                  style={styles.statusBox}
                  activeOpacity={0.8}
                  onPress={() => openFlightradar24(item.flight_number, item.flight_date, fr24IdByFlightId[item.id])}
                  accessibilityLabel="Track on FR24"
                >
                  <View style={styles.statusBoxInner}>
                    <View style={styles.statusContentCenter}>
                      {statusWithCenterIcon ? (
                        <>
                          <Text style={[styles.statusLabel, { color: statusIsError ? colors.error : displayStatus === 'landed' ? colors.success : colors.text }]}>
                            {displayStatus === 'diverted' && item.diverted_to ? t('roster.divertedTo', { airport: item.diverted_to }) : statusBox.label}
                          </Text>
                          <View style={styles.statusClockCenter}>
                            {displayStatus === 'taxi_out' ? (
                              <Ionicons name="radio-outline" size={28} color={colors.text} />
                            ) : displayStatus === 'scheduled' ? (
                              <Ionicons name="calendar-outline" size={28} color={colors.text} />
                            ) : displayStatus === 'diverted' ? (
                              <Ionicons name="arrow-redo-outline" size={28} color={colors.error} />
                            ) : displayStatus === 'cancelled' ? (
                              <Ionicons name="close-circle-outline" size={28} color={colors.error} />
                            ) : (
                              <Text style={styles.statusClockIcon}>{statusCenterIcon}</Text>
                            )}
                          </View>
                        </>
                      ) : (
                        <Text style={[styles.statusLabel, { color: colors.text }]}>
                          {statusLabelText}
                        </Text>
                      )}
                    </View>
                    <View style={styles.trackInStatusRow}>
                      <Ionicons name="location-outline" size={12} color={colors.accent} />
                      <Text style={[styles.trackInStatusText, { color: colors.primary }]}>{t('roster.trackOnFr24')}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            );
            const cardContent = (
              <Swipeable
                ref={(r) => { swipeableRefs.current[item.id] = r; }}
                renderLeftActions={renderLeftActions}
                renderRightActions={renderRightActions}
                leftThreshold={20}
                onSwipeableOpen={runUpdateAndClose}
                overshootLeft={false}
                overshootRight={false}
              >
                <View style={[styles.card, displayStatus === 'landed' && styles.cardLanded]}>
                  {cardInner}
                </View>
              </Swipeable>
            );
            return (
              <View style={styles.itemWrapper}>
                {cardContent}
              </View>
            );
          }}
          />
          {isCrew && flights.length > 0 && (
            <View style={styles.clearAllButtonWrap}>
              <TouchableOpacity style={[styles.addButton, styles.addButtonInWrap]} onPress={() => navigation.navigate('AddFlight')}>
                <View style={styles.addButtonContent}>
                  <Ionicons name="add-circle-outline" size={22} color={colors.white} />
                  <Text style={styles.addButtonText}>{t('roster.addFlight')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearAllButton} onPress={handleClearAllFlights}>
                <View style={styles.clearAllButtonContent}>
                  <Ionicons name="trash-outline" size={20} color={colors.white} />
                  <Text style={styles.clearAllButtonText}>{t('roster.clearAllFlights')}</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 0 },
  addButton: { backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  addButtonInWrap: { marginBottom: 0 },
  addButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addButtonText: { color: colors.white, fontWeight: '700', fontSize: 17 },
  sendToFamilyButton: {
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  sendToFamilyButtonDisabled: { opacity: 0.6 },
  sendToFamilyButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sendToFamilyButtonText: { color: colors.white, fontWeight: '700', fontSize: 17 },
  listAndClearContainer: { flex: 1 },
  listFlex: { flex: 1 },
  list: { paddingBottom: 20 },
  clearAllButtonWrap: {
    paddingHorizontal: 0,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: colors.background,
    gap: 8,
    marginBottom: 0,
  },
  clearAllButton: {
    backgroundColor: '#B71C1C',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8B0000',
  },
  clearAllButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clearAllButtonText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  itemWrapper: { marginBottom: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  dateRowNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dateRowNumberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  cardLanded: {
    borderWidth: 3,
    borderColor: colors.success,
  },
  cardRow: { flexDirection: 'row', alignItems: 'stretch', padding: 16, paddingRight: 0 },
  cardMain: { flex: 1, paddingRight: 12, position: 'relative' },
  cardMainWrap: { flex: 1, justifyContent: 'space-between' },
  cardMainBottom: {},
  sideDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  cardMainTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  statusBox: {
    backgroundColor: 'transparent',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 0,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 104,
    alignSelf: 'stretch',
  },
  statusBoxInner: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  statusLabel: { fontSize: 20, fontWeight: '900', textAlign: 'center' },
  statusClockCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 30 },
  statusClockIcon: { fontSize: 26 },
  trackInStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 0 },
  trackInStatusText: { fontSize: 12, fontWeight: '700', fontStyle: 'italic', textAlign: 'center' },
  toBeUpdated: { marginTop: 10, fontSize: 12 },
  toBeUpdatedItalic: { fontStyle: 'italic' },
  nextDayHint: { marginTop: 6, fontSize: 11, opacity: 0.85 },
  nextDayHintText: { fontStyle: 'italic' },
  prevDayDataBox: { marginTop: 6, fontSize: 11, opacity: 0.9 },
  prevDayDataText: { fontStyle: 'italic' },
  headerButton: { paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center' },
  headerButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerButtonText: { color: colors.white, fontWeight: '700', fontSize: 17 },
  date: { fontSize: 12, marginBottom: 2 },
  crew: { fontSize: 12, marginBottom: 2 },
  route: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  routeLabel: { fontWeight: '600' },
  flightNumber: { fontWeight: '800', fontSize: 19, color: colors.text },
  depArrLine: { fontSize: 13, marginTop: 6 },
  depArrPrefix: { fontWeight: '600' },
  depArrTimes: { fontWeight: '400', color: colors.textMuted, fontSize: 13 },
  swipeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
  },
  swipeUpdate: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    height: '100%',
    borderRadius: 12,
    marginRight: 8,
  },
  swipeUpdateContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeUpdateText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  swipeUpdateSpinner: { marginTop: 6 },
  swipeDelete: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    borderRadius: 12,
  },
  swipeDeleteText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 16 },
});
