import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSession } from '../contexts/SessionContext';
import { colors } from '../theme/colors';
import { AIRLINES } from '../constants/airlines';

export default function Profile() {
  const { profile, crewProfile, session, signOut } = useSession();

  const airlineName =
    crewProfile?.airline_icao
      ? AIRLINES.find((a) => a.icao === crewProfile.airline_icao)?.name ?? crewProfile.company_name
      : crewProfile?.company_name ?? null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.card}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
        <Text style={[styles.value, { color: colors.text }]}>{profile?.full_name ?? '—'}</Text>

        {session?.user?.email && (
          <>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <Text style={[styles.value, { color: colors.text }]}>{session.user.email}</Text>
          </>
        )}

        {crewProfile && (
          <>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Airline</Text>
            <Text style={[styles.value, { color: colors.text }]}>
              {airlineName ?? 'Not set'}
            </Text>
            {crewProfile.airline_icao && (
              <Text style={[styles.icao, { color: colors.textMuted }]}>
                ICAO: {crewProfile.airline_icao}
              </Text>
            )}
          </>
        )}

        <Text style={[styles.label, { color: colors.textSecondary }]}>Account type</Text>
        <Text style={[styles.value, { color: colors.text }]}>
          {profile?.role === 'crew' ? 'Crew' : 'Family'}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.signOut}
        onPress={() =>
          Alert.alert('Sign out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOut },
          ])
        }
      >
        <Text style={[styles.signOutText, { color: colors.error }]}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: 12, marginBottom: 4, marginTop: 16 },
  value: { fontSize: 16 },
  icao: { fontSize: 12, marginTop: 2 },
  signOut: { marginTop: 32, padding: 16, alignItems: 'center' },
  signOutText: { fontSize: 16, fontWeight: '600' },
});
