import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Linking,
  type ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { flightTimeToUtcHHMM } from '../lib/dateUtils';
import { airportLocalHhmmToUtcIso } from '../lib/flightApi';
import { formatCityAndCode, getAirportDisplay, getAirportTimezone } from '../constants/airports';
import { getFr24DeepLink } from '../lib/flightApi';
import { colors, useThemeMode } from '../theme/colors';
import {
  FlightStatusBadge,
  resolveFlightStatusBadgeKind,
} from '../components/FlightStatusBadge';
import { significantArrivalSkewMins } from '../lib/flightDelayThreshold';
import { cardAccent, radius, shadow } from '../theme/tokens';
import KeyboardSafeScroll, { scrollInputIntoView } from '../components/KeyboardSafeScroll';
import TimeRollerField from '../components/TimeRollerField';
import DateRollerField from '../components/DateRollerField';
import { ScreenPageHeader } from '../components/ScreenPageHeader';

type EditFlightParams = { flightId: string; readOnly?: boolean };
type AirportCoords = { lat: number; lon: number };
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1f2630' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#aeb8c2' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1f2630' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a3441' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1c2b' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

function parseAirportCoords(raw: unknown): AirportCoords | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const lat = Number(obj.lat ?? obj.latitude ?? obj.latitude_deg);
  const lon = Number(obj.lon ?? obj.lng ?? obj.longitude ?? obj.longitude_deg);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function greatCirclePoints(from: AirportCoords, to: AirportCoords, segments = 40): AirportCoords[] {
  const degToRad = (v: number) => (v * Math.PI) / 180;
  const radToDeg = (v: number) => (v * 180) / Math.PI;
  const lat1 = degToRad(from.lat);
  const lon1 = degToRad(from.lon);
  const lat2 = degToRad(to.lat);
  const lon2 = degToRad(to.lon);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
      )
    );
  if (!Number.isFinite(d) || d === 0) return [from, to];
  const points: AirportCoords[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.sin((1 - t) * d) / Math.sin(d);
    const b = Math.sin(t * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    const lat = radToDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    const lon = radToDeg(Math.atan2(y, x));
    points.push({ lat, lon });
  }
  return points;
}

function formatDuration(minutes: number | null, language: string): string {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if ((language || '').toLowerCase().startsWith('tr')) {
    if (h > 0 && m > 0) return `${h}sa ${m}dk`;
    if (h > 0) return `${h}sa`;
    return `${m}dk`;
  }
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function utcToAirportLocalHHmm(isoUtc: string | null, airportCode: string): string | null {
  if (!isoUtc) return null;
  const tz = getAirportTimezone(airportCode);
  if (!tz) return null;
  const d = new Date(isoUtc);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    // Locale-independent HH:MM (tr-TR sometimes uses "." which breaks TimeRoller parse).
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(d);
    const h = parts.find((p) => p.type === 'hour')?.value;
    const m = parts.find((p) => p.type === 'minute')?.value;
    if (h == null || m == null) return null;
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function toUtcIsoFromAirportLocal(
  dateStr: string,
  timeStr: string,
  airportCode: string | null | undefined,
): string | null {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return null;
  const code = (airportCode || '').trim() || null;
  const iso = airportLocalHhmmToUtcIso(dateStr, timeStr.trim(), code);
  return iso ?? null;
}

function toUtcIsoFromDateTime(dateStr: string, timeStr: string): string | null {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return null;
  const [h, m] = timeStr.trim().split(':').map(Number);
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

function airportCityOnly(code: string, language: string): string | null {
  const info = getAirportDisplay(code);
  if (!info) return null;
  const isTr = (language || '').toLowerCase().startsWith('tr');
  const city = (isTr && info.city_tr ? info.city_tr : info.city)?.trim();
  return city || null;
}

function formatYmdDisplay(
  ymd: string,
  language: string,
): { dotted: string; dayMonth: string; weekdayShort: string | null } {
  const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const at = new Date(y, mo - 1, d, 12, 0, 0, 0);
  const dotted = `${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${y}`;
  if (Number.isNaN(at.getTime())) {
    return { dotted, dayMonth: dotted, weekdayShort: null };
  }
  const locale = (language || '').toLowerCase().startsWith('tr') ? 'tr-TR' : 'en-US';
  const dayMonth = at.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const weekdayShort = at.toLocaleDateString(locale, { weekday: 'short' });
  return { dotted, dayMonth, weekdayShort };
}

export default function EditFlight() {
  const { t, i18n } = useTranslation();
  const { crewProfile } = useSession();
  void crewProfile;
  const themeMode = useThemeMode();
  const isDark = themeMode === 'dark';
  const styles = useMemo(() => createEditFlightStyles(themeMode), [themeMode]);
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: EditFlightParams }, 'params'>>();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const onFieldFocus = (e: { nativeEvent?: { target?: unknown } }) => {
    setTimeout(() => scrollInputIntoView(scrollRef, e, 160), 80);
  };
  const flightId = route.params?.flightId;
  const readOnly = route.params?.readOnly === true;

  const [flightNumber, setFlightNumber] = useState('');
  const [date, setDate] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [depTime, setDepTime] = useState('');
  const [arrTime, setArrTime] = useState('');
  const [aircraftReg, setAircraftReg] = useState<string | null>(null);
  const [flightStatus, setFlightStatus] = useState<string | null>(null);
  const [etaUtc, setEtaUtc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [mapWidth, setMapWidth] = useState(0);
  const [originCoords, setOriginCoords] = useState<AirportCoords | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<AirportCoords | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const mapAnim = useMemo(() => new Animated.Value(0), []);

  const routeCodeFrom = origin.trim().toUpperCase();
  const routeCodeTo = destination.trim().toUpperCase();
  const routeFromLabel = formatCityAndCode(routeCodeFrom || null);
  const routeToLabel = formatCityAndCode(routeCodeTo || null);
  const originCity = airportCityOnly(routeCodeFrom, i18n.language || 'tr');
  const destCity = airportCityOnly(routeCodeTo, i18n.language || 'tr');
  const dateParts = date.length === 10 ? formatYmdDisplay(date, i18n.language || 'tr') : null;
  const dateDisplay = dateParts
    ? dateParts.weekdayShort
      ? `${dateParts.dotted} · ${dateParts.weekdayShort}`
      : dateParts.dotted
    : t('editFlight.placeholderDate');
  const cardTitle = useMemo(() => {
    const num = flightNumber.replace(/\s+/g, '').trim().toUpperCase();
    if (num && dateParts?.dayMonth) return `${num} · ${dateParts.dayMonth}`;
    if (num) return num;
    return t('editFlight.flightDetailTitle');
  }, [flightNumber, dateParts, t]);

  const mapPaddingX = 18;
  const drawWidth = Math.max(0, mapWidth - mapPaddingX * 2);
  const routePoints = useMemo(() => {
    if (!originCoords || !destinationCoords) return [] as { x: number; y: number }[];
    const gc = greatCirclePoints(originCoords, destinationCoords, 42);
    return gc.map((p) => {
      const x = mapPaddingX + ((p.lon + 180) / 360) * drawWidth;
      const y = 84 - ((p.lat + 90) / 180) * 56;
      return { x, y };
    });
  }, [originCoords, destinationCoords, drawWidth]);
  const mapRouteCoords = useMemo(() => {
    if (!originCoords || !destinationCoords) return [] as { latitude: number; longitude: number }[];
    return greatCirclePoints(originCoords, destinationCoords, 64).map((p) => ({
      latitude: p.lat,
      longitude: p.lon,
    }));
  }, [originCoords, destinationCoords]);
  const mapRegion = useMemo(() => {
    if (!originCoords || !destinationCoords) return null;
    const minLat = Math.min(originCoords.lat, destinationCoords.lat);
    const maxLat = Math.max(originCoords.lat, destinationCoords.lat);
    const minLon = Math.min(originCoords.lon, destinationCoords.lon);
    const maxLon = Math.max(originCoords.lon, destinationCoords.lon);
    const latitude = (originCoords.lat + destinationCoords.lat) / 2;
    const longitude = (originCoords.lon + destinationCoords.lon) / 2;
    const latitudeDelta = Math.max(2.8, (maxLat - minLat) * 2.2 + 1.2);
    const longitudeDelta = Math.max(2.8, (maxLon - minLon) * 2.2 + 1.2);
    return { latitude, longitude, latitudeDelta, longitudeDelta };
  }, [originCoords, destinationCoords]);
  const visibleRoutePoints = useMemo(() => {
    if (routePoints.length > 1) return routePoints;
    const fallbackCount = 26;
    return Array.from({ length: fallbackCount }, (_, i) => {
      const tFrac = i / (fallbackCount - 1);
      const x = mapPaddingX + drawWidth * tFrac;
      const y = 72 - 18 * (4 * tFrac * (1 - tFrac));
      return { x, y };
    });
  }, [routePoints, mapPaddingX, drawWidth]);
  const estimatedDurationMin = useMemo(() => {
    if (!date || !depTime || !arrTime) return null;
    const dep = toUtcIsoFromAirportLocal(date, depTime, origin) ?? toUtcIsoFromDateTime(date, depTime);
    const arr =
      toUtcIsoFromAirportLocal(date, arrTime, destination) ?? toUtcIsoFromDateTime(date, arrTime);
    if (!dep || !arr) return null;
    let depMs = Date.parse(dep);
    let arrMs = Date.parse(arr);
    if (!Number.isFinite(depMs) || !Number.isFinite(arrMs)) return null;
    if (arrMs < depMs) arrMs += 24 * 60 * 60 * 1000;
    const mins = Math.round((arrMs - depMs) / 60000);
    return mins > 0 ? mins : null;
  }, [date, depTime, arrTime, origin, destination]);
  const durationText = useMemo(
    () => formatDuration(estimatedDurationMin, i18n.language || 'tr'),
    [estimatedDurationMin, i18n.language],
  );
  const depUtcIso = useMemo(
    () => toUtcIsoFromAirportLocal(date, depTime, origin) ?? toUtcIsoFromDateTime(date, depTime),
    [date, depTime, origin],
  );
  const arrUtcIso = useMemo(
    () =>
      toUtcIsoFromAirportLocal(date, arrTime, destination) ?? toUtcIsoFromDateTime(date, arrTime),
    [date, arrTime, destination],
  );
  const depZuluHHmm = useMemo(() => flightTimeToUtcHHMM(depUtcIso), [depUtcIso]);
  const arrZuluHHmm = useMemo(() => flightTimeToUtcHHMM(arrUtcIso), [arrUtcIso]);
  const arrNextDay = useMemo(() => {
    if (!depTime || !arrTime || !/^\d{1,2}:\d{2}$/.test(depTime) || !/^\d{1,2}:\d{2}$/.test(arrTime)) {
      return false;
    }
    const [dh, dm] = depTime.split(':').map(Number);
    const [ah, am] = arrTime.split(':').map(Number);
    return ah * 60 + am <= dh * 60 + dm;
  }, [depTime, arrTime]);

  const statusLower = String(flightStatus || '').toLowerCase();
  const isAirborne = statusLower === 'en_route' || statusLower === 'departed';
  const isLandedStatus = statusLower === 'landed' || statusLower === 'parked';
  const detailDelayMins = useMemo(() => {
    if (!etaUtc || !arrUtcIso) return null;
    const etaMs = Date.parse(etaUtc);
    const staMs = Date.parse(arrUtcIso);
    if (!Number.isFinite(etaMs) || !Number.isFinite(staMs)) return null;
    const skew = Math.round((etaMs - staMs) / 60_000);
    if (isLandedStatus) return significantArrivalSkewMins(skew);
    return skew > 0 ? skew : null;
  }, [etaUtc, arrUtcIso, isLandedStatus]);
  const detailBadgeKind = resolveFlightStatusBadgeKind({
    flightStatus,
    delayMins: detailDelayMins != null && detailDelayMins > 0 ? detailDelayMins : null,
    isPast: isLandedStatus,
  });
  const remainLabel = useMemo(() => {
    if (!isAirborne) return null;
    const endMs =
      (etaUtc ? Date.parse(etaUtc) : NaN) || (arrUtcIso ? Date.parse(arrUtcIso) : NaN);
    if (!Number.isFinite(endMs) || endMs <= nowMs) return null;
    return formatDuration(Math.round((endMs - nowMs) / 60000), i18n.language || 'tr');
  }, [isAirborne, etaUtc, arrUtcIso, nowMs, i18n.language]);

  useEffect(() => {
    if (!isAirborne) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [isAirborne]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(mapAnim, {
        toValue: 1,
        duration: 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [mapAnim]);

  useEffect(() => {
    if (!flightId) {
      setFetching(false);
      return;
    }
    supabase
      .from('flights')
      .select(
        'flight_number, flight_date, origin_airport, destination_airport, scheduled_departure, scheduled_arrival, aircraft_registration, flight_status, estimated_arrival, fr24_progress_eta_utc',
      )
      .eq('id', flightId)
      .single()
      .then(({ data, error }) => {
        setFetching(false);
        if (error || !data) return;
        setFlightNumber((data.flight_number as string) ?? '');
        setDate((data.flight_date as string) ?? '');
        setOrigin((data.origin_airport as string) ?? '');
        setDestination((data.destination_airport as string) ?? '');
        // Düzenleme alanı: havalimanı yerel saati (kayıtta yerel→UTC).
        const orig = (data.origin_airport as string) ?? '';
        const dest = (data.destination_airport as string) ?? '';
        const depLocal =
          utcToAirportLocalHHmm(data.scheduled_departure as string, orig) ||
          flightTimeToUtcHHMM(data.scheduled_departure as string);
        const arrLocal =
          utcToAirportLocalHHmm(data.scheduled_arrival as string, dest) ||
          flightTimeToUtcHHMM(data.scheduled_arrival as string);
        setDepTime(depLocal);
        setArrTime(arrLocal);
        const reg = (data.aircraft_registration as string | null)?.trim();
        setAircraftReg(reg ? reg.toUpperCase() : null);
        setFlightStatus((data.flight_status as string | null) ?? null);
        setEtaUtc(
          (data.estimated_arrival as string | null) ||
            (data.fr24_progress_eta_utc as string | null) ||
            null,
        );
      });
  }, [flightId]);

  useEffect(() => {
    let cancelled = false;
    const fetchCoords = async (code: string): Promise<AirportCoords | null> => {
      const c = code.trim().toUpperCase();
      if (!c) return null;
      const { data } = await supabase
        .from('airports')
        .select('icao,iata,raw_light')
        .or(`icao.eq.${c},iata.eq.${c}`)
        .limit(1)
        .maybeSingle();
      if (!data) return null;
      return parseAirportCoords((data as { raw_light?: unknown }).raw_light ?? null);
    };
    (async () => {
      const [o, d] = await Promise.all([fetchCoords(routeCodeFrom), fetchCoords(routeCodeTo)]);
      if (cancelled) return;
      setOriginCoords(o);
      setDestinationCoords(d);
    })().catch(() => {
      if (cancelled) return;
      setOriginCoords(null);
      setDestinationCoords(null);
    });
    return () => {
      cancelled = true;
    };
  }, [routeCodeFrom, routeCodeTo]);

  const openLiveTrack = async () => {
    try {
      const url = await getFr24DeepLink(flightNumber, date);
      if (url) Linking.openURL(url).catch(() => {});
    } catch {
      /* ignore */
    }
  };

  const handleSave = async () => {
    const num = flightNumber.replace(/\s/g, '').trim();
    if (!num || num.length < 4) {
      Alert.alert(t('common.error'), t('editFlight.errorFlightNumber'));
      return;
    }
    if (!date || date.length !== 10) {
      Alert.alert(t('common.error'), t('editFlight.errorDate'));
      return;
    }
    setLoading(true);
    const depIso =
      toUtcIsoFromAirportLocal(date, depTime, origin.trim() || null) ??
      toUtcIsoFromDateTime(date, depTime);
    let arrIso =
      toUtcIsoFromAirportLocal(date, arrTime, destination.trim() || null) ??
      toUtcIsoFromDateTime(date, arrTime);
    if (depIso && arrIso) {
      const depMs = new Date(depIso).getTime();
      const arrMs = new Date(arrIso).getTime();
      if (Number.isFinite(depMs) && Number.isFinite(arrMs) && arrMs <= depMs) {
        arrIso = new Date(arrMs + 24 * 60 * 60 * 1000).toISOString();
      }
    }
    const { error } = await supabase
      .from('flights')
      .update({
        flight_number: num.toUpperCase(),
        flight_date: date,
        origin_airport: origin.trim() || null,
        destination_airport: destination.trim() || null,
        scheduled_departure: depIso,
        scheduled_arrival: arrIso,
      })
      .eq('id', flightId);
    setLoading(false);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    navigation.goBack();
  };

  const handleDelete = () => {
    Alert.alert(t('editFlight.deleteFlight'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeleting(true);
            const { error: rpcErr } = await supabase.rpc('remove_me_from_flight', {
              p_flight_id: flightId,
            });
            if (rpcErr) {
              const { error } = await supabase.from('flights').delete().eq('id', flightId);
              setDeleting(false);
              if (error) {
                Alert.alert(t('common.error'), error.message);
                return;
              }
            } else {
              setDeleting(false);
            }
            navigation.goBack();
          })();
        },
      },
    ]);
  };

  if (fetching) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const footerPad = Math.max(insets.bottom, 10);
  const pageTitle = t('editFlight.flightDetailTitle');
  const fieldFill = isDark ? '#1A2740' : '#F0F1F5';
  const accentBlue = cardAccent('flight', themeMode);
  const chipItems = [aircraftReg, durationText !== '—' ? durationText : null].filter(
    (x): x is string => !!x,
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={pageTitle} />
      <KeyboardSafeScroll
        scrollRef={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, !readOnly && { paddingBottom: 120 + footerPad }]}
        bottomOffset={48}
      >
        <View style={[styles.card, shadow.card]} onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}>
          <View style={[styles.cardAccent, { backgroundColor: accentBlue }]} />
          <View style={styles.cardBody}>
            <Text style={styles.sectionTitle}>{cardTitle}</Text>
            <View style={styles.routeMapCanvas}>
              {mapRegion && mapRouteCoords.length > 1 ? (
                <MapView
                  style={styles.mapView}
                  initialRegion={mapRegion}
                  region={mapRegion}
                  mapType={Platform.OS === 'ios' ? (isDark ? 'mutedStandard' : 'standard') : 'standard'}
                  customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
                  userInterfaceStyle={isDark ? 'dark' : 'light'}
                  scrollEnabled
                  zoomEnabled
                  rotateEnabled
                  pitchEnabled
                  toolbarEnabled
                >
                  <Polyline
                    coordinates={mapRouteCoords}
                    strokeColor={isDark ? '#60A5FA' : colors.primary}
                    strokeWidth={2}
                    geodesic
                    lineDashPattern={[8, 6]}
                  />
                  <Marker
                    coordinate={{ latitude: originCoords!.lat, longitude: originCoords!.lon }}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={styles.mapPin}>
                      <View style={[styles.mapPinDot, { backgroundColor: colors.primary }]} />
                      <Text style={styles.mapPinLabel}>{routeCodeFrom || 'ORG'}</Text>
                    </View>
                  </Marker>
                  <Marker
                    coordinate={{ latitude: destinationCoords!.lat, longitude: destinationCoords!.lon }}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={styles.mapPin}>
                      <View style={[styles.mapPinDot, { backgroundColor: colors.primary }]} />
                      <Text style={styles.mapPinLabel}>{routeCodeTo || 'DST'}</Text>
                    </View>
                  </Marker>
                </MapView>
              ) : (
                <>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.mapMotionLayer,
                      {
                        transform: [
                          {
                            translateX: mapAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [-56, 56],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                  <View style={[styles.routeEndpoint, { left: mapPaddingX - 6, top: 66 }]} />
                  <View style={[styles.routeEndpoint, { left: mapWidth - mapPaddingX - 6, top: 66 }]} />
                  {visibleRoutePoints.map((p, idx) => (
                    <View
                      key={`route-dot-${idx}`}
                      style={[styles.routeDot, { left: p.x - 2, top: p.y - 2 }]}
                    />
                  ))}
                </>
              )}
            </View>

            {chipItems.length > 0 ? (
              <View style={styles.chipRow}>
                {chipItems.map((c) => (
                  <View key={c} style={[styles.metaChip, { backgroundColor: fieldFill }]}>
                    <Text style={styles.metaChipText}>{c}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {detailBadgeKind || isAirborne ? (
              <View style={styles.liveBlock}>
                {detailBadgeKind ? (
                  <FlightStatusBadge
                    kind={detailBadgeKind}
                    delayMins={
                      detailDelayMins != null && detailDelayMins > 0 ? detailDelayMins : null
                    }
                    themeMode={themeMode}
                  />
                ) : null}
                {isAirborne && remainLabel ? (
                  <Text style={styles.liveStatusText}>
                    {t('editFlight.statusAirborneRemain', { remain: remainLabel })}
                  </Text>
                ) : null}
                {isAirborne ? (
                  <TouchableOpacity
                    style={[styles.liveTrackBtn, { backgroundColor: colors.primary }]}
                    onPress={openLiveTrack}
                    accessibilityLabel={t('roster.trackFr24A11y')}
                  >
                    <Ionicons name="play" size={14} color={colors.onPrimary} />
                    <Text style={[styles.liveTrackBtnText, { color: colors.onPrimary }]}>
                      {t('roster.liveTrack')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            <View style={styles.routeMapLabels}>
              <View style={styles.routeMapLabelBox}>
                <Text style={styles.routeCode}>{routeCodeFrom || 'ORG'}</Text>
                <Text style={styles.routeCity} numberOfLines={1}>
                  {originCity || routeFromLabel}
                </Text>
              </View>
              <View style={styles.routeMapLabelBox}>
                <Text style={[styles.routeCode, styles.routeCodeRight]}>{routeCodeTo || 'DST'}</Text>
                <Text style={[styles.routeCity, styles.routeCityRight]} numberOfLines={1}>
                  {destCity || routeToLabel}
                </Text>
              </View>
            </View>

            {aircraftReg ? (
              <View style={styles.metaRows}>
                <View style={styles.metaRow}>
                  <Text style={styles.metaKey}>{t('editFlight.tailLabel')}</Text>
                  <Text style={styles.metaVal}>{aircraftReg}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.durationRow}>
              <Text style={styles.durationLabel}>{t('editFlight.estimatedDuration')}</Text>
              <Text style={styles.durationValue}>{durationText}</Text>
            </View>

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              {t('editFlight.flightInfoSection')}
            </Text>

            <Text style={styles.fieldLabel}>{t('editFlight.flightNumber')}</Text>
            {readOnly ? (
              <Text style={[styles.readValue, { backgroundColor: fieldFill }]}>{flightNumber || '—'}</Text>
            ) : (
              <TextInput
                style={[styles.input, { backgroundColor: fieldFill }]}
                placeholder={t('editFlight.placeholderNumber')}
                placeholderTextColor={colors.textMuted}
                value={flightNumber}
                onChangeText={setFlightNumber}
                autoCapitalize="characters"
                onFocus={onFieldFocus}
              />
            )}

            <Text style={styles.fieldLabel}>{t('editFlight.date')}</Text>
            {readOnly ? (
              <Text style={[styles.readValue, { backgroundColor: fieldFill }]}>{dateDisplay}</Text>
            ) : (
              <DateRollerField
                value={date}
                onChange={setDate}
                displayLabel={dateDisplay}
                placeholder={t('editFlight.placeholderDate')}
                accessibilityLabel={t('editFlight.date')}
              />
            )}

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.fieldLabel}>{t('editFlight.origin')}</Text>
                {readOnly ? (
                  <Text style={[styles.readValue, { backgroundColor: fieldFill }]}>
                    {origin || '—'}
                    {originCity ? `\n${originCity}` : ''}
                  </Text>
                ) : (
                  <View style={[styles.inputStack, { backgroundColor: fieldFill }]}>
                    <TextInput
                      style={styles.inputInner}
                      value={origin}
                      onChangeText={setOrigin}
                      autoCapitalize="characters"
                      onFocus={onFieldFocus}
                    />
                    {originCity ? <Text style={styles.cityInside}>{originCity}</Text> : null}
                  </View>
                )}
              </View>
              <View style={styles.col}>
                <Text style={styles.fieldLabel}>{t('editFlight.destination')}</Text>
                {readOnly ? (
                  <Text style={[styles.readValue, { backgroundColor: fieldFill }]}>
                    {destination || '—'}
                    {destCity ? `\n${destCity}` : ''}
                  </Text>
                ) : (
                  <View style={[styles.inputStack, { backgroundColor: fieldFill }]}>
                    <TextInput
                      style={styles.inputInner}
                      value={destination}
                      onChangeText={setDestination}
                      autoCapitalize="characters"
                      onFocus={onFieldFocus}
                    />
                    {destCity ? <Text style={styles.cityInside}>{destCity}</Text> : null}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.fieldLabel}>{t('editFlight.depTime')}</Text>
                <TimeRollerField
                  value={depTime}
                  onChange={setDepTime}
                  editable={!readOnly}
                  subtitle={depZuluHHmm ? `(Z) ${depZuluHHmm}` : null}
                  onOpen={() => onFieldFocus({})}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.fieldLabel}>{t('editFlight.arrTime')}</Text>
                <TimeRollerField
                  value={arrTime}
                  onChange={setArrTime}
                  editable={!readOnly}
                  subtitle={arrZuluHHmm ? `(Z) ${arrZuluHHmm}` : null}
                  onOpen={() => onFieldFocus({})}
                />
                {arrNextDay ? <Text style={styles.plusOneHint}>{t('editFlight.plusOneDayHint')}</Text> : null}
              </View>
            </View>
          </View>
        </View>
      </KeyboardSafeScroll>

      {!readOnly ? (
        <View style={[styles.saveBar, { paddingBottom: footerPad, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[styles.button, (loading || deleting) && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={loading || deleting}
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>{t('editFlight.saveChanges')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={loading || deleting}>
            {deleting ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.deleteBtnText}>{t('editFlight.deleteFlight')}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function createEditFlightStyles(themeMode: 'light' | 'dark') {
  const isDark = themeMode === 'dark';
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    card: {
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      flexDirection: 'row',
    },
    cardAccent: { width: 4 },
    cardBody: { flex: 1, padding: 14 },
    sectionTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 10,
    },
    sectionTitleSpaced: { marginTop: 18 },
    routeMapCanvas: {
      height: 192,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(107,179,255,0.12)' : 'rgba(74,144,226,0.08)',
      overflow: 'hidden',
      position: 'relative',
    },
    mapView: {
      ...StyleSheet.absoluteFillObject,
    },
    mapPin: { alignItems: 'center', gap: 2 },
    mapPinDot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: '#fff',
    },
    mapPinLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.text,
      backgroundColor: colors.surface,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    mapMotionLayer: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: -80,
      right: -80,
      backgroundColor: isDark ? 'rgba(107,179,255,0.1)' : 'rgba(74,144,226,0.08)',
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: isDark ? 'rgba(107,179,255,0.22)' : 'rgba(74,144,226,0.18)',
    },
    routeDot: {
      position: 'absolute',
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.primary,
      opacity: 0.9,
    },
    routeEndpoint: {
      position: 'absolute',
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 10,
    },
    metaChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
    },
    metaChipText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    liveBlock: {
      marginTop: 12,
      gap: 10,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    liveStatusText: {
      flexGrow: 1,
      flexBasis: '100%',
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    liveTrackBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      alignSelf: 'flex-start',
    },
    liveTrackBtnText: { fontSize: 15, fontWeight: '800' },
    routeMapLabels: {
      marginTop: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    routeMapLabelBox: { flex: 1 },
    routeCode: { color: colors.text, fontWeight: '800', fontSize: 16 },
    routeCodeRight: { textAlign: 'right' },
    routeCity: { color: colors.textMuted, fontSize: 12, marginTop: 2, fontWeight: '500' },
    routeCityRight: { textAlign: 'right' },
    metaRows: {
      marginTop: 10,
      gap: 4,
    },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    metaKey: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    metaVal: { color: colors.text, fontSize: 13, fontWeight: '800' },
    durationRow: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    durationLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    durationValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 6,
      marginTop: 12,
    },
    cityInside: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 2 },
    plusOneHint: { color: '#B45309', fontSize: 12, fontWeight: '600', marginTop: 6 },
    twoColRow: { flexDirection: 'row', columnGap: 10, alignItems: 'flex-start' },
    col: { flex: 1 },
    input: {
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    readValue: {
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    inputStack: {
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    inputInner: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      padding: 0,
      margin: 0,
    },
    saveBar: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: 16,
      paddingTop: 10,
      gap: 4,
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: radius.pill,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
    deleteBtn: { paddingVertical: 14, alignItems: 'center' },
    deleteBtnText: { color: colors.error, fontSize: 15, fontWeight: '600' },
  });
}
