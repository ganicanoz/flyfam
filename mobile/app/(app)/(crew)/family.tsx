import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';

type Connection = {
  id: string;
  family_id: string;
  status: string;
  family?: { full_name: string | null } | null;
};

export default function Family() {
  const { crewProfile } = useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeLoading, setCodeLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!crewProfile?.id) return;

    const fetchConnections = async () => {
      const { data, error } = await supabase
        .from('family_connections')
        .select('id, family_id, status, family:profiles!family_id(full_name)')
        .eq('crew_id', crewProfile.id);

      if (error) {
        console.error(error);
      } else {
        setConnections(data ?? []);
      }
      setLoading(false);
    };

    fetchConnections();
  }, [crewProfile?.id]);

  const generateCode = async () => {
    setCodeLoading(true);
    const { data, error } = await supabase.rpc('generate_invite_code', {
      p_expires_hours: 168,
    });
    setCodeLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setInviteCode(data);
  };

  const approveConnection = async (id: string) => {
    const { error } = await supabase.rpc('approve_connection', {
      p_connection_id: id,
    });
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setConnections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'approved' } : c))
    );
  };

  const pending = connections.filter((c) => c.status === 'pending');
  const approved = connections.filter((c) => c.status === 'approved');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Family connections</Text>

      <TouchableOpacity
        style={styles.codeButton}
        onPress={generateCode}
        disabled={codeLoading}
      >
        {codeLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.codeButtonText}>Generate invite code</Text>
        )}
      </TouchableOpacity>

      {inviteCode && (
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Share this code with family:</Text>
          <Text style={styles.code}>{inviteCode}</Text>
        </View>
      )}

      {pending.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending</Text>
          {pending.map((c) => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.name}>
                {c.family?.full_name ?? 'Family member'}
              </Text>
              <TouchableOpacity
                style={styles.approveBtn}
                onPress={() => approveConnection(c.id)}
              >
                <Text style={styles.approveBtnText}>Approve</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authorized</Text>
        {loading ? (
          <ActivityIndicator color="#22c55e" />
        ) : approved.length === 0 ? (
          <Text style={styles.empty}>No family members yet</Text>
        ) : (
          approved.map((c) => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.name}>
                {c.family?.full_name ?? 'Family member'}
              </Text>
              <Text style={styles.badge}>✓</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 24,
  },
  codeButton: {
    backgroundColor: '#22c55e',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  codeButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  codeBox: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  codeLabel: {
    color: '#a1a1aa',
    fontSize: 12,
    marginBottom: 4,
  },
  code: {
    color: '#22c55e',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#a1a1aa',
    fontSize: 14,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    color: '#fff',
    fontSize: 16,
  },
  approveBtn: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  badge: {
    color: '#22c55e',
    fontSize: 18,
  },
  empty: {
    color: '#71717a',
    fontSize: 14,
  },
});
