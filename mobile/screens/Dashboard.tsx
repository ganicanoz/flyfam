import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { formatFlightTimeLocal, getLocalDateString } from '../lib/dateUtils';
import { colors } from '../theme/colors';

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

export default function Dashboard() {
  const { profile, signOut } = useSession();
  const [flights, setFlights] = useState<FlightWithCrew[]>([]);
  const [invitationCount, setInvitationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<any>();

  const fetchInvitationCount = async () => {
    const { count } = await supabase
      .from('crew_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    setInvitationCount(count ?? 0);
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchInvitationCount();
    }, [])
  );

  useEffect(() => {
    const userId = profile?.id;
    if (!userId) {
      setLoading(false);
      return;
    }
    const fetchFlights = async () => {
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
      if (error) console.error(error);
      else setFlights(data ?? []);
      setLoading(false);
    };
    fetchFlights();
  }, [profile?.id]);

  const formatTime = formatFlightTimeLocal;
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const crewLabel = (f: FlightWithCrew) => f.crew_profiles?.company_name ?? 'Crew';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Flights from your linked crew members</Text>

      {invitationCount > 0 && (
        <TouchableOpacity
          style={styles.invitationBanner}
          onPress={() => navigation.navigate('Connect')}
        >
          <Text style={styles.invitationBannerText}>
            You have {invitationCount} invitation{invitationCount > 1 ? 's' : ''} — tap to view
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.connectButton} onPress={() => navigation.navigate('Connect')}>
        <Text style={styles.connectButtonText}>View invitations / Connect to crew</Text>
      </TouchableOpacity>

      {loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>Loading...</Text>
      ) : flights.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          No upcoming flights. Connect to a crew member to see their roster.
        </Text>
      ) : (
        <FlatList
          data={flights}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDate(item.flight_date)}</Text>
              <Text style={[styles.crew, { color: colors.primary }]}>{crewLabel(item)}</Text>
              <Text style={[styles.route, { color: colors.text }]}>
                {item.flight_number} · {item.origin_airport || '—'} → {item.destination_airport || '—'}
              </Text>
              <Text style={[styles.times, { color: colors.textMuted }]}>
                {formatTime(item.actual_departure ?? item.scheduled_departure)} – {formatTime(item.actual_arrival ?? item.scheduled_arrival)}
              </Text>
            </View>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.signOut}
        onPress={() =>
          Alert.alert('Sign out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOut },
          ])
        }
      >
        <Text style={[styles.signOutText, { color: colors.textMuted }]}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  subtitle: { fontSize: 14, marginBottom: 16 },
  invitationBanner: {
    backgroundColor: colors.primaryLight,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  invitationBannerText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
  connectButton: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 24 },
  connectButtonText: { color: colors.white, fontWeight: '600' },
  list: { paddingBottom: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  date: { fontSize: 12, marginBottom: 4 },
  crew: { fontSize: 12, marginBottom: 4 },
  route: { fontSize: 16, fontWeight: '600' },
  times: { fontSize: 14, marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 16 },
  signOut: { position: 'absolute', bottom: 24, alignSelf: 'center' },
  signOutText: { fontSize: 14 },
});
