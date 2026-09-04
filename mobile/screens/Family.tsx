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
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { getPushTokenWithReason, registerPushTokenForFamilyUser } from '../lib/pushNotifications';
import { colors, useThemeMode } from '../theme/colors';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';
import { demoPeersForUser } from '../lib/crewPeerDemo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, shadow } from '../theme/tokens';
import {
  getRosterLastSharedAt,
  hydrateRosterLastSharedAt,
  subscribeRosterLastSharedAt,
} from '../lib/rosterShareMeta';

/** Aile üye kartı ile Kaldır butonu aynı yükseklik (padding 16+16 + avatar 40). */
const FAMILY_MEMBER_ROW_HEIGHT = 72;

function formatLastSharedWhen(ms: number, locale: string): string {
  const d = new Date(ms);
  const day = d.getDate();
  const month = d
    .toLocaleDateString(locale, { month: 'short' })
    .replace(/\.$/, '')
    .trim();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

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

/** Crew'ın gönderdiği, henüz yanıtlanmamış davetler. */
type SentPendingInvite = {
  id: string;
  family_email: string;
  created_at: string | null;
};

export default function Family() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const { profile, crewProfile } = useSession();
  const themeMode = useThemeMode();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createFamilyStyles(), [themeMode]);
  const isTr = String(i18n.language || '').toLowerCase().startsWith('tr');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendLoading, setSendLoading] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [sentPendingInvites, setSentPendingInvites] = useState<SentPendingInvite[]>([]);
  const [inviteResponding, setInviteResponding] = useState<string | null>(null);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);
  const [pushStatus, setPushStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [pushError, setPushError] = useState<string | null>(null);
  const isCrew = profile?.role === 'crew';
  const demoPeers = useMemo(() => demoPeersForUser(profile?.id), [profile?.id]);
  const [lastSharedAtMs, setLastSharedAtMs] = useState<number | null>(() => getRosterLastSharedAt());

  useEffect(() => {
    void hydrateRosterLastSharedAt().then(() => setLastSharedAtMs(getRosterLastSharedAt()));
    return subscribeRosterLastSharedAt(() => setLastSharedAtMs(getRosterLastSharedAt()));
  }, []);

  const lastSharedLabel = useMemo(() => {
    if (!isCrew) return null;
    if (lastSharedAtMs == null) return t('family.lastSharedNever');
    const locale = isTr ? 'tr-TR' : 'en-US';
    return t('family.lastSharedLabel', { when: formatLastSharedWhen(lastSharedAtMs, locale) });
  }, [isCrew, lastSharedAtMs, isTr, t]);

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

  const loadSentPendingInvites = useCallback(async () => {
    if (!isCrew || !crewProfile?.id) {
      setSentPendingInvites([]);
      return;
    }
    const { data, error } = await supabase
      .from('crew_invitations')
      .select('id, family_email, created_at')
      .eq('crew_id', crewProfile.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('[Family] sent invites error:', error.message);
      setSentPendingInvites([]);
      return;
    }
    setSentPendingInvites(
      (data ?? []).map((row: { id: string; family_email: string; created_at: string | null }) => ({
        id: row.id,
        family_email: row.family_email,
        created_at: row.created_at ?? null,
      })),
    );
  }, [isCrew, crewProfile?.id]);

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
      Promise.all([loadConnections(), loadPendingInvites(), loadSentPendingInvites()]).finally(() => {
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
    }, [loadConnections, loadPendingInvites, loadSentPendingInvites, isCrew, profile?.id, checkPushStatus]),
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
    setEmail('');
    await loadSentPendingInvites();
    Alert.alert(t('family.invitationSent'), t('family.invitationSentMessage', { email: trimmed }));
  };

  const cancelSentInvite = (inv: SentPendingInvite) => {
    Alert.alert(
      t('family.cancelInviteConfirmTitle'),
      t('family.cancelInviteConfirmMessage', { email: inv.family_email }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('family.cancelInvite'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('crew_invitations')
              .update({ status: 'declined' })
              .eq('id', inv.id)
              .eq('status', 'pending');
            if (error) {
              Alert.alert(t('common.error'), error.message);
              return;
            }
            setSentPendingInvites((prev) => prev.filter((x) => x.id !== inv.id));
          },
        },
      ],
    );
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
  const usedFollowers = access?.used_family_approved ?? approved.length;
  const maxFollowers = access?.max_family_members ?? 0;
  const emptyFollowerSlots = isCrew ? Math.max(maxFollowers - usedFollowers, 0) : 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: Math.max(insets.top, 8) + 8 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeader}>
          <Text style={[styles.pageTitle, { color: colors.text }]}>{t('nav.family')}</Text>
          <Text style={[styles.pageSubtitle, { color: colors.textMuted }]}>{t('family.pageSubtitle')}</Text>
          {lastSharedLabel ? (
            <Text style={[styles.lastShared, { color: colors.textSecondary }]}>{lastSharedLabel}</Text>
          ) : null}
        </View>

        {isCrew && (
          <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardHeadRow}>
              <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="mail-outline" size={20} color={colors.primary} />
              </View>
              <View style={styles.cardHeadText}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{t('family.inviteTitle')}</Text>
                <Text style={[styles.cardHint, { color: colors.textMuted }]}>{t('family.inviteHintMock')}</Text>
              </View>
            </View>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder={t('family.emailPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!sendLoading}
              />
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }, sendLoading && styles.buttonDisabled]}
              onPress={sendInvitation}
              disabled={sendLoading || !access?.can_invite_more || !access?.has_access}
            >
              {sendLoading ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <View style={styles.btnRow}>
                  <Ionicons name="paper-plane-outline" size={18} color={colors.onPrimary} />
                  <Text style={styles.primaryBtnText}>{t('family.sendInvitation')}</Text>
                </View>
              )}
            </TouchableOpacity>
            <View style={[styles.infoBanner, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="information-circle" size={18} color={colors.primary} />
              <Text style={[styles.infoBannerText, { color: colors.textSecondary }]}>
                {access?.has_access && !access?.can_invite_more
                  ? t('family.planLimitReached')
                  : t('family.planRequiredToInvite')}
              </Text>
            </View>
          </View>
        )}

        {isCrew && sentPendingInvites.length > 0 && (
          <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 12 }]}>
              {t('family.pendingInviteesTitle')}
            </Text>
            {sentPendingInvites.map((inv) => (
              <View key={inv.id} style={[styles.memberRow, { borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {inv.family_email}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    {t('family.pendingInviteeWaiting')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.outlineChip, { borderColor: colors.border }]}
                  onPress={() => cancelSentInvite(inv)}
                >
                  <Text style={[styles.outlineChipText, { color: colors.textSecondary }]}>
                    {t('family.cancelInvite')}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {!isCrew && (
          <>
            <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    {pushStatus === 'checking'
                      ? t('family.pushChecking')
                      : pushStatus === 'ok'
                        ? t('family.pushEnabled')
                        : t('family.pushDisabled')}
                  </Text>
                  {pushStatus === 'error' && pushError ? (
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>{pushError}</Text>
                  ) : null}
                </View>
                {pushStatus !== 'checking' ? (
                  <TouchableOpacity
                    style={[styles.outlineChip, { borderColor: colors.primary }]}
                    onPress={checkPushStatus}
                  >
                    <Text style={[styles.outlineChipText, { color: colors.primary }]}>{t('family.refresh')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {pendingInvites.length > 0 && (
              <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 10 }]}>
                  {t('family.pendingInvitesTitle')} · {t('family.invitationsCount', { count: pendingInvites.length })}
                </Text>
                {pendingInvites.map((inv) => (
                  <View key={inv.id} style={[styles.inviteBlock, { borderColor: colors.border }]}>
                    <Text style={[styles.name, { color: colors.text }]}>
                      {inv.crew_name ?? t('connect.crewMember')}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      {t('connect.invited')} {inv.family_email}
                    </Text>
                    <View style={styles.inviteActions}>
                      <TouchableOpacity
                        style={[styles.secondaryBtn, { borderColor: colors.border }]}
                        onPress={() => declineInvite(inv.id)}
                        disabled={!!inviteResponding}
                      >
                        <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                          {t('family.declineInvite')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.primary }]}
                        onPress={() => acceptInvite(inv.id)}
                        disabled={!!inviteResponding}
                      >
                        {inviteResponding === inv.id ? (
                          <ActivityIndicator color={colors.onPrimary} size="small" />
                        ) : (
                          <Text style={styles.primaryBtnText}>{t('family.acceptInvite')}</Text>
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
          <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 10 }]}>
              {t('family.pendingApproval')}
            </Text>
            {pending.map((c) => (
              <View key={c.id} style={[styles.memberRow, { borderColor: colors.border }]}>
                <Text style={[styles.name, { color: colors.text }]}>
                  {c.other_name ?? t('family.familyMember')}
                </Text>
                <TouchableOpacity
                  style={[styles.outlineChip, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  onPress={() => approveConnection(c.id)}
                >
                  <Text style={[styles.outlineChipText, { color: colors.onPrimary }]}>{t('family.approve')}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {isCrew && demoPeers.length > 0 && (
          <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 8 }]}>
              {isTr ? 'Crew takiplerim' : 'Crew following'}
            </Text>
            {demoPeers.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.memberRow, { borderColor: colors.border }]}
                activeOpacity={0.85}
                onPress={() =>
                  navigation.navigate('PartnerRoster', {
                    peerCrewId: p.peerCrewId,
                    peerName: p.name,
                    peerAirline: p.airline,
                  })
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]}>{p.name}</Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {p.airline} · {p.icao}
                  </Text>
                </View>
                <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                    {p.name.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHead}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {isCrew ? t('family.connectedMembersTitle') : t('family.yourCrewConnections')}
            </Text>
            <View style={styles.swipeHint}>
              <Ionicons name="swap-horizontal-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.swipeHintText, { color: colors.textMuted }]}>
                {t('family.swipeToDeleteShort')}
              </Text>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : approved.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyArt, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="people" size={36} color={colors.primary} />
                <View style={[styles.emptyHeart, { backgroundColor: colors.primary }]}>
                  <Ionicons name="heart" size={12} color={colors.onPrimary} />
                </View>
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {isCrew ? t('family.emptyMembersTitle') : t('family.noConnectionsYet')}
              </Text>
              {isCrew ? (
                <>
                  <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                    {t('family.emptyMembersBody')}
                  </Text>
                  <TouchableOpacity
                    style={[styles.dashedBtn, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}
                    onPress={() => {}}
                  >
                    <View style={styles.btnRow}>
                      <Ionicons name="paper-plane-outline" size={16} color={colors.primary} />
                      <Text style={[styles.dashedBtnText, { color: colors.primary }]}>
                        {t('family.inviteNowCta')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : (
            <>
              {approved.map((c) => {
                const label = c.other_name ?? (isCrew ? t('family.familyMember') : t('family.crewMember'));
                const cardInner = (
                  <View style={[styles.memberRowSolid, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.name, { color: colors.text }]}>{label}</Text>
                    {c.other_avatar_url ? (
                      <Image key={c.other_avatar_url} source={{ uri: c.other_avatar_url }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}>
                        <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                          {label.trim().charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                );
                return (
                  <View key={c.id} style={styles.swipeRowWrap}>
                    <Swipeable
                      renderRightActions={() => (
                        <RectButton style={styles.swipeDelete} onPress={() => removeConnection(c.id, !isCrew)}>
                          <Text style={styles.swipeDeleteText}>
                            {isCrew ? t('family.removeMember') : t('family.leaveConnection')}
                          </Text>
                        </RectButton>
                      )}
                      overshootRight={false}
                    >
                      {cardInner}
                    </Swipeable>
                  </View>
                );
              })}
              {isCrew &&
                Array.from({ length: emptyFollowerSlots }).map((_, idx) => (
                  <View
                    key={`empty-slot-${idx}`}
                    style={[styles.memberRowSolid, styles.emptySlot, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                      {t('family.emptyFamilyPlaceholder')}
                    </Text>
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
    scroll: { paddingHorizontal: 16, paddingBottom: 48 },
    pageHeader: { marginBottom: 16 },
    pageTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
    pageSubtitle: { fontSize: 14, lineHeight: 20, marginTop: 6 },
    lastShared: { fontSize: 13, lineHeight: 18, marginTop: 8, fontWeight: '600' },
    card: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 16,
      marginBottom: 14,
    },
    cardHeadRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
    iconBox: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardHeadText: { flex: 1 },
    cardTitle: { fontSize: 16, fontWeight: '700' },
    cardHint: { fontSize: 13, lineHeight: 18, marginTop: 2 },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: radius.button,
      paddingHorizontal: 12,
      marginBottom: 12,
      minHeight: 48,
    },
    input: { flex: 1, fontSize: 16, paddingVertical: 12 },
    primaryBtn: {
      borderRadius: radius.button,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    primaryBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
    btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    buttonDisabled: { opacity: 0.7 },
    infoBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 12,
      padding: 10,
      borderRadius: 10,
    },
    infoBannerText: { flex: 1, fontSize: 12, lineHeight: 17 },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 12,
    },
    swipeHint: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
    swipeHintText: { fontSize: 11, fontWeight: '500' },
    emptyState: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 8 },
    emptyArt: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    emptyHeart: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
    emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 14 },
    dashedBtn: {
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderRadius: radius.button,
      paddingVertical: 12,
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: 'center',
    },
    dashedBtnText: { fontWeight: '700', fontSize: 14 },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    memberRowSolid: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      height: FAMILY_MEMBER_ROW_HEIGHT,
    },
    emptySlot: { borderStyle: 'dashed', opacity: 0.75, marginTop: 8 },
    name: { fontSize: 16, fontWeight: '600', flex: 1 },
    meta: { fontSize: 12, marginTop: 2 },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    avatarInitial: { fontSize: 16, fontWeight: '700' },
    outlineChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    outlineChipText: { fontSize: 12, fontWeight: '700' },
    inviteBlock: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 12,
      marginTop: 4,
    },
    inviteActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    secondaryBtn: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radius.button,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryBtnText: { fontWeight: '700' },
    swipeRowWrap: { marginBottom: 8 },
    swipeDelete: {
      width: 110,
      height: FAMILY_MEMBER_ROW_HEIGHT,
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 12,
      paddingHorizontal: 8,
    },
    swipeDeleteText: { color: colors.white, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  });
}
