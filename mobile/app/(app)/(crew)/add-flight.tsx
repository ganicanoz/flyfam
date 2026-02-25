import { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useSession } from '@/contexts/SessionContext';
import { getLocalDateString } from '@/lib/dateUtils';
import { supabase } from '@/lib/supabase';
import { AIRLINES } from '@/constants/airlines';
import { colors } from '@/theme/colors';

export default function AddFlight() {
  const { crewProfile } = useSession();
  const [flightNumber, setFlightNumber] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState(() => getLocalDateString());
  const [depTime, setDepTime] = useState('');
  const [arrTime, setArrTime] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const airline = crewProfile?.airline_icao
    ? AIRLINES.find((a) => a.icao === crewProfile.airline_icao) ?? null
    : null;

  const numericPart = (input: string): string => input.replace(/\D/g, '');

  const onChangeFlightNumber = (text: string) => {
    if (airline) {
      setFlightNumber(numericPart(text));
      return;
    }
    setFlightNumber(text);
  };

  const buildDateTime = (dateStr: string, timeStr: string) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(dateStr);
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  };

  const handleSave = async () => {
    const cleaned = flightNumber.replace(/\s/g, '').trim();
    if (!cleaned) {
      Alert.alert('Error', 'Flight number is required');
      return;
    }
    if (!crewProfile?.id) return;

    const finalFlightNumber = airline
      ? (airline.iata + numericPart(cleaned))
      : cleaned.toUpperCase();
    if (airline && numericPart(cleaned).length < 2) {
      Alert.alert('Error', 'Enter flight number (e.g. 614 or 1234)');
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('flights').insert({
      crew_id: crewProfile.id,
      flight_number: finalFlightNumber,
      origin_airport: origin.trim() || null,
      destination_airport: destination.trim() || null,
      flight_date: date,
      scheduled_departure: buildDateTime(date, depTime),
      scheduled_arrival: buildDateTime(date, arrTime),
      source: 'manual',
    });

    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    router.back();
  };

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
              <Text style={styles.airlineBoxLabel}>Selected airline</Text>
              <Text style={styles.airlineBoxName}>{airline.name}</Text>
              <Text style={styles.airlineBoxIcao}>ICAO: {airline.icao}</Text>
            </View>
          )}

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
                  placeholder={airline ? '614' : 'e.g. PC1234, TK1823'}
                  placeholderTextColor={colors.textMuted}
                  value={flightNumber}
                  onChangeText={onChangeFlightNumber}
                  keyboardType={airline ? 'number-pad' : 'default'}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <View style={[styles.col, styles.colWide]}>
              <Text style={[styles.label, styles.labelCompact]}>Date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={date}
                onChangeText={setDate}
              />
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Origin (IATA)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. IST"
                placeholderTextColor={colors.textMuted}
                value={origin}
                onChangeText={setOrigin}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Destination (IATA)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. SAW"
                placeholderTextColor={colors.textMuted}
                value={destination}
                onChangeText={setDestination}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Departure time (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="HH:MM"
                placeholderTextColor={colors.textMuted}
                value={depTime}
                onChangeText={setDepTime}
                keyboardType="numbers-and-punctuation"
              />
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Arrival time (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="HH:MM"
                placeholderTextColor={colors.textMuted}
                value={arrTime}
                onChangeText={setArrTime}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={loading}
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 140,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 8,
    marginTop: 16,
  },
  labelCompact: { marginTop: 0 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexBasis: '48%', flexGrow: 1, minWidth: 160 },
  colNarrow: { flexBasis: '40%', minWidth: 130 },
  colWide: { flexBasis: '56%', minWidth: 200 },
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
  airlineBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  airlineBoxLabel: { fontSize: 11, marginBottom: 2, color: colors.textSecondary },
  airlineBoxName: { fontSize: 17, fontWeight: '600', color: colors.text },
  airlineBoxIcao: { fontSize: 14, marginTop: 4, color: colors.primary },
  bottomBar: {
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  button: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
