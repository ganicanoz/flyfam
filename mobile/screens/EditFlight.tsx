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
  type ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { flightTimeToUtcHHMM, formatLocalCalendarWeekdayLong } from '../lib/dateUtils';
import { formatCityAndCode, getAirportTimezone } from '../constants/airports';
import { colors, useThemeMode } from '../theme/colors';
import KeyboardSafeScroll, { scrollInputIntoView } from '../components/KeyboardSafeScroll';
import TimeRollerField from '../components/TimeRollerField';

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
    if (h > 0 && m > 0) return `${h} saat ${m} dakika`;
    if (h > 0) return `${h} saat`;
    return `${m} dakika`;
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
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return null;
  }
}

function toUtcIsoFromDateTime(dateStr: string, timeStr: string): string | null {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return null;
  const [h, m] = timeStr.trim().split(':').map(Number);
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
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
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [mapWidth, setMapWidth] = useState(0);
  const [originCoords, setOriginCoords] = useState<AirportCoords | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<AirportCoords | null>(null);
  const mapAnim = useMemo(() => new Animated.Value(0), []);

  const routeCodeFrom = origin.trim().toUpperCase();
  const routeCodeTo = destination.trim().toUpperCase();
  const routeFromLabel = formatCityAndCode(routeCodeFrom || null);
  const routeToLabel = formatCityAndCode(routeCodeTo || null);

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
      const t = i / (fallbackCount - 1);
      const x = mapPaddingX + drawWidth * t;
      const y = 72 - 18 * (4 * t * (1 - t));
      return { x, y };
    });
  }, [routePoints, mapPaddingX, drawWidth]);
  const estimatedDurationMin = useMemo(() => {
    if (!date || !depTime || !arrTime) return null;
    const dep = toUtcIsoFromDateTime(date, depTime);
    const arr = toUtcIsoFromDateTime(date, arrTime);
    if (!dep || !arr) return null;
    let depMs = Date.parse(dep);
    let arrMs = Date.parse(arr);
    if (!Number.isFinite(depMs) || !Number.isFinite(arrMs)) return null;
    if (arrMs < depMs) arrMs += 24 * 60 * 60 * 1000;
    const mins = Math.round((arrMs - depMs) / 60000);
    return mins > 0 ? mins : null;
  }, [date, depTime, arrTime]);
  const durationText = useMemo(
    () => formatDuration(estimatedDurationMin, i18n.language || 'tr'),
    [estimatedDurationMin, i18n.language]
  );
  const depUtcIso = useMemo(() => toUtcIsoFromDateTime(date, depTime), [date, depTime]);
  const arrUtcIso = useMemo(() => toUtcIsoFromDateTime(date, arrTime), [date, arrTime]);
  const depLocalHHmm = useMemo(
    () => utcToAirportLocalHHmm(depUtcIso, routeCodeFrom || origin),
    [depUtcIso, routeCodeFrom, origin]
  );
  const arrLocalHHmm = useMemo(
    () => utcToAirportLocalHHmm(arrUtcIso, routeCodeTo || destination),
    [arrUtcIso, routeCodeTo, destination]
  );

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(mapAnim, {
        toValue: 1,
        duration: 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
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
      .select('flight_number, flight_date, origin_airport, destination_airport, scheduled_departure, scheduled_arrival')
      .eq('id', flightId)
      .single()
      .then(({ data, error }) => {
        setFetching(false);
        if (error || !data) return;
        setFlightNumber((data.flight_number as string) ?? '');
        setDate((data.flight_date as string) ?? '');
        setOrigin((data.origin_airport as string) ?? '');
        setDestination((data.destination_airport as string) ?? '');
        setDepTime(flightTimeToUtcHHMM(data.scheduled_departure as string));
        setArrTime(flightTimeToUtcHHMM(data.scheduled_arrival as string));
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
    const { error } = await supabase
      .from('flights')
      .update({
        flight_number: num.toUpperCase(),
        flight_date: date,
        origin_airport: origin.trim() || null,
        destination_airport: destination.trim() || null,
        scheduled_departure: toUtcIsoFromDateTime(date, depTime),
        scheduled_arrival: (() => {
          const depIso = toUtcIsoFromDateTime(date, depTime);
          const arrIso = toUtcIsoFromDateTime(date, arrTime);
          if (!depIso || !arrIso) return arrIso;
          const depMs = new Date(depIso).getTime();
          const arrMs = new Date(arrIso).getTime();
          if (Number.isFinite(depMs) && Number.isFinite(arrMs) && arrMs <= depMs) {
            return new Date(arrMs + 24 * 60 * 60 * 1000).toISOString();
          }
          return arrIso;
        })(),
      })
      .eq('id', flightId);
    setLoading(false);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    navigation.goBack();
  };

  if (fetching) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardSafeScroll
      scrollRef={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      bottomOffset={48}
    >
      <View style={styles.routeMapCard} onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}>
        <View style={styles.routeMapHeader}>
          <Text style={styles.routeMapTitle}>{t('editFlight.routePreview')}</Text>
          <Text style={styles.routeMapSubtitle}>{flightNumber.trim().toUpperCase() || '—'}</Text>
        </View>
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
                strokeColor={isDark ? 'rgba(255,255,255,0.75)' : 'rgba(15,23,42,0.35)'}
                strokeWidth={4}
                geodesic
              />
              <Polyline
                coordinates={mapRouteCoords}
                strokeColor={isDark ? '#60A5FA' : '#1D4ED8'}
                strokeWidth={2}
                geodesic
              />
              <Marker coordinate={{ latitude: originCoords!.lat, longitude: originCoords!.lon }} />
              <Marker coordinate={{ latitude: destinationCoords!.lat, longitude: destinationCoords!.lon }} />
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
        <View style={styles.routeMapLabels}>
          <View style={styles.routeMapLabelBox}>
            <Text style={styles.routeCode}>{routeCodeFrom || 'ORG'}</Text>
            <Text style={styles.routeCity} numberOfLines={1}>
              {routeFromLabel}
            </Text>
          </View>
          <View style={styles.routeMapLabelBox}>
            <Text style={[styles.routeCode, styles.routeCodeRight]}>{routeCodeTo || 'DST'}</Text>
            <Text style={[styles.routeCity, styles.routeCityRight]} numberOfLines={1}>
              {routeToLabel}
            </Text>
          </View>
        </View>
        <View style={styles.durationRow}>
          <Text style={styles.durationLabel}>{t('editFlight.estimatedDuration')}</Text>
          <Text style={styles.durationValue}>{durationText}</Text>
        </View>
      </View>
      <View style={styles.twoColRow}>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>{t('editFlight.flightNumber')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('editFlight.placeholderNumber')}
            placeholderTextColor={colors.textMuted}
            value={flightNumber}
            onChangeText={setFlightNumber}
            autoCapitalize="characters"
            editable={!readOnly}
            onFocus={onFieldFocus}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>{t('editFlight.date')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('editFlight.placeholderDate')}
            placeholderTextColor={colors.textMuted}
            value={date}
            onChangeText={setDate}
            editable={!readOnly}
            onFocus={onFieldFocus}
          />
        </View>
      </View>
      {(() => {
        const w = date.length === 10 ? formatLocalCalendarWeekdayLong(date) : null;
        return w ? (
          <Text style={styles.dateWeekdayHint} numberOfLines={1}>
            {w}
          </Text>
        ) : null;
      })()}
      <View style={styles.twoColRow}>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>{t('editFlight.origin')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('addFlight.airportCode')}
            placeholderTextColor={colors.textMuted}
            value={origin}
            onChangeText={setOrigin}
            autoCapitalize="characters"
            editable={!readOnly}
            onFocus={onFieldFocus}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>{t('editFlight.destination')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('addFlight.airportCode')}
            placeholderTextColor={colors.textMuted}
            value={destination}
            onChangeText={setDestination}
            autoCapitalize="characters"
            editable={!readOnly}
            onFocus={onFieldFocus}
          />
        </View>
      </View>
      <View style={styles.twoColRow}>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>{t('editFlight.depTime')}</Text>
          <TimeRollerField
            value={depTime}
            onChange={setDepTime}
            editable={!readOnly}
            placeholder={t('editFlight.placeholderTime')}
            onOpen={onFieldFocus}
          />
          <Text style={styles.localTimeHint}>
            {t('editFlight.localTime')} ({routeCodeFrom || '---'}): {depLocalHHmm ?? '—'}
          </Text>
        </View>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>{t('editFlight.arrTime')}</Text>
          <TimeRollerField
            value={arrTime}
            onChange={setArrTime}
            editable={!readOnly}
            placeholder={t('editFlight.placeholderArrTime')}
            onOpen={onFieldFocus}
          />
          <Text style={styles.localTimeHint}>
            {t('editFlight.localTime')} ({routeCodeTo || '---'}): {arrLocalHHmm ?? '—'}
          </Text>
        </View>
      </View>
      {!readOnly && (
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{t('editFlight.saveChanges')}</Text>
          )}
        </TouchableOpacity>
      )}
    </KeyboardSafeScroll>
  );
}

function createEditFlightStyles(themeMode: 'light' | 'dark') {
  const isDark = themeMode === 'dark';
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  routeMapCard: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
  },
  routeMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  routeMapTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  routeMapSubtitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
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
  routeMapLabels: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  routeMapLabelBox: { flex: 1 },
  routeCode: { color: colors.text, fontWeight: '800', fontSize: 14 },
  routeCodeRight: { textAlign: 'right' },
  routeCity: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  routeCityRight: { textAlign: 'right' },
  durationRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  durationLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  durationValue: { color: colors.text, fontSize: 14, fontWeight: '800' },
  label: { color: colors.textSecondary, fontSize: 14, marginBottom: 8, marginTop: 16 },
  fieldLabel: { color: colors.textSecondary, fontSize: 14, marginBottom: 8, marginTop: 16 },
  localTimeHint: { color: colors.textMuted, fontSize: 12, marginTop: 6, fontWeight: '600' },
  twoColRow: { flexDirection: 'row', columnGap: 10, alignItems: 'flex-start' },
  col: { flex: 1 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateWeekdayHint: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 32 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
});
}