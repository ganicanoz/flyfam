import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '@/lib/subscriptionAccess';

type Connection = {
  id: string;
  family_id: string;
  status: string;
  family?: { full_name: string | null } | null;
};

export default function Family() {
  const { t } = useTranslation();
  const { crewProfile } = useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeLoading, setCodeLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);

  useEffect(() => {
    if (!crewProfile?.id) return;

    const fetchConnections = async () => {
      const [connRes, accessRes] = await Promise.all([
        supabase
          .from('family_connections')
          .select('id, family_id, status, family:profiles!family_id(full_name)')
          .eq('crew_id', crewProfile.id),
        fetchMySubscriptionAccess().catch(() => null),
      ]);

      if (connRes.error) {
        console.error(connRes.error);
      } else {
        setConnections(connRes.data ?? []);
      }
      setAccess(accessRes);
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
    const latest = await fetchMySubscriptionAccess().catch(() => null);
    if (latest) setAccess(latest);
  };

  const approveConnection = async (id: string) => {
    const { error } = await supabase.rpc('approve_connection', {
      p_connection_id: id,
    });
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    setConnections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'approved' } : c))
    );
    const latest = await fetchMySubscriptionAccess().catch(() => null);
    if (latest) setAccess(latest);
  };

  const removeConnection = (id: string, name: string) => {
    Alert.alert(
      t('family.removeConfirmTitle'),
      t('family.removeConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('family.removeMember'),
          style: 'destructive',
          onPress: async () => {
            setRemovingId(id);
            const { error } = await supabase
              .from('family_connections')
              .delete()
              .eq('id', id)
              .eq('crew_id', crewProfile!.id);
            setRemovingId(null);
            if (error) {
              Alert.alert(t('common.error'), error.message);
              return;
            }
            setConnections((prev) => prev.filter((c) => c.id !== id));
            const latest = await fetchMySubscriptionAccess().catch(() => null);
            if (latest) setAccess(latest);
          },
        },
      ]
    );
  };

  const pending = connections.filter((c) => c.status === 'pending');
  const approved = connections.filter((c) => c.status === 'approved');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('nav.family')}</Text>

      <View style={styles.planBox}>
        <Text style={styles.planTitle}>Paket</Text>
        <Text style={styles.planText}>{access?.plan_title ?? 'Plan secilmedi'}</Text>
        <Text style={styles.planText}>
          Slot: {access?.used_family_approved ?? 0}/{access?.max_family_members ?? 0} (onayli)
        </Text>
        <Text style={styles.planHint}>
          {access?.has_access
            ? `Kalan slot: ${Math.max(access?.available_family_slots ?? 0, 0)}`
            : 'Aile daveti icin once aktif/deneme bir plan secmelisiniz.'}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.codeButton}
        onPress={generateCode}
        disabled={codeLoading || !access?.can_invite_more}
      >
        {codeLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.codeButtonText}>{t('family.generateInviteCode')}</Text>
        )}
      </TouchableOpacity>
      {!access?.can_invite_more && (
        <Text style={styles.limitInfo}>Bu paket icin davet limiti dolu. Daha buyuk bir paket secin.</Text>
      )}

      {inviteCode && (
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>{t('family.shareCode')}</Text>
          <Text style={styles.code}>{inviteCode}</Text>
        </View>
      )}

      {pending.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('family.pending')}</Text>
          {pending.map((c) => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.name}>
                {c.family?.full_name ?? t('family.familyMember')}
              </Text>
              <TouchableOpacity
                style={styles.approveBtn}
                onPress={() => approveConnection(c.id)}
              >
                <Text style={styles.approveBtnText}>{t('family.approve')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('family.authorized')}</Text>
        {loading ? (
          <ActivityIndicator color="#22c55e" />
        ) : approved.length === 0 ? (
          <Text style={styles.empty}>{t('family.noFamilyMembers')}</Text>
        ) : (
          approved.map((c) => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.name}>
                {c.family?.full_name ?? t('family.familyMember')}
              </Text>
              <View style={styles.cardRight}>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => removeConnection(c.id, c.family?.full_name ?? '')}
                  disabled={removingId === c.id}
                >
                  {removingId === c.id ? (
                    <ActivityIndicator color="#ef4444" size="small" />
                  ) : (
                    <Text style={styles.removeBtnText}>{t('family.removeMember')}</Text>
                  )}
                </TouchableOpacity>
              </View>
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
  limitInfo: {
    color: '#fca5a5',
    marginTop: -8,
    marginBottom: 12,
    fontSize: 12,
  },
  planBox: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
    marginBottom: 12,
  },
  planTitle: {
    color: '#a1a1aa',
    fontSize: 12,
    marginBottom: 4,
  },
  planText: {
    color: '#e4e4e7',
    fontSize: 13,
    marginBottom: 2,
  },
  planHint: {
    color: '#22c55e',
    fontSize: 12,
    marginTop: 2,
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
    flex: 1,
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  removeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  removeBtnText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 14,
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
  empty: {
    color: '#71717a',
    fontSize: 14,
  },
});
