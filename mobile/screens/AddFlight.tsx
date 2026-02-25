import { useState, useEffect, useCallback } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { fetchFlightByNumber, FlightInfo, hasFlightApiKeys } from '../lib/flightApi';
import { AIRLINES } from '../constants/airlines';
import { getLocalDateString, getLocalDateStringTomorrow } from '../lib/dateUtils';
import { getAirportDisplay } from '../constants/airports';
import { colors } from '../theme/colors';

// Date format DD.MM.YYYY for UI; internal/API use YYYY-MM-DD
function toDisplayDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}
function fromDisplayDate(display: string): string {
  const trimmed = display.replace(/\s/g, '').trim();
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    const dd = d!.padStart(2, '0');
    const mm = m!.padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return '';
}
function todayIso(): string {
  return getLocalDateString();
}
function tomorrowIso(): string {
  return getLocalDateStringTomorrow();
}

// Extract numeric part of flight number (e.g. "614" from "614", "PC614", "PGT614")
function numericPart(input: string): string {
  const trimmed = input.replace(/\s/g, '').trim();
  const digits = trimmed.replace(/\D/g, '');
  return digits;
}

// Build full IATA flight number from profile airline + number (e.g. PGT + "614" -> "PC614")
function fullFlightNumberIata(airlineIcao: string | null, numberInput: string): string | null {
  const num = numericPart(numberInput);
  if (!num || num.length < 2) return null;
  const airline = AIRLINES.find((a) => a.icao === airlineIcao);
  if (!airline) return null;
  return airline.iata + num;
}

// Return-flight feature temporarily disabled (keep helper removed to avoid unused code).

export default function AddFlight() {
  const { crewProfile } = useSession();
  const [flightNumberInput, setFlightNumberInput] = useState('');
  const [dateIso, setDateIso] = useState(todayIso);
  const [dateInput, setDateInput] = useState(() => toDisplayDate(todayIso()));
  const setDateFromInput = (display: string) => {
    setDateInput(display);
    const iso = fromDisplayDate(display);
    if (iso) setDateIso(iso);
  };
  const [flightInfo, setFlightInfo] = useState<FlightInfo | null>(null);
  const [manualOrigin, setManualOrigin] = useState('');
  const [manualDestination, setManualDestination] = useState('');
  const [manualDepTime, setManualDepTime] = useState('');
  const [manualArrTime, setManualArrTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  // Return-flight flow is temporarily disabled.
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: { prefillFlightNumber?: string } }, 'params'>>();

  const airline = crewProfile?.airline_icao ? AIRLINES.find((a) => a.icao === crewProfile.airline_icao) : null;
  const fullNumber = fullFlightNumberIata(crewProfile?.airline_icao ?? null, flightNumberInput)
    ?? (flightNumberInput.replace(/\s/g, '').trim().length >= 5 ? flightNumberInput.replace(/\s/g, '').trim().toUpperCase() : null);
  const displayNumber = fullNumber ?? (flightNumberInput.trim() || '—');

  const onChangeFlightNumber = (text: string) => {
    // For airline-selected flow (Pegasus/THY/SunExpress MVP), user should enter digits only.
    if (airline) {
      setFlightNumberInput(numericPart(text));
      return;
    }
    setFlightNumberInput(text);
  };

  const lookupFlight = useCallback(async () => {
    if (!fullNumber || !dateIso) return;
    setFetching(true);
    setLookupFailed(false);
    const info = await fetchFlightByNumber(fullNumber, dateIso);
    setFetching(false);
    setFlightInfo(info ?? null);
    if (info) {
      const toIata = (code: string) => getAirportDisplay(code)?.iata ?? code;
      setManualOrigin(toIata(info.origin));
      setManualDestination(toIata(info.destination));
      setManualDepTime(info.depTime);
      setManualArrTime(info.arrTime);
    }
    if (!info) setLookupFailed(true);
  }, [fullNumber, dateIso]);

  useEffect(() => {
    const prefill = route.params?.prefillFlightNumber;
    if (prefill && prefill.trim()) {
      setFlightNumberInput(prefill.trim());
    }
  }, [route.params?.prefillFlightNumber]);

  useEffect(() => {
    if (fullNumber && fullNumber.length >= 5 && dateIso.length === 10) {
      const t = setTimeout(lookupFlight, 600);
      return () => clearTimeout(t);
    } else {
      setFlightInfo(null);
      setLookupFailed(false);
    }
  }, [fullNumber, dateIso, lookupFlight]);

  /** Build UTC ISO from date + HH:MM. Manual times are interpreted as UTC (matches FR24 and flight info). */
  const buildDateTime = (dateStr: string, timeStr: string) => {
    if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return null;
    const [h, m] = timeStr.trim().split(':').map(Number);
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  };

  const toIata = (code: string | null | undefined) => (code ? (getAirportDisplay(code)?.iata ?? code) : '');
  const origin = (flightInfo?.origin || manualOrigin.trim()) || null;
  const destination = (flightInfo?.destination || manualDestination.trim()) || null;
  const originIata = origin ? toIata(origin) : null;
  const destinationIata = destination ? toIata(destination) : null;
  const depTime = flightInfo?.depTime || manualDepTime.trim();
  const arrTime = flightInfo?.arrTime || manualArrTime.trim();

  const handleSave = async () => {
    const num = numericPart(flightNumberInput);
    if (airline) {
      if (!num || num.length < 2) {
        Alert.alert('Error', 'Enter flight number (e.g. 614 or 1234)');
        return;
      }
    } else {
      if (flightNumberInput.replace(/\s/g, '').trim().length < 5) {
        Alert.alert('Error', 'Enter full flight number (e.g. PC614) or set your airline in Profile');
        return;
      }
    }
    if (!crewProfile?.id) return;
    const finalFlightNumber = fullNumber ?? (airline ? airline.iata + num : flightNumberInput.trim().toUpperCase());

    setLoading(true);
    const isDelayed = flightInfo?.delayed === true;
    const payload: Record<string, unknown> = {
      crew_id: crewProfile.id,
      flight_number: finalFlightNumber,
      origin_airport: originIata || null,
      destination_airport: destinationIata || null,
      origin_city: flightInfo?.originCity ?? null,
      destination_city: flightInfo?.destinationCity ?? null,
      flight_date: dateIso,
      scheduled_departure: flightInfo?.scheduled_departure_utc ?? (buildDateTime(dateIso, depTime) ?? null),
      scheduled_arrival: flightInfo?.scheduled_arrival_utc ?? (buildDateTime(dateIso, arrTime) ?? null),
      is_delayed: isDelayed,
      source: 'manual',
    };
    // Uncomment after running migration that adds flight_status: if (flightInfo?.flightStatus != null) payload.flight_status = flightInfo.flightStatus;
    const { data: inserted, error } = await supabase
      .from('flights')
      .insert(payload)
      .select('id, crew_id, flight_number, flight_date')
      .maybeSingle();
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    console.log('[AddFlight] inserted', inserted ?? null);
    const { count, error: countErr } = await supabase
      .from('flights')
      .select('id', { count: 'exact', head: true })
      .eq('crew_id', crewProfile.id);
    console.log('[AddFlight] flights visible to crew after insert', { count, countErr: countErr?.message ?? null });
    navigation.navigate('Main', { screen: 'Roster', params: { refresh: Date.now(), forceApiRefresh: true } });
  };

  const hasNumber = airline ? numericPart(flightNumberInput).length >= 2 : flightNumberInput.replace(/\s/g, '').trim().length >= 5;
  const canSave = hasNumber && dateIso.length === 10;

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
      {airline && (
        <View style={styles.airlineBox}>
          <Text style={[styles.airlineBoxLabel, { color: colors.textSecondary }]}>Selected airline</Text>
          <Text style={[styles.airlineBoxName, { color: colors.text }]}>{airline.name}</Text>
          <Text style={[styles.airlineBoxIcao, { color: colors.primary }]}>ICAO: {airline.icao}</Text>
        </View>
      )}

      <Text style={styles.hint}>
        {airline
          ? `Airline code ${airline.iata} is set. Enter only the numeric part (e.g. 614).`
          : 'Set your airline in Profile to get a prefilled code. Or enter full flight number (e.g. PC614).'}
      </Text>

      <View style={styles.grid2}>
        <View style={[styles.col, styles.colNarrow]}>
          <Text style={[styles.label, styles.labelCompact]}>Flight number</Text>
          <View style={styles.flightNumberRow}>
            {airline && (
              <View style={styles.flightNumberPrefix}>
                <Text style={styles.flightNumberPrefixText}>{airline.iata}</Text>
              </View>
            )}
            <TextInput
              style={[styles.input, airline && styles.inputWithPrefix]}
              placeholder={airline ? '614' : 'e.g. PC614, TK1823'}
              placeholderTextColor={colors.textMuted}
              value={flightNumberInput}
              onChangeText={onChangeFlightNumber}
              keyboardType={airline ? 'number-pad' : 'default'}
              autoCapitalize="characters"
            />
          </View>
          {fullNumber && (
            <Text style={styles.derived}>Saved as: {displayNumber}</Text>
          )}
        </View>

        <View style={[styles.col, styles.colWide]}>
          <Text style={[styles.label, styles.labelCompact]}>Date (DD.MM.YYYY)</Text>
          <View style={styles.dateRow}>
            <TextInput
              style={styles.inputDate}
              placeholder="DD.MM.YYYY"
              placeholderTextColor={colors.textMuted}
              value={dateInput}
              onChangeText={setDateFromInput}
              keyboardType="numbers-and-punctuation"
            />
            <View style={styles.dateQuickRow}>
              <TouchableOpacity
                style={[styles.dateQuickBtn, styles.dateQuickBtnHalf]}
                onPress={() => {
                  setDateIso(todayIso());
                  setDateInput(toDisplayDate(todayIso()));
                }}
              >
                <Text style={styles.dateQuickBtnText}>TODAY</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dateQuickBtn, styles.dateQuickBtnHalf]}
                onPress={() => {
                  setDateIso(tomorrowIso());
                  setDateInput(toDisplayDate(tomorrowIso()));
                }}
              >
                <Text style={styles.dateQuickBtnText}>TOMORROW</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {fetching && (
        <View style={styles.fetchingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.fetchingText}>Fetching flight details…</Text>
        </View>
      )}

      {(flightInfo || origin || destination) && !fetching && (
        <View style={styles.flightCard}>
          <Text style={styles.flightCardTitle}>Flight details</Text>
          <Text style={styles.route}>
            {(originIata || '—')} → {(destinationIata || '—')}
          </Text>
          <Text style={styles.times}>
            {(depTime || '—')} – {(arrTime || '—')}
          </Text>
          {flightInfo?.airline && (
            <Text style={styles.airline}>{flightInfo.airline}</Text>
          )}
          {flightInfo?.aircraftRegistration && (
            <Text style={styles.aircraft}>Aircraft: {flightInfo.aircraftRegistration}</Text>
          )}
        </View>
      )}

      {canSave && !fetching && (
        <>
          <Text style={styles.manualLabel}>Route and times (optional — edit or add if lookup didn’t find the flight)</Text>
          <View style={styles.grid2}>
            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Origin (e.g. SAW, IST)</Text>
              <TextInput
                style={styles.input}
                placeholder="Airport code"
                placeholderTextColor={colors.textMuted}
                value={manualOrigin}
                onChangeText={setManualOrigin}
                autoCapitalize="characters"
              />
            </View>
            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Destination (e.g. AYT, ADB)</Text>
              <TextInput
                style={styles.input}
                placeholder="Airport code"
                placeholderTextColor={colors.textMuted}
                value={manualDestination}
                onChangeText={setManualDestination}
                autoCapitalize="characters"
              />
            </View>
            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Departure time UTC (HH:MM)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 06:30"
                placeholderTextColor={colors.textMuted}
                value={manualDepTime}
                onChangeText={setManualDepTime}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Arrival time UTC (HH:MM)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 07:45"
                placeholderTextColor={colors.textMuted}
                value={manualArrTime}
                onChangeText={setManualArrTime}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          {!hasFlightApiKeys && canSave && (
            <Text style={styles.apiHint}>
              For auto-lookup: add EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN to mobile/.env, then run: npx expo start --clear
            </Text>
          )}
          {lookupFailed && (
            <TouchableOpacity style={styles.retryButton} onPress={lookupFlight}>
              <Text style={styles.retryButtonText}>Look up again</Text>
            </TouchableOpacity>
          )}
        </>
      )}
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.button, (loading || !canSave) && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={loading || !canSave}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Save flight</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 140 },
  airlineBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  airlineBoxLabel: { fontSize: 11, marginBottom: 2 },
  airlineBoxName: { fontSize: 17, fontWeight: '600' },
  airlineBoxIcao: { fontSize: 14, marginTop: 4 },
  hint: { color: colors.textSecondary, fontSize: 13, marginBottom: 20 },
  label: { color: colors.textSecondary, fontSize: 14, marginBottom: 8, marginTop: 16 },
  labelCompact: { marginTop: 0 },
  derived: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexBasis: '48%', flexGrow: 1, minWidth: 160 },
  colNarrow: { flexBasis: '40%', minWidth: 130 },
  colWide: { flexBasis: '56%', minWidth: 200 },
  dateRow: { gap: 8, marginTop: 4 },
  dateQuickRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputDate: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 120,
    flexGrow: 1,
  },
  dateQuickBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateQuickBtnHalf: { flex: 1, alignItems: 'center' },
  dateQuickBtnText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  flightNumberRow: { flexDirection: 'row', alignItems: 'stretch' },
  flightNumberPrefix: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    minWidth: 52,
  },
  flightNumberPrefixText: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  inputWithPrefix: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexGrow: 1,
  },
  fetchingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  fetchingText: { color: colors.primary, fontSize: 14 },
  flightCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  flightCardTitle: { color: colors.textSecondary, fontSize: 12, marginBottom: 8 },
  route: { color: colors.text, fontSize: 18, fontWeight: '700' },
  times: { color: colors.textSecondary, fontSize: 15, marginTop: 4 },
  airline: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  aircraft: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  manualLabel: { color: colors.textSecondary, fontSize: 14, marginTop: 20, marginBottom: 4 },
  apiHint: { color: colors.textMuted, fontSize: 11, marginTop: 12, marginBottom: 4 },
  retryButton: { marginTop: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  retryButtonText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  bottomBar: {
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
