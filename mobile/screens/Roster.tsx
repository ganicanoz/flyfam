import React, { useState, useCallback, useLayoutEffect, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking, Image } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { formatFlightTimeLocal, formatFlightTimeUTC, getLocalDateString, getLocalDateStringPlusDays, parseFlightTimeAsUtc } from '../lib/dateUtils';
import { fetchFlightByNumber, getFr24DeepLink } from '../lib/flightApi';
import { notifyFamilyFlightEvent, notifyFamilyTodayFlights } from '../lib/notifyFamily';
import { formatCityAndCode, getAirportDisplay } from '../constants/airports';
import { colors } from '../theme/colors';

const LANDED_DELETE_AFTER_MS = 24 * 60 * 60 * 1000; // Hide from list 24 hrs after landing

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

/** Hide flights that landed 6+ hours ago (no DB deletes). */
async function removeFlightsLandedOver6hAgo<
  T extends { id: string; scheduled_arrival: string | null; actual_arrival?: string | null }
>(list: T[]): Promise<T[]> {
  const now = Date.now();
  const toHide = list.filter((f) => {
    // Only hide when we have a confirmed actual arrival time.
    // Using scheduled_arrival can be wrong because we store times in UTC while flight_date is a local calendar day,
    // so scheduled times may appear on the previous UTC day and lead to premature deletion.
    const arrMs = parseUtcMsStatic(f.actual_arrival);
    return arrMs > 0 && now - arrMs >= LANDED_DELETE_AFTER_MS;
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
  crew_profiles?: { company_name: string | null } | { company_name: string | null }[] | null;
};

export default function Roster() {
  const { profile, crewProfile } = useSession();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [liveMetricsById, setLiveMetricsById] = useState<Record<string, { gs?: number; altFt?: number; atUtc?: string }>>({});
  const [airborneSeenById, setAirborneSeenById] = useState<Record<string, boolean>>({});
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
  const autoRefreshInFlightRef = useRef<boolean>(false);

  const getAutoRefreshList = useCallback((list: Flight[]) => {
    const now = Date.now();
    const minDate = getLocalDateStringPlusDays(-1);
    const maxAheadMs = 12 * 60 * 60 * 1000; // next 12 hours only (reduce API cost)
    const todayLocal = getLocalDateString();
    return list.filter((f) => {
      if (f.flight_date < minDate) return false;
      // Always keep live flights updated.
      if (f.flight_status === 'en_route') return true;
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

  const liveMetricLines = (
    m: { gs?: number; altFt?: number } | undefined | null
  ): { gsLine?: string; altLine?: string } => {
    if (!m) return {};
    const out: { gsLine?: string; altLine?: string } = {};
    if (typeof m.gs === 'number' && Number.isFinite(m.gs)) out.gsLine = `GS ${Math.round(m.gs * 1.852)} km/h`;
    if (typeof m.altFt === 'number' && Number.isFinite(m.altFt)) out.altLine = `ALT ${Math.round(m.altFt)} ft`;
    return out;
  };

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
    for (const flight of list) {
      const info = await fetchFlightByNumber(flight.flight_number, flight.flight_date);
      const debugKey = flight.flight_number.toUpperCase();
      if (debugKey === 'PC978' || debugKey === 'PC615' || debugKey === 'PC1915') {
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

      if (!effectiveInfo) continue;
      if (effectiveInfo.scheduleUnconfirmed === true) localUnconfirmedById[flight.id] = true;
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
      // Faster landed detection: after we have seen the flight airborne, treat GS < 70kt as landed,
      // but only for flights currently in en_route mode.
      const depMs0 = parseUtcMsStatic(flight.actual_departure ?? flight.scheduled_departure);
      const now0 = Date.now();
      // "Takeoff detected" guard: either we actually saw airborne metrics/status, OR we have an actual_departure
      // that is at least a few minutes in the past.
      const takeoffDetected =
        airborneSeenRef.current[flight.id] === true ||
        isAirborneNow ||
        (depMs0 > 0 && flight.actual_departure != null && now0 - depMs0 >= 5 * 60 * 1000);
      const airborneSeen = takeoffDetected;
      const arrMs0 = parseUtcMsStatic(flight.actual_arrival ?? flight.scheduled_arrival);
      const enRouteByTimes = depMs0 > 0 && depMs0 <= now0 && (arrMs0 === 0 || now0 < arrMs0 + 2 * 60 * 60 * 1000) && !flight.actual_arrival;
      const isEnRouteFlight = (flight.flight_status ?? '') === 'en_route' || effectiveInfo.flightStatus === 'en_route' || enRouteByTimes;
      const isLowSpeed =
        typeof gs === 'number' && Number.isFinite(gs) && gs >= 0 && gs < 70;
      if (airborneSeen && isEnRouteFlight && isLowSpeed) {
        effectiveInfo.flightStatus = 'landed';
        // Use track timestamp as best approximation of landing time when actual arrival isn't provided yet.
        if (!effectiveInfo.actual_arrival_utc && effectiveInfo.lastTrackUtc) {
          effectiveInfo.actual_arrival_utc = effectiveInfo.lastTrackUtc;
        }
      }
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

      const payloadActual = {} as Record<string, unknown>;
      if (effectiveInfo.actual_departure_utc != null) payloadActual.actual_departure = effectiveInfo.actual_departure_utc;
      if (effectiveInfo.actual_arrival_utc != null) payloadActual.actual_arrival = effectiveInfo.actual_arrival_utc;

      if (Object.keys(payloadScheduled).length > 0) {
        let { error } = await supabase.from('flights').update(payloadScheduled).eq('id', flight.id);
        // If DB hasn't been migrated yet, don't let schedule_unconfirmed block schedule updates.
        if (isMissingColumn(error?.message, 'schedule_unconfirmed')) {
          const { schedule_unconfirmed, ...rest } = payloadScheduled as any;
          ({ error } = await supabase.from('flights').update(rest).eq('id', flight.id));
        }
        if (error) {
          console.log('[Roster] scheduled update failed', { flight: flight.flight_number, id: flight.id, error: error.message });
        } else if (debugKey === 'PC978' || debugKey === 'PC615') {
          console.log(`[Debug ${debugKey}] DB updated scheduled keys:`, Object.keys(payloadScheduled));
        }
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
        } else if (debugKey === 'PC978' || debugKey === 'PC615') {
          console.log(`[Debug ${debugKey}] DB updated actual keys:`, Object.keys(payloadActual));
        }
      }
      if (effectiveInfo.flightStatus === 'en_route' && flight.flight_status !== 'en_route') {
        notifyFamilyFlightEvent('took_off', flight.id);
      }
      if (effectiveInfo.flightStatus === 'landed') {
        notifyFamilyFlightEvent('landed', flight.id);
      }
    }
    if (!silent) setUpdatingTimes(false);
    let { data, error } = await supabase
      .from('flights')
      .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed')
      .eq('crew_id', crewProfile.id)
      .order('flight_date', { ascending: true });
    if (isMissingColumn(error?.message, 'schedule_unconfirmed')) {
      const { data: data2 } = await supabase
        .from('flights')
        .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status')
        .eq('crew_id', crewProfile.id)
        .order('flight_date', { ascending: true });
      // Preserve unconfirmed marker in-memory even if DB column isn't migrated yet.
      data = (data2 as any)?.map((row: any) => ({
        ...row,
        schedule_unconfirmed: localUnconfirmedById[row.id] ?? null,
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
    const minDate = getLocalDateStringPlusDays(-1);
    let { data, error } = await supabase
      .from('flights')
      .select('id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed, crew_profiles(company_name)')
      .in('crew_id', crewIds)
      .gte('flight_date', minDate)
      .order('flight_date', { ascending: true })
      .limit(50);

    const missingActual =
      error && (isMissingColumn(error.message, 'actual_departure') || isMissingColumn(error.message, 'actual_arrival'));
    const missingUnconfirmed = isMissingColumn(error?.message, 'schedule_unconfirmed');
    if (missingActual || missingUnconfirmed) {
      const selectCols = missingUnconfirmed
        ? 'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, crew_profiles(company_name)'
        : 'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, is_delayed, flight_status, schedule_unconfirmed, crew_profiles(company_name)';
      const { data: fallback } = await supabase
        .from('flights')
        .select(selectCols)
        .in('crew_id', crewIds)
        .gte('flight_date', minDate)
        .order('flight_date', { ascending: true })
        .limit(50);
      console.log('[FamilyRoster] flights fetched (fallback)', fallback?.length ?? 0);
      setFlights((fallback ?? []).map((row) => ({ ...(row as any), actual_departure: null, actual_arrival: null })));
      return;
    }

    if (error) console.log('[FamilyRoster] flights select failed', error.message);
    console.log('[FamilyRoster] flights fetched', (data ?? []).length);
    setFlights(data ?? []);
  }, [isCrew, profile?.id]);

  const refreshFamilyList = useCallback(async () => {
    if (isCrew || !profile?.id) return;
    setRefreshingList(true);
    await refreshFamilyListFromDb();
    setRefreshingList(false);
  }, [isCrew, profile?.id, refreshFamilyListFromDb]);

  const refreshFamilyListFromApi = useCallback(async () => {
    if (isCrew || !profile?.id || flightsRef.current.length === 0) return;
    setRefreshingList(true);
    const list = flightsRef.current;
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
    }> = [];
    for (const flight of list) {
      const info = await fetchFlightByNumber(flight.flight_number, flight.flight_date);
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
      if (Object.keys(u).length > 1) updates.push(u);
    }
    if (updates.length > 0) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const { data, error } = await supabase.functions.invoke('update-flights-from-api', {
          body: { updates },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        console.log('[Family Update] update-flights-from-api result', { data: data ?? null, error: error?.message ?? null });
      } else {
        console.log('[Family Update] No access token; cannot invoke update-flights-from-api');
      }
    } else {
      console.log('[Family Update] No updates to apply');
    }
    await refreshFamilyListFromDb();
    setRefreshingList(false);
  }, [isCrew, profile?.id, refreshFamilyListFromDb]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: isCrew ? () => (
        <TouchableOpacity
          onPress={() => refreshTimesFromApi()}
          disabled={updatingTimes || flights.length === 0}
          style={styles.headerButton}
        >
          {updatingTimes ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.headerButtonText}>Update</Text>
          )}
        </TouchableOpacity>
      ) : !isCrew && profile ? () => (
        <TouchableOpacity
          onPress={() => refreshFamilyListFromApi()}
          disabled={refreshingList || flights.length === 0}
          style={styles.headerButton}
        >
          {refreshingList ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.headerButtonText}>Update</Text>
          )}
        </TouchableOpacity>
      ) : undefined,
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
      };

      if (isCrew && crewProfile?.id) {
        const selectCols =
          'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status, schedule_unconfirmed';
        supabase
          .from('flights')
          .select(selectCols)
          .eq('crew_id', crewProfile.id)
          .order('flight_date', { ascending: true })
          .then(async ({ data, error }) => {
            if (error) {
              console.log('[Roster] flights select failed', error.message);
              const missingActual =
                isMissingColumn(error.message, 'actual_departure') || isMissingColumn(error.message, 'actual_arrival');
              const missingUnconfirmed = isMissingColumn(error.message, 'schedule_unconfirmed');

              // If DB hasn't been migrated yet, retry without the missing columns.
              if (missingActual || missingUnconfirmed) {
                const fallbackCols = missingActual
                  ? (missingUnconfirmed
                    ? 'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, is_delayed, flight_status'
                    : 'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, is_delayed, flight_status, schedule_unconfirmed')
                  : 'id, flight_number, origin_airport, destination_airport, origin_city, destination_city, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, is_delayed, flight_status';

                const { data: fallback, error: err2 } = await supabase
                  .from('flights')
                  .select(fallbackCols)
                  .eq('crew_id', crewProfile.id)
                  .order('flight_date', { ascending: true });

                if (!err2 && fallback && !cancelled) {
                  console.log('[Roster] flights fetched (fallback cols)', fallback.length);
                  const list = fallback.map((row) => ({
                    ...(row as any),
                    actual_departure: (row as any).actual_departure ?? null,
                    actual_arrival: (row as any).actual_arrival ?? null,
                    schedule_unconfirmed: (row as any).schedule_unconfirmed ?? null,
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
    }, [profile?.id, crewProfile?.id, isCrew, route.params?.refresh, refreshTimesFromApi, refreshFamilyListFromDb, getAutoRefreshList])
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
        if (list.length === 0) return;
        autoRefreshInFlightRef.current = true;
        try {
          await refreshTimesFromApi(true, list);
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
    }, [isCrew, crewProfile?.id, getAutoRefreshList, refreshTimesFromApi])
  );

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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

  type FlightStatus = 'scheduled' | 'en_route' | 'landed' | 'cancelled' | 'diverted' | 'incident' | 'redirected';
  /**
   * Flight status uses real (actual) departure/arrival times when available, else scheduled.
   * 1. Times: depMs/arrMs from actual_departure/actual_arrival if set, else scheduled_departure/scheduled_arrival.
   * 2. flight_status from API wins for cancelled/diverted/incident/redirected.
   * 3. If now >= arrMs → landed; if now < depMs → scheduled; else → en_route.
   */
  const getFlightStatus = (f: Flight): FlightStatus => {
    const fromApi = f.flight_status as FlightStatus | null | undefined;
    const now = Date.now();
    const depMs = parseUtcMs(f.actual_departure ?? f.scheduled_departure);
    const arrMs = parseUtcMs(f.actual_arrival ?? f.scheduled_arrival);
    const depValid = depMs > 0;
    const arrValid = arrMs > 0 && arrMs > depMs;
    const pastArrival = arrValid && now >= arrMs;
    const pastDeparture = depValid && now >= depMs;
    const beforeDeparture = depValid && now < depMs;
    if (fromApi && ['cancelled', 'diverted', 'incident', 'redirected'].includes(fromApi)) return fromApi;
    if (pastArrival) return 'landed';
    if (fromApi === 'landed') return 'landed';
    if (beforeDeparture) return 'scheduled';
    if (pastDeparture) return 'en_route';
    if (fromApi === 'scheduled' || fromApi === 'en_route') return fromApi;
    return 'scheduled';
  };
  const statusConfig: Record<FlightStatus, { label: string }> = {
    scheduled: { label: 'Scheduled' },
    en_route: { label: 'En route' },
    landed: { label: 'Landed' },
    cancelled: { label: 'Cancelled' },
    diverted: { label: 'Diverted' },
    incident: { label: 'Incident' },
    redirected: { label: 'Redirected' },
  };

  const deleteFlight = async (id: string) => {
    const { error } = await supabase.from('flights').delete().eq('id', id);
    if (error) return;
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  const handleDelete = (item: Flight) => {
    Alert.alert('Delete flight', `Delete ${item.flight_number}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteFlight(item.id) },
    ]);
  };

  const openFlightradar24 = async (flightNumber: string, flightDate: string) => {
    try {
      const url = await getFr24DeepLink(flightNumber, flightDate);
      if (url) {
        Linking.openURL(url).catch(() => {});
        return;
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
      Alert.alert('Gönderildi', result.sent > 0 ? `Ailenize bildirim gönderildi (${result.sent} cihaz).` : 'Kayıtlı aile cihazı yok; bildirim gönderilmedi.');
    } else {
      Alert.alert('Gönderilemedi', result.error || 'Bildirim gönderilemedi.');
    }
  }, [isCrew, crewProfile?.id]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isCrew && (
        <>
          <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddFlight')}>
            <Text style={styles.addButtonText}>Add Flight</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sendToFamilyButton, sendingToFamily && styles.sendToFamilyButtonDisabled]}
            onPress={handleSendFlightsToFamily}
            disabled={sendingToFamily}
          >
            {sendingToFamily ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.sendToFamilyButtonText}>Send flights to my family</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      {!isCrew && (
        <View />
      )}

      {loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>Loading...</Text>
      ) : flights.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          {isCrew ? 'No flights yet. Add your first flight.' : 'No upcoming flights. Connect to a crew member.'}
        </Text>
      ) : (
        <FlatList
          data={flightsSorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const renderLeftActions = () => (
              <TouchableOpacity
                style={styles.swipeDelete}
                onPress={() => handleDelete(item)}
              >
                <Text style={styles.swipeDeleteText}>Delete</Text>
              </TouchableOpacity>
            );
            const status = getFlightStatus(item);
            const statusBox = statusConfig[status];
            const live = liveMetricsById[item.id];
            const { gsLine, altLine } = liveMetricLines(live);
            const showLiveMetrics = status !== 'landed' && (!!gsLine || !!altLine);
            const depCity = formatCityAndCode(item.origin_airport, item.origin_city);
            const arrCity = formatCityAndCode(item.destination_airport, item.destination_city);
            const isEnRoute = status === 'en_route';
            const statusLabelText =
              status === 'landed' ? `${statusBox.label} ✅`
              : status === 'en_route' ? `${statusBox.label} ⏰`
              : statusBox.label;
            const cardInner = (
              <View style={styles.cardRow}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => isCrew && navigation.navigate('EditFlight', { flightId: item.id })}
                  style={styles.cardMain}
                >
                  <View style={styles.cardMainTop}>
                    <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDate(item.flight_date)}</Text>
                  </View>
                  {!isCrew && (
                    <View />
                  )}
                  <Text style={[styles.route, { color: colors.text }]}>
                    <Text style={styles.routeLabel}>Flight No: </Text>
                    <Text style={styles.flightNumber}>
                      {item.flight_number}
                    </Text>
                  </Text>
                  <Text
                    style={[styles.depArrLine, { color: colors.text }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    <Text style={styles.depArrPrefix}>Dep: </Text>
                    {depCity}
                    <Text style={styles.depArrTimes}> – {formatTimeLocal(item.actual_departure ?? item.scheduled_departure)} ({localTzTag}) / {formatTimeUTC(item.actual_departure ?? item.scheduled_departure)} (Z)</Text>
                  </Text>
                  <Text
                    style={[styles.depArrLine, { color: colors.text }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    <Text style={styles.depArrPrefix}>Arr: </Text>
                    {arrCity}
                    <Text style={styles.depArrTimes}> – {formatTimeLocal(item.actual_arrival ?? item.scheduled_arrival)} ({localTzTag}) / {formatTimeUTC(item.actual_arrival ?? item.scheduled_arrival)} (Z)</Text>
                  </Text>
                  {item.schedule_unconfirmed === true && (
                    <Text style={[styles.toBeUpdated, { color: colors.textMuted }]} accessibilityLabel="Schedule to be updated">
                      <Text style={styles.toBeUpdatedItalic}>! to be updated</Text>
                    </Text>
                  )}
                </TouchableOpacity>
                <View style={styles.sideDivider} />
                <TouchableOpacity
                  style={styles.statusBox}
                  activeOpacity={0.8}
                  onPress={() => openFlightradar24(item.flight_number, item.flight_date)}
                  accessibilityLabel="Track on FR24"
                >
                  <Text style={[styles.statusLabel, { color: status === 'landed' ? colors.success : colors.text }]}>
                    {statusLabelText}
                  </Text>
                  {showLiveMetrics && (
                    <View style={styles.liveMetricsWrap}>
                      {!!gsLine && (
                        <Text style={[styles.liveMetricLine, { color: colors.textMuted }]} numberOfLines={1}>
                          {gsLine}
                        </Text>
                      )}
                      {!!altLine && (
                        <Text style={[styles.liveMetricLine, { color: colors.textMuted }]} numberOfLines={1}>
                          {altLine}
                        </Text>
                      )}
                    </View>
                  )}
                  <View style={styles.trackInStatusRow}>
                    <Image
                      source={require('../assets/tab-icon-roster.png')}
                      style={styles.trackInStatusIcon}
                      resizeMode="contain"
                    />
                    <Text style={[styles.trackInStatusText, { color: colors.primary }]}>Track on FR24</Text>
                  </View>
                </TouchableOpacity>
              </View>
            );
            if (isCrew) {
              return (
                <Swipeable renderLeftActions={renderLeftActions} overshootLeft={false}>
                  <View style={[styles.card, status === 'landed' && styles.cardLanded]}>{cardInner}</View>
                </Swipeable>
              );
            }
            return <View style={[styles.card, status === 'landed' && styles.cardLanded]}>{cardInner}</View>;
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  addButton: { backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  addButtonText: { color: colors.white, fontWeight: '700', fontSize: 17 },
  sendToFamilyButton: {
    backgroundColor: 'transparent',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  sendToFamilyButtonDisabled: { opacity: 0.6 },
  sendToFamilyButtonText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  list: { paddingBottom: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardLanded: {
    borderWidth: 3,
    borderColor: colors.success,
  },
  cardRow: { flexDirection: 'row', alignItems: 'stretch', padding: 16, paddingRight: 0 },
  cardMain: { flex: 1, paddingRight: 12, position: 'relative' },
  sideDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  cardMainTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
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
    gap: 4,
  },
  statusLabel: { fontSize: 13, fontWeight: '900', textAlign: 'center' },
  liveMetricsWrap: { alignItems: 'center', gap: 1 },
  liveMetricLine: { fontSize: 9, fontWeight: '800', textAlign: 'center', lineHeight: 12 },
  trackInStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 2 },
  trackInStatusIcon: { width: 18, height: 18, opacity: 1, tintColor: colors.accent },
  trackInStatusText: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  toBeUpdated: { marginTop: 10, fontSize: 12 },
  toBeUpdatedItalic: { fontStyle: 'italic' },
  headerButton: { paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center' },
  headerButtonText: { color: colors.white, fontWeight: '700', fontSize: 17 },
  date: { fontSize: 12, marginBottom: 2 },
  crew: { fontSize: 12, marginBottom: 2 },
  route: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  routeLabel: { fontWeight: '600' },
  flightNumber: { fontWeight: '800', fontSize: 19, color: colors.text },
  depArrLine: { fontSize: 13, marginTop: 6 },
  depArrPrefix: { fontWeight: '600' },
  depArrTimes: { fontWeight: '400', color: colors.textMuted, fontSize: 13 },
  swipeDelete: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginBottom: 12,
  },
  swipeDeleteText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 16 },
});
