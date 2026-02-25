import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';

type Invitation = {
  id: string;
  crew_id: string;
  family_email: string;
  status: string;
  crew_profiles: {
    company_name: string | null;
  } | null;
};

export default function Connect() {
  const { profile } = useSession();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const navigation = useNavigation<any>();

  useEffect(() => {
    const fetchInvitations = async () => {
      const { data, error } = await supabase
        .from('crew_invitations')
        .select('id, crew_id, family_email, status, crew_profiles(company_name)')
        .eq('status', 'pending');
      if (error) {
        console.error(error);
        setInvitations([]);
      } else {
        setInvitations(data ?? []);
      }
      setLoading(false);
    };
    fetchInvitations();
  }, []);

  const accept = async (id: string) => {
    setResponding(id);
    const { error } = await supabase.rpc('accept_crew_invitation', { p_invitation_id: id });
    setResponding(null);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setInvitations((prev) => prev.filter((i) => i.id !== id));
    Alert.alert('Connected!', 'You can now see their flights.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
  };

  const decline = async (id: string) => {
    setResponding(id);
    const { error } = await supabase.rpc('decline_crew_invitation', { p_invitation_id: id });
    setResponding(null);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setInvitations((prev) => prev.filter((i) => i.id !== id));
  };

  const crewLabel = (inv: Invitation) => inv.crew_profiles?.company_name ?? 'Crew member';

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>Invitations</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Crew members can invite you by email. Accept to see their flights.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
      ) : invitations.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No pending invitations</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            When a crew member sends you an invitation, it will appear here. Make sure they have your correct email.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {invitations.map((inv) => (
            <View key={inv.id} style={styles.card}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{crewLabel(inv)}</Text>
              <Text style={[styles.cardEmail, { color: colors.textMuted }]}>invited {inv.family_email}</Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.declineBtn, responding === inv.id && styles.buttonDisabled]}
                  onPress={() => decline(inv.id)}
                  disabled={!!responding}
                >
                  <Text style={[styles.declineBtnText, { color: colors.textSecondary }]}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.acceptBtn, responding === inv.id && styles.buttonDisabled]}
                  onPress={() => accept(inv.id)}
                  disabled={!!responding}
                >
                  {responding === inv.id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.acceptBtnText}>Accept</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={[styles.backBtnText, { color: colors.primary }]}>Back to roster</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 15, marginBottom: 24 },
  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyText: { fontSize: 14, lineHeight: 22 },
  list: { gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  cardEmail: { fontSize: 13, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  declineBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  declineBtnText: { fontWeight: '600' },
  acceptBtn: { flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 10, alignItems: 'center' },
  acceptBtnText: { color: colors.white, fontWeight: '600' },
  buttonDisabled: { opacity: 0.7 },
  backBtn: { marginTop: 24, alignItems: 'center' },
  backBtnText: { fontSize: 15, fontWeight: '600' },
});
