import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import { formatFlightTimeLocal } from '@/lib/dateUtils';
import { colors } from '@/theme/colors';

type Flight = {
  id: string;
  flight_number: string;
  origin_airport: string | null;
  destination_airport: string | null;
  flight_date: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
};

export default function Roster() {
  const { profile, crewProfile, signOut } = useSession();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchFlights = useCallback(async () => {
    if (!crewProfile?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('flights')
      .select('id, flight_number, origin_airport, destination_airport, flight_date, scheduled_departure, scheduled_arrival')
      .eq('crew_id', crewProfile.id)
      .order('flight_date', { ascending: true });

    if (error) {
      console.error(error);
      setFlights([]);
      setLoading(false);
      return;
    }
    setFlights(data ?? []);
    setLoading(false);
  }, [crewProfile?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchFlights();
      return () => {};
    }, [fetchFlights])
  );

  const formatTime = formatFlightTimeLocal;

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Roster</Text>
        <Text style={styles.subtitle}>{crewProfile?.company_name ?? 'Crew'}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/(app)/(crew)/add-flight')}
          >
            <Text style={styles.addButtonText}>Add Flight</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => router.push('/(app)/(crew)/family')}
          >
            <Text style={styles.menuButtonText}>Family</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <Text style={styles.empty}>Loading...</Text>
      ) : flights.length === 0 ? (
        <Text style={styles.empty}>No flights yet. Add your first flight.</Text>
      ) : (
        <FlatList
          data={flights}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.date}>{formatDate(item.flight_date)}</Text>
              <Text style={styles.route}>
                {item.flight_number} · {item.origin_airport || '—'} → {item.destination_airport || '—'}
              </Text>
              <Text style={styles.times}>
                {formatTime(item.scheduled_departure)} – {formatTime(item.scheduled_arrival)}
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
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  menuButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuButtonText: {
    color: colors.text,
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
