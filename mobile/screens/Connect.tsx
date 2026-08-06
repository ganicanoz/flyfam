import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors, useThemeMode } from '../theme/colors';

type Invitation = {
  id: string;
  crew_id: string;
  family_email: string;
  status: string;
  crew_profiles: {
    company_name: string | null;
  } | null;
};

/** Legacy stack screen — Family tab now hosts inline invites; keep for deep links / old nav. */
export default function Connect() {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
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
        setInvitations((data ?? []) as Invitation[]);
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
      Alert.alert(t('common.error'), error.message);
      return;
    }
    setInvitations((prev) => prev.filter((i) => i.id !== id));
    Alert.alert(
      t('connect.connected'),
      `${t('connect.connectedMessage')}\n\n${t('connect.subscriptionNotice')}`,
      [{ text: t('common.ok'), onPress: () => navigation.goBack() }],
    );
  };

  const decline = async (id: string) => {
    setResponding(id);
    const { error } = await supabase.rpc('decline_crew_invitation', { p_invitation_id: id });
    setResponding(null);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    setInvitations((prev) => prev.filter((i) => i.id !== id));
  };

  const crewLabel = (inv: Invitation) => inv.crew_profiles?.company_name ?? t('connect.crewMember');

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: colors.text }]}>{t('connect.title')}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('connect.subtitle')}</Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
      ) : invitations.length === 0 ? (
        <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('connect.noPending')}</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('connect.noPendingHint')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {invitations.map((inv) => (
            <View
              key={inv.id}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.cardTitle, { color: colors.text }]}>{crewLabel(inv)}</Text>
              <Text style={[styles.cardEmail, { color: colors.textSecondary }]}>
                {t('connect.invited')} {inv.family_email}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.declineBtn, { borderColor: colors.border }, responding === inv.id && styles.buttonDisabled]}
                  onPress={() => decline(inv.id)}
                  disabled={!!responding}
                >
                  <Text style={[styles.declineBtnText, { color: colors.text }]}>{t('connect.decline')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.acceptBtn, { backgroundColor: colors.primary }, responding === inv.id && styles.buttonDisabled]}
                  onPress={() => accept(inv.id)}
                  disabled={!!responding}
                >
                  {responding === inv.id ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={[styles.acceptBtnText, { color: colors.onPrimary }]}>{t('connect.accept')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function createStyles() {
  return StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 24, paddingBottom: 48 },
    title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
    subtitle: { fontSize: 15, marginBottom: 24, lineHeight: 22 },
    emptyBox: {
      borderRadius: 12,
      padding: 24,
      borderWidth: 1,
    },
    emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
    emptyText: { fontSize: 14, lineHeight: 22 },
    list: { gap: 12 },
    card: {
      borderRadius: 12,
      padding: 20,
      borderWidth: 1,
    },
    cardTitle: { fontSize: 17, fontWeight: '600' },
    cardEmail: { fontSize: 13, marginTop: 4 },
    actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
    declineBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    declineBtnText: { fontWeight: '700' },
    acceptBtn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
    acceptBtnText: { fontWeight: '700' },
    buttonDisabled: { opacity: 0.7 },
  });
}
