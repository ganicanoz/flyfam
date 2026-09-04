import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Pressable,
} from 'react-native';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { getPushTokenWithReason, registerPushTokenForFamilyUser } from '../lib/pushNotifications';
import { colors, useThemeMode } from '../theme/colors';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';
import { demoPeersForUser, peerInitials } from '../lib/crewPeerDemo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, shadow } from '../theme/tokens';
import {
  getRosterLastSharedAt,
  hydrateRosterLastSharedAt,
  subscribeRosterLastSharedAt,
} from '../lib/rosterShareMeta';
import { pushRootScreen } from '../lib/pushRootScreen';

/** Aile üye kartı ile Kaldır butonu aynı yükseklik (padding 16+16 + avatar 40). */
const FAMILY_MEMBER_ROW_HEIGHT = 72;
const SWIPE_HINT_KEY = 'flyfam.familySwipeHintSeen.v1';

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

function formatInviteSentWhen(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return formatLastSharedWhen(ms, locale);
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
  const locale = isTr ? 'tr-TR' : 'en-US';
  const [connections, setConnections] = useState<Connection[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendLoading, setSendLoading] = useState(false);
  const [resendLoadingId, setResendLoadingId] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [sentPendingInvites, setSentPendingInvites] = useState<SentPendingInvite[]>([]);
  const [inviteResponding, setInviteResponding] = useState<string | null>(null);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);
  const [pushStatus, setPushStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [pushError, setPushError] = useState<string | null>(null);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const isCrew = profile?.role === 'crew';
  const demoPeers = useMemo(() => demoPeersForUser(profile?.id), [profile?.id]);
  const [lastSharedAtMs, setLastSharedAtMs] = useState<number | null>(() => getRosterLastSharedAt());
  const emailInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const inviteCardY = useRef(0);

  useEffect(() => {
    void hydrateRosterLastSharedAt().then(() => setLastSharedAtMs(getRosterLastSharedAt()));
    return subscribeRosterLastSharedAt(() => setLastSharedAtMs(getRosterLastSharedAt()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(SWIPE_HINT_KEY).then((v) => {
      if (!cancelled) setShowSwipeHint(v !== '1');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markSwipeHintSeen = useCallback(() => {
    setShowSwipeHint(false);
    void AsyncStorage.setItem(SWIPE_HINT_KEY, '1').catch(() => {});
  }, []);

  const lastSharedLabel = useMemo(() => {
    if (!isCrew) return null;
    if (lastSharedAtMs == null) return t('family.lastSharedNever');
    return t('family.lastSharedLabel', { when: formatLastSharedWhen(lastSharedAtMs, locale) });
  }, [isCrew, lastSharedAtMs, locale, t]);

  const focusInviteEmail = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, inviteCardY.current - 12), animated: true });
    setTimeout(() => emailInputRef.current?.focus(), 220);
  }, []);

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

  const resendSentInvite = async (inv: SentPendingInvite) => {
    setResendLoadingId(inv.id);
    const { error: declineErr } = await supabase
      .from('crew_invitations')
      .update({ status: 'declined' })
      .eq('id', inv.id)
      .eq('status', 'pending');
    if (declineErr) {
      setResendLoadingId(null);
      Alert.alert(t('common.error'), declineErr.message);
      return;
    }
    const { error } = await supabase.rpc('send_crew_invitation', {
      p_family_email: inv.family_email,
    });
    setResendLoadingId(null);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      await loadSentPendingInvites();
      return;
    }
    await loadSentPendingInvites();
    Alert.alert(t('family.resendInvite'), t('family.resendInviteSent'));
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

  const openMemberActions = (c: Connection) => {
    const label = c.other_name ?? (isCrew ? t('family.familyMember') : t('family.crewMember'));
    Alert.alert(t('family.memberActionsTitle'), label, [
      {
        text: isCrew ? t('family.removeMember') : t('family.leaveConnection'),
        style: 'destructive',
        onPress: () => removeConnection(c.id, !isCrew),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
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
  const showPlanRequiredBanner = isCrew && access != null && !access.has_access;
  const showPlanLimitBanner = isCrew && access?.has_access === true && !access.can_invite_more;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Math.max(insets.top, 8) + 8, paddingBottom: 48 + Math.max(insets.bottom, 8) },
        ]}
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
          <View
            style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onLayout={(e) => {
              inviteCardY.current = e.nativeEvent.layout.y;
            }}
          >
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
                ref={emailInputRef}
                style={[styles.input, { color: colors.text }]}
                placeholder={t('family.emailPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!sendLoading}
                returnKeyType="send"
                onSubmitEditing={() => void sendInvitation()}
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
            {showPlanRequiredBanner ? (
              <View style={[styles.infoBanner, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="information-circle" size={18} color={colors.primary} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.infoBannerText, { color: colors.textSecondary }]}>
                    {t('family.planRequiredToInvite')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => pushRootScreen(navigation, 'Plans')}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    style={styles.planLinkHit}
                  >
                    <Text style={[styles.planLink, { color: colors.secondary }]}>
                      {t('family.goToSubscription')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {showPlanLimitBanner ? (
              <View style={[styles.infoBanner, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="information-circle" size={18} color={colors.primary} />
                <Text style={[styles.infoBannerText, { color: colors.textSecondary }]}>
                  {t('family.planLimitReached')}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {isCrew && sentPendingInvites.length > 0 && (
          <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 12 }]}>
              {t('family.pendingInviteesTitle')}
            </Text>
            {sentPendingInvites.map((inv) => {
              const when = formatInviteSentWhen(inv.created_at, locale);
              return (
                <View key={inv.id} style={[styles.pendingInviteRow, { borderColor: colors.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {inv.family_email}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                      {when
                        ? t('family.inviteSentOn', { when })
                        : t('family.pendingInviteeWaiting')}
                    </Text>
                  </View>
                  <View style={styles.pendingActions}>
                    <TouchableOpacity
                      style={[styles.outlineChip, { borderColor: colors.border, minHeight: 44 }]}
                      onPress={() => void resendSentInvite(inv)}
                      disabled={resendLoadingId === inv.id}
                    >
                      {resendLoadingId === inv.id ? (
                        <ActivityIndicator size="small" color={colors.secondary} />
                      ) : (
                        <Text style={[styles.outlineChipText, { color: colors.secondary }]}>
                          {t('family.resendInvite')}
                        </Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.outlineChip, { borderColor: colors.border, minHeight: 44 }]}
                      onPress={() => cancelSentInvite(inv)}
                    >
                      <Text style={[styles.outlineChipText, { color: colors.textSecondary }]}>
                        {t('family.cancelInvite')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
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
                    style={[styles.outlineChip, { borderColor: colors.primary, minHeight: 44 }]}
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
                  style={[
                    styles.outlineChip,
                    { backgroundColor: colors.primary, borderColor: colors.primary, minHeight: 44 },
                  ]}
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
                style={[styles.memberRow, { borderColor: colors.border, minHeight: 44 }]}
                activeOpacity={0.85}
                onPress={() =>
                  navigation.navigate('PartnerRoster', {
                    peerCrewId: p.peerCrewId,
                    peerName: p.name,
                    peerAirline: p.airline,
                  })
                }
              >
                <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                    {peerInitials(p.name)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]}>{p.name}</Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {p.airline} · {p.icao}
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
            {showSwipeHint && approved.length > 0 ? (
              <View style={styles.swipeHint}>
                <Ionicons name="swap-horizontal-outline" size={14} color={colors.textMuted} />
                <Text style={[styles.swipeHintText, { color: colors.textMuted }]}>
                  {t('family.swipeToDeleteShort')}
                </Text>
              </View>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : approved.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyArt, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Ionicons name="people" size={40} color={colors.secondary} />
                <View style={[styles.emptyHeart, { backgroundColor: colors.secondary }]}>
                  <Ionicons name="heart" size={12} color={colors.white} />
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
                    onPress={focusInviteEmail}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.textCtaHit}
                  >
                    <Text style={[styles.textCta, { color: colors.secondary }]}>
                      {t('family.inviteNowCta')}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : (
            <>
              {approved.map((c) => {
                const label = c.other_name ?? (isCrew ? t('family.familyMember') : t('family.crewMember'));
                const initials = peerInitials(label);
                const cardInner = (
                  <Pressable
                    onLongPress={() => openMemberActions(c)}
                    delayLongPress={350}
                    style={[styles.memberRowSolid, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    {c.other_avatar_url ? (
                      <Image key={c.other_avatar_url} source={{ uri: c.other_avatar_url }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}>
                        <Text style={[styles.avatarInitial, { color: colors.primary }]}>{initials}</Text>
                      </View>
                    )}
                    <View style={styles.memberTextCol}>
                      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                        {label}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textMuted }]}>{t('family.viewerRole')}</Text>
                    </View>
                  </Pressable>
                );
                return (
                  <View key={c.id} style={styles.swipeRowWrap}>
                    <Swipeable
                      renderRightActions={() => (
                        <RectButton
                          style={styles.swipeDelete}
                          onPress={() => {
                            markSwipeHintSeen();
                            removeConnection(c.id, !isCrew);
                          }}
                        >
                          <Text style={styles.swipeDeleteText}>
                            {isCrew ? t('family.removeMember') : t('family.leaveConnection')}
                          </Text>
                        </RectButton>
                      )}
                      onSwipeableOpen={markSwipeHintSeen}
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
    scroll: { paddingHorizontal: 16 },
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
    planLinkHit: { minHeight: 44, justifyContent: 'center' },
    planLink: { fontSize: 13, fontWeight: '700' },
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
      width: 96,
      height: 96,
      borderRadius: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
      borderWidth: StyleSheet.hairlineWidth,
    },
    emptyHeart: {
      position: 'absolute',
      right: 8,
      bottom: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
    emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 14 },
    textCtaHit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    textCta: { fontWeight: '700', fontSize: 15, textDecorationLine: 'underline' },
    pendingInviteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    pendingActions: { gap: 8, alignItems: 'stretch' },
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
      gap: 12,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      height: FAMILY_MEMBER_ROW_HEIGHT,
    },
    memberTextCol: { flex: 1, minWidth: 0 },
    emptySlot: { borderStyle: 'dashed', opacity: 0.75, marginTop: 8, justifyContent: 'center' },
    name: { fontSize: 16, fontWeight: '600' },
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
    avatarInitial: { fontSize: 13, fontWeight: '800' },
    outlineChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
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
