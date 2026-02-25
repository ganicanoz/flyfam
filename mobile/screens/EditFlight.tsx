import { useState, useEffect } from 'react';
import {
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
import { flightTimeToUtcHHMM } from '../lib/dateUtils';
import { colors } from '../theme/colors';

type EditFlightParams = { flightId: string };

export default function EditFlight() {
  const { crewProfile } = useSession();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: EditFlightParams }, 'params'>>();
  const flightId = route.params?.flightId;

  const [flightNumber, setFlightNumber] = useState('');
  const [date, setDate] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [depTime, setDepTime] = useState('');
  const [arrTime, setArrTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

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

  const buildDateTime = (dateStr: string, timeStr: string) => {
    if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return null;
    const [h, m] = timeStr.trim().split(':').map(Number);
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  };

  const handleSave = async () => {
    const num = flightNumber.replace(/\s/g, '').trim();
    if (!num || num.length < 4) {
      Alert.alert('Error', 'Enter a valid flight number (e.g. PC614)');
      return;
    }
    if (!date || date.length !== 10) {
      Alert.alert('Error', 'Enter date YYYY-MM-DD');
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
        scheduled_departure: buildDateTime(date, depTime),
        scheduled_arrival: buildDateTime(date, arrTime),
      })
      .eq('id', flightId);
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    navigation.goBack();
  };

  if (fetching) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Flight number</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. PC614"
        placeholderTextColor={colors.textMuted}
        value={flightNumber}
        onChangeText={setFlightNumber}
        autoCapitalize="characters"
      />
      <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textMuted}
        value={date}
        onChangeText={setDate}
      />
      <Text style={styles.label}>Origin (e.g. SAW, IST)</Text>
      <TextInput
        style={styles.input}
        placeholder="Airport code"
        placeholderTextColor={colors.textMuted}
        value={origin}
        onChangeText={setOrigin}
        autoCapitalize="characters"
      />
      <Text style={styles.label}>Destination (e.g. AYT, ADB)</Text>
      <TextInput
        style={styles.input}
        placeholder="Airport code"
        placeholderTextColor={colors.textMuted}
        value={destination}
        onChangeText={setDestination}
        autoCapitalize="characters"
      />
      <Text style={styles.label}>Departure time UTC (HH:MM)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 06:30"
        placeholderTextColor={colors.textMuted}
        value={depTime}
        onChangeText={setDepTime}
        keyboardType="numbers-and-punctuation"
      />
      <Text style={styles.label}>Arrival time UTC (HH:MM)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 07:45"
        placeholderTextColor={colors.textMuted}
        value={arrTime}
        onChangeText={setArrTime}
        keyboardType="numbers-and-punctuation"
      />
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Save changes</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  label: { color: colors.textSecondary, fontSize: 14, marginBottom: 8, marginTop: 16 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 32 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
