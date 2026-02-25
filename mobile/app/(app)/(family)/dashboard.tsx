import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import { formatFlightTimeLocal, getLocalDateString } from '@/lib/dateUtils';
import { colors } from '@/theme/colors';

type FlightWithCrew = {
  id: string;
  flight_number: string;
  origin_airport: string | null;
  destination_airport: string | null;
  flight_date: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  actual_departure?: string | null;
  actual_arrival?: string | null;
  crew_profiles: { company_name: string | null } | null;
};

export default function FamilyDashboard() {
  const { profile, signOut } = useSession();
  const [flights, setFlights] = useState<FlightWithCrew[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchFlights = async () => {
      const userId = profile?.id;
      if (!userId) {
        setLoading(false);
        return;
      }

      const { data: conns } = await supabase
        .from('family_connections')
        .select('crew_id')
        .eq('family_id', userId)
        .eq('status', 'approved');

      const crewIds = (conns ?? []).map((c) => c.crew_id);
      if (crewIds.length === 0) {
        setFlights([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('flights')
        .select('id, flight_number, origin_airport, destination_airport, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, crew_profiles(company_name)')
        .in('crew_id', crewIds)
        .gte('flight_date', getLocalDateString())
        .order('flight_date', { ascending: true })
        .limit(50);

      if (error) {
        console.error(error);
      } else {
        setFlights(data ?? []);
      }
      setLoading(false);
    };

    fetchFlights();
  }, [profile?.id]);

  const formatTime = formatFlightTimeLocal;

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const crewLabel = (f: FlightWithCrew) =>
    f.crew_profiles?.company_name ?? 'Crew';

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crew roster</Text>
      <Text style={styles.subtitle}>Flights from your linked crew members</Text>

      <TouchableOpacity
        style={styles.connectButton}
        onPress={() => router.push('/(app)/(family)/connect')}
      >
        <Text style={styles.connectButtonText}>Connect to crew</Text>
      </TouchableOpacity>

      {loading ? (
        <Text style={styles.empty}>Loading...</Text>
      ) : flights.length === 0 ? (
        <Text style={styles.empty}>
          No upcoming flights. Connect to a crew member to see their roster.
        </Text>
      ) : (
        <FlatList
          data={flights}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.date}>{formatDate(item.flight_date)}</Text>
              <Text style={styles.crew}>{crewLabel(item)}</Text>
              <Text style={styles.route}>
                {item.flight_number} · {item.origin_airport || '—'} → {item.destination_airport || '—'}
              </Text>
              <Text style={styles.times}>
                {formatTime(item.actual_departure ?? item.scheduled_departure)} – {formatTime(item.actual_arrival ?? item.scheduled_arrival)}
              </Text>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.signOut} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  connectButton: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  connectButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  list: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  date: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  crew: {
    color: colors.primary,
    fontSize: 12,
    marginBottom: 4,
  },
  route: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  times: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 48,
    fontSize: 16,
  },
  signOut: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
  },
  signOutText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
