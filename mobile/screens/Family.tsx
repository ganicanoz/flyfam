import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { getPushTokenWithReason, savePushTokenToSupabase, scheduleLocalTestNotification } from '../lib/pushNotifications';
import { colors } from '../theme/colors';

type Connection = {
  id: string;
  family_id: string;
  crew_id: string;
  status: string;
  other_name: string | null;
};

export default function Family() {
  const { profile, crewProfile } = useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendLoading, setSendLoading] = useState(false);
  const [invitationCount, setInvitationCount] = useState(0);
  const [testLoading, setTestLoading] = useState(false);
  const navigation = useNavigation<any>();
  const isCrew = profile?.role === 'crew';

  useEffect(() => {
    if (!profile?.id && !crewProfile?.id) {
      setLoading(false);
      return;
    }
    supabase
      .rpc('get_family_connections_with_names')
      .then(({ data, error }) => {
        if (error) console.warn('[Family] connections error:', error.message);
        const list = (data ?? []).map((row: { id: string; family_id: string; crew_id: string; status: string; other_name: string | null }) => ({
          id: row.id,
          family_id: row.family_id,
          crew_id: row.crew_id,
          status: row.status,
          other_name: row.other_name ?? null,
        }));
        setConnections(list);
        setLoading(false);
      });
  }, [profile?.id, crewProfile?.id]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      if (isCrew) return () => {};
      supabase
        .from('crew_invitations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count }) => {
          if (!cancelled) setInvitationCount(count ?? 0);
        });
      return () => {
        cancelled = true;
      };
    }, [isCrew, profile?.id])
  );

  const sendInvitation = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert('Error', "Please enter family member's email");
      return;
    }
    setSendLoading(true);
    const { error } = await supabase.rpc('send_crew_invitation', { p_family_email: trimmed });
    setSendLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    Alert.alert('Invitation sent', `${trimmed} will see your invitation in the app and can accept or decline.`);
    setEmail('');
  };

  const approveConnection = async (id: string) => {
    const { error } = await supabase.rpc('approve_connection', { p_connection_id: id });
    if (error) Alert.alert('Error', error.message);
    else setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'approved' } : c)));
  };

  const sendTestNotification = async () => {
    if (isCrew || !profile?.id) return;
    setTestLoading(true);
    try {
      // 1) Get a push token (device "address") and save it.
      const tokenRes = await getPushTokenWithReason();
      const token = tokenRes.token;
      if (!token) {
        // Simulator fallback: show a local notification so user can still verify UI/permissions.
        if ((tokenRes.reason ?? '').toLowerCase().includes('not simulator')) {
          try {
            await scheduleLocalTestNotification();
            Alert.alert(
              'Local test sent',
              'You are on iOS Simulator, so real push cannot work. I sent a LOCAL test notification instead.'
            );
          } catch (e: any) {
            Alert.alert('Notifications not available', tokenRes.reason ?? String(e?.message ?? e ?? 'Unknown error'));
          }
          return;
        }
        Alert.alert(
          'Notifications not available',
          tokenRes.reason ??
            "We couldn't get a push token. Please allow notifications for FlyFam and try again. If you're on iOS Simulator, push won't work (needs a real device)."
        );
        return;
      }
      await savePushTokenToSupabase(profile.id, token);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Error', 'Please sign in again and retry.');
        return;
      }
      // 2) Try full pipeline via Supabase Edge Function (preferred).
      const { data, error } = await supabase.functions.invoke('notify-family', {
        body: { type: 'test' },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        const status = (error as any)?.context?.status;
        const hint = status ? ` (HTTP ${status})` : '';
        console.warn('[TestPush] notify-family failed', { message: error.message, status, context: (error as any)?.context ?? null });
        // Fallback: send directly via Expo Push API so you can still verify notifications end-to-end on device.
        try {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ to: token, title: 'FlyFam', body: 'Test notification', sound: 'default' }]),
          });
          if (!res.ok) {
            const t = await res.text().catch(() => '');
            Alert.alert('Error', `Test failed${hint}. Also failed direct Expo send. ${t || error.message}`);
            return;
          }
          Alert.alert(
            'Test sent',
            `Sent directly via Expo (fallback)${hint}. If it arrives, notifications work; we just need to deploy/fix the Edge Function.`
          );
          return;
        } catch (e: any) {
          Alert.alert('Error', `Test failed${hint}. ${error.message}`);
          return;
        }
      }
      const sent = (data as any)?.sent ?? 0;
      if (!sent) {
        Alert.alert(
          'Test sent (0 devices)',
          "No device token was found. Make sure you allowed notifications and try again. If you're using Expo Go, push may be limited — a development build works best."
        );
        return;
      }
      Alert.alert('Test sent', `Notification sent to ${sent} device(s). It may take 5–20 seconds to arrive.`);
    } finally {
      setTestLoading(false);
    }
  };

  const pending = connections.filter((c) => c.status === 'pending');
  const approved = connections.filter((c) => c.status === 'approved');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {isCrew && (
          <View style={styles.inviteSection}>
            <Text style={[styles.inviteTitle, { color: colors.text }]}>Invite family by email</Text>
            <Text style={[styles.inviteHint, { color: colors.textSecondary }]}>
              They'll receive an invitation in the app and can accept or decline
            </Text>
            <TextInput
              style={styles.input}
              placeholder="family@example.com"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!sendLoading}
            />
            <TouchableOpacity
              style={[styles.inviteButton, sendLoading && styles.buttonDisabled]}
              onPress={sendInvitation}
              disabled={sendLoading}
            >
              {sendLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.inviteButtonText}>Send invitation</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!isCrew && (
          <>
            {invitationCount > 0 && (
              <TouchableOpacity style={styles.invitationBanner} onPress={() => navigation.navigate('Connect')}>
                <Text style={styles.invitationBannerText}>
                  You have {invitationCount} invitation{invitationCount > 1 ? 's' : ''} — tap to view
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.connectButton} onPress={() => navigation.navigate('Connect')}>
              <Text style={styles.connectButtonText}>View invitations / Connect to crew</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.testButton, testLoading && styles.buttonDisabled]}
              onPress={sendTestNotification}
              disabled={testLoading}
            >
              {testLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.testButtonText}>Send test notification</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {isCrew && pending.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Pending approval</Text>
            {pending.map((c) => (
              <View key={c.id} style={styles.card}>
                <Text style={[styles.name, { color: colors.text }]}>{c.other_name ?? 'Family member'}</Text>
                <TouchableOpacity style={styles.approveBtn} onPress={() => approveConnection(c.id)}>
                  <Text style={styles.approveBtnText}>Approve</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {isCrew ? 'Connected' : 'Your crew connections'}
          </Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : approved.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>
              {isCrew ? 'No family members yet' : 'No crew connections yet. Accept an invitation to get started.'}
            </Text>
          ) : (
            approved.map((c) => (
              <View key={c.id} style={styles.card}>
                <Text style={[styles.name, { color: colors.text }]}>
                  {c.other_name ?? (isCrew ? 'Family member' : 'Crew')}
                </Text>
                {isCrew && <Text style={[styles.badge, { color: colors.success }]}>✓</Text>}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 48 },
  inviteSection: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inviteTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  inviteHint: { fontSize: 13, marginBottom: 16 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inviteButton: { backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: 'center' },
  inviteButtonText: { color: colors.white, fontWeight: '600' },
  buttonDisabled: { opacity: 0.7 },
  invitationBanner: { backgroundColor: colors.primaryLight, padding: 14, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: colors.primary },
  invitationBannerText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
  connectButton: { backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 24 },
  connectButtonText: { color: colors.white, fontWeight: '600' },
  testButton: { backgroundColor: colors.accent, padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 24 },
  testButtonText: { color: colors.white, fontWeight: '700' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, marginBottom: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { fontSize: 16 },
  approveBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  approveBtnText: { color: colors.white, fontWeight: '600', fontSize: 14 },
  badge: { fontSize: 18 },
  empty: { fontSize: 14 },
});
