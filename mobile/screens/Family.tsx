import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Image,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { getPushTokenWithReason, registerPushTokenForFamilyUser } from '../lib/pushNotifications';
import { colors, useThemeMode } from '../theme/colors';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';

type Connection = {
  id: string;
  family_id: string;
  crew_id: string;
  status: string;
  other_name: string | null;
  other_avatar_url?: string | null;
};

type PendingInvite = {
  id: string;
  crew_id: string;
  family_email: string;
  crew_name: string | null;
};

export default function Family() {
  const { t } = useTranslation();
  const { profile, crewProfile } = useSession();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createFamilyStyles(), [themeMode]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendLoading, setSendLoading] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [inviteResponding, setInviteResponding] = useState<string | null>(null);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);
  const [pushStatus, setPushStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [pushError, setPushError] = useState<string | null>(null);
  const isCrew = profile?.role === 'crew';

  const loadConnections = useCallback(async () => {
    if (!profile?.id && !crewProfile?.id) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('get_family_connections_with_names');
    if (error) console.warn('[Family] connections error:', error.message);
    const list = (data ?? []).map(
      (row: {
        id: string;
        family_id: string;
        crew_id: string;
        status: string;
        other_name: string | null;
        other_avatar_url?: string | null;
      }) => ({
        id: row.id,
        family_id: row.family_id,
        crew_id: row.crew_id,
        status: row.status,
        other_name: row.other_name ?? null,
        other_avatar_url: row.other_avatar_url ?? null,
      }),
    );
    setConnections(list);
    setLoading(false);
  }, [profile?.id, crewProfile?.id]);

  const loadPendingInvites = useCallback(async () => {
    if (isCrew) {
      setPendingInvites([]);
      return;
    }
    const { data, error } = await supabase
      .from('crew_invitations')
      .select('id, crew_id, family_email, status, crew_profiles(company_name)')
      .eq('status', 'pending');
    if (error) {
      console.warn('[Family] invites error:', error.message);
      setPendingInvites([]);
      return;
    }
    setPendingInvites(
      (data ?? []).map((row: any) => ({
        id: row.id,
        crew_id: row.crew_id,
        family_email: row.family_email,
        crew_name: row.crew_profiles?.company_name ?? null,
      })),
    );
  }, [isCrew]);

  const checkPushStatus = useCallback(async () => {
    if (isCrew) return;
    setPushStatus('checking');
    setPushError(null);
    const res = await getPushTokenWithReason();
    if (res.token) {
      setPushStatus('ok');
      if (profile?.id) registerPushTokenForFamilyUser(profile.id).catch(() => {});
    } else {
      setPushStatus('error');
      setPushError(res.reason ?? 'Unknown');
    }
  }, [isCrew, profile?.id]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([loadConnections(), loadPendingInvites()]).finally(() => {
        if (!cancelled) setLoading(false);
      });
      if (!isCrew && profile?.id) {
        registerPushTokenForFamilyUser(profile.id).catch(() => {});
        checkPushStatus();
      }
      if (isCrew) {
        fetchMySubscriptionAccess()
          .then((x) => {
            if (!cancelled) setAccess(x);
          })
          .catch(() => {
            if (!cancelled) setAccess(null);
          });
      }
      return () => {
        cancelled = true;
      };
    }, [loadConnections, loadPendingInvites, isCrew, profile?.id, checkPushStatus]),
  );

  useEffect(() => {
    if (!isCrew) return;
    fetchMySubscriptionAccess()
      .then((x) => setAccess(x))
      .catch(() => setAccess(null));
  }, [isCrew]);

  const sendInvitation = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('family.errorEnterEmail'));
      return;
    }
    setSendLoading(true);
    const { error } = await supabase.rpc('send_crew_invitation', { p_family_email: trimmed });
    setSendLoading(false);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    Alert.alert(t('family.invitationSent'), t('family.invitationSentMessage', { email: trimmed }));
    setEmail('');
  };

  const approveConnection = async (id: string) => {
    const { error } = await supabase.rpc('approve_connection', { p_connection_id: id });
    if (error) Alert.alert(t('common.error'), error.message);
    else setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'approved' } : c)));
  };

  const removeConnection = (id: string, asFamilyLeave: boolean) => {
    Alert.alert(
      asFamilyLeave ? t('family.leaveConfirmTitle') : t('family.removeConfirmTitle'),
      asFamilyLeave ? t('family.leaveConfirmMessage') : t('family.removeConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: asFamilyLeave ? t('family.leaveConnection') : t('family.removeMember'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('remove_connection', { p_connection_id: id });
            if (error) {
              Alert.alert(t('common.error'), error.message);
              return;
            }
            setConnections((prev) => prev.filter((x) => x.id !== id));
            if (isCrew) {
              const latest = await fetchMySubscriptionAccess().catch(() => null);
              if (latest) setAccess(latest);
            }
          },
        },
      ],
    );
  };

  const acceptInvite = async (id: string) => {
    setInviteResponding(id);
    const { error } = await supabase.rpc('accept_crew_invitation', { p_invitation_id: id });
    setInviteResponding(null);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    setPendingInvites((prev) => prev.filter((i) => i.id !== id));
    await loadConnections();
    Alert.alert(t('connect.connected'), `${t('connect.connectedMessage')}\n\n${t('connect.subscriptionNotice')}`);
  };

  const declineInvite = async (id: string) => {
    setInviteResponding(id);
    const { error } = await supabase.rpc('decline_crew_invitation', { p_invitation_id: id });
    setInviteResponding(null);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    setPendingInvites((prev) => prev.filter((i) => i.id !== id));
  };

  const pending = connections.filter((c) => c.status === 'pending');
  const approved = connections.filter((c) => c.status === 'approved');
  const totalFamilyRights = isCrew ? Math.max(access?.max_family_members ?? 0, approved.length) : 0;
  const emptyFamilyRights = isCrew ? Math.max(totalFamilyRights - approved.length, 0) : 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {isCrew && (
          <View style={[styles.inviteSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.inviteTitle, { color: colors.text }]}>{t('family.inviteTitle')}</Text>
            <Text style={[styles.inviteHint, { color: colors.textSecondary }]}>{t('family.inviteHint')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder={t('family.emailPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!sendLoading}
            />
            <TouchableOpacity
              style={[styles.inviteButton, { backgroundColor: colors.primary }, sendLoading && styles.buttonDisabled]}
              onPress={sendInvitation}
              disabled={sendLoading || !access?.can_invite_more || !access?.has_access}
            >
              {sendLoading ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <Text style={styles.inviteButtonText}>{t('family.sendInvitation')}</Text>
              )}
            </TouchableOpacity>
            {!access?.has_access && (
              <Text style={[styles.limitText, { color: colors.textSecondary }]}>
                {t('family.planRequiredToInvite')}
              </Text>
            )}
            {access?.has_access && !access?.can_invite_more && (
              <Text style={[styles.limitText, { color: colors.textSecondary }]}>
                {t('family.planLimitReached')}
              </Text>
            )}
          </View>
        )}

        {!isCrew && (
          <>
            <View style={[styles.pushStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.pushStatusTitle, { color: colors.text }]}>
                  {pushStatus === 'checking'
                    ? t('family.pushChecking')
                    : pushStatus === 'ok'
                      ? t('family.pushEnabled')
                      : t('family.pushDisabled')}
                </Text>
                {pushStatus === 'error' && pushError && (
                  <Text style={[styles.pushStatusError, { color: colors.textSecondary }]}>{pushError}</Text>
                )}
              </View>
              {pushStatus !== 'checking' && (
                <TouchableOpacity style={[styles.pushStatusButton, { backgroundColor: colors.primary }]} onPress={checkPushStatus}>
                  <Text style={styles.pushStatusButtonText}>{t('family.refresh')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {pendingInvites.length > 0 && (
              <View style={[styles.inviteAnnounce, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Text style={[styles.inviteAnnounceTitle, { color: colors.text }]}>
                  {t('family.pendingInvitesTitle')} · {t('family.invitationsCount', { count: pendingInvites.length })}
                </Text>
                {pendingInvites.map((inv) => (
                  <View
                    key={inv.id}
                    style={[styles.inviteCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <Text style={[styles.name, { color: colors.text }]}>
                      {inv.crew_name ?? t('connect.crewMember')}
                    </Text>
                    <Text style={[styles.inviteEmail, { color: colors.textSecondary }]}>
                      {t('connect.invited')} {inv.family_email}
                    </Text>
                    <View style={styles.inviteActions}>
                      <TouchableOpacity
                        style={[styles.declineBtn, { borderColor: colors.border }]}
                        onPress={() => declineInvite(inv.id)}
                        disabled={!!inviteResponding}
                      >
                        <Text style={[styles.declineBtnText, { color: colors.text }]}>{t('family.declineInvite')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.acceptBtn, { backgroundColor: colors.primary }]}
                        onPress={() => acceptInvite(inv.id)}
                        disabled={!!inviteResponding}
                      >
                        {inviteResponding === inv.id ? (
                          <ActivityIndicator color={colors.onPrimary} size="small" />
                        ) : (
                          <Text style={styles.acceptBtnText}>{t('family.acceptInvite')}</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {isCrew && pending.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('family.pendingApproval')}</Text>
            {pending.map((c) => (
              <View key={c.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.name, { color: colors.text }]}>{c.other_name ?? t('family.familyMember')}</Text>
                <TouchableOpacity style={[styles.approveBtn, { backgroundColor: colors.primary }]} onPress={() => approveConnection(c.id)}>
                  <Text style={styles.approveBtnText}>{t('family.approve')}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {isCrew ? t('family.connectedSwipeHint') : t('family.connectedSwipeHintFamily')}
          </Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : approved.length === 0 && !isCrew ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>{t('family.noConnectionsYet')}</Text>
          ) : approved.length === 0 && isCrew ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>{t('family.noFamilyYet')}</Text>
          ) : (
            <>
              {approved.map((c) => {
                const cardInner = (
                  <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.name, { color: colors.text }]}>
                      {c.other_name ?? (isCrew ? t('family.familyMember') : t('family.crewMember'))}
                    </Text>
                    <View style={styles.avatarAndBadge}>
                      {c.other_avatar_url ? (
                        <Image
                          key={c.other_avatar_url}
                          source={{ uri: c.other_avatar_url }}
                          style={styles.avatarSmall}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={[styles.avatarSmallFallback, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                          <Text style={[styles.avatarSmallInitial, { color: colors.primary }]}>
                            {(c.other_name ?? (isCrew ? t('family.familyMember') : t('family.crewMember')))
                              .trim()
                              .charAt(0)
                              .toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );

                const renderRightActions = () => (
                  <View style={styles.swipeActionsRow}>
                    <TouchableOpacity
                      style={styles.swipeDelete}
                      onPress={() => removeConnection(c.id, !isCrew)}
                    >
                      <Text style={styles.swipeDeleteText}>
                        {isCrew ? t('family.removeMember') : t('family.leaveConnection')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );

                return (
                  <Swipeable key={c.id} renderRightActions={renderRightActions} overshootRight={false}>
                    {cardInner}
                  </Swipeable>
                );
              })}
              {isCrew &&
                Array.from({ length: emptyFamilyRights }).map((_, idx) => (
                  <View
                    key={`empty-slot-${idx}`}
                    style={[styles.card, styles.emptyFamilyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <Text style={[styles.emptyFamilyText, { color: colors.textMuted }]}>{t('family.emptyFamilyPlaceholder')}</Text>
                  </View>
                ))}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createFamilyStyles() {
  return StyleSheet.create({
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
    inviteButtonText: { color: colors.onPrimary, fontWeight: '600' },
    limitText: { fontSize: 12, marginTop: 8, lineHeight: 18 },
    buttonDisabled: { opacity: 0.7 },
    inviteAnnounce: {
      borderRadius: 12,
      padding: 14,
      marginBottom: 16,
      borderWidth: 1,
      gap: 10,
    },
    inviteAnnounceTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
    inviteCard: {
      borderRadius: 10,
      padding: 14,
      borderWidth: 1,
    },
    inviteEmail: { fontSize: 13, marginTop: 4 },
    inviteActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    declineBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    declineBtnText: { fontWeight: '700' },
    acceptBtn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
    acceptBtnText: { color: colors.onPrimary, fontWeight: '700' },
    pushStatusCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: 12,
      padding: 14,
      marginBottom: 16,
      borderWidth: 1,
    },
    pushStatusTitle: { fontSize: 15, fontWeight: '600' },
    pushStatusError: { fontSize: 12, marginTop: 4, lineHeight: 16 },
    pushStatusButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    pushStatusButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
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
    name: { fontSize: 17, fontWeight: '600', flex: 1, paddingRight: 8 },
    approveBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    approveBtnText: { color: colors.onPrimary, fontWeight: '600', fontSize: 14 },
    empty: { fontSize: 14, lineHeight: 20 },
    avatarAndBadge: { flexDirection: 'row', alignItems: 'center' },
    avatarSmall: { width: 40, height: 40, borderRadius: 20 },
    avatarSmallFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    avatarSmallInitial: { fontSize: 16, fontWeight: '700' },
    swipeActionsRow: { justifyContent: 'center', marginBottom: 8 },
    swipeDelete: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      width: 96,
      borderRadius: 12,
      marginLeft: 8,
      paddingHorizontal: 8,
    },
    swipeDeleteText: { color: colors.white, fontWeight: '700', fontSize: 13, textAlign: 'center' },
    emptyFamilyCard: { opacity: 0.7, borderStyle: 'dashed' as const },
    emptyFamilyText: { fontSize: 14 },
  });
}
