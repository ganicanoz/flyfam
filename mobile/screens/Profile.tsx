import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ScrollView,
  Pressable,
} from 'react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../contexts/SessionContext';
import { useAdminRoster } from '../contexts/AdminRosterContext';
import { colors, setThemePreference, useThemeMode, useThemePreference, type ThemePreference } from '../theme/colors';
import { AIRLINES } from '../constants/airlines';
import { normalizeCrewAirlineIcaoTypo } from '../lib/pdfRosterImport';
import { LOCALE_LABELS, type Locale } from '../lib/i18n';
import { deleteMyAccount } from '../lib/accountDeletion';
import { pushRootScreen } from '../lib/pushRootScreen';
import { getAppVersionLabel } from '../lib/appVersion';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';
import { radius, shadow } from '../theme/tokens';

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function Profile() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { profile, crewProfile, session, signOut } = useSession();
  const { onProfileSecretTap } = useAdminRoster();
  const themeMode = useThemeMode();
  void themeMode;
  const themePreference = useThemePreference();
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);

  const loadAccess = useCallback(() => {
    if (profile?.role !== 'crew') {
      setAccess(null);
      return;
    }
    fetchMySubscriptionAccess()
      .then(setAccess)
      .catch(() => setAccess(null));
  }, [profile?.role]);

  useFocusEffect(
    useCallback(() => {
      loadAccess();
    }, [loadAccess]),
  );

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  const openEditProfile = () => {
    if (onProfileSecretTap()) {
      (navigation as { navigate: (name: string) => void }).navigate('Roster');
      return;
    }
    pushRootScreen(navigation as never, 'EditProfile');
  };

  const airlineIcaoNorm = crewProfile?.airline_icao
    ? normalizeCrewAirlineIcaoTypo(crewProfile.airline_icao)
    : '';
  const airline =
    airlineIcaoNorm.length > 0
      ? AIRLINES.find((a) => a.icao.toUpperCase() === airlineIcaoNorm.toUpperCase()) ?? null
      : null;
  const airlineName = airline?.name ?? crewProfile?.company_name ?? null;
  const initial = (profile?.full_name || session?.user?.email || '?').trim().charAt(0).toUpperCase();
  const baseIata = (crewProfile?.home_base_iata ?? '').trim().toUpperCase();
  const crewBaseValue =
    profile?.role === 'crew'
      ? `${t('profile.roleCrew')}${baseIata ? ` ${baseIata}` : ''}`
      : t('profile.roleFamily');

  const subscriptionMeta = useMemo(() => {
    if (profile?.role !== 'crew') return null;
    if (!access) return t('common.loading');
    if (access.subscription_status === 'trialing') {
      const days = daysUntil(access.trial_ends_at);
      if (days != null) return t('profile.subscriptionTrialDays', { days });
    }
    if (access.has_access && access.plan_title) {
      return t('profile.subscriptionActivePlan', { plan: access.plan_title });
    }
    if (access.plan_title) return access.plan_title;
    return t('profile.subscriptionInactive');
  }, [access, profile?.role, t]);

  const handleDeleteAccount = () => {
    Alert.alert(t('profile.deleteAccountTitle'), t('profile.deleteAccountConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.deleteAccountAction'),
        style: 'destructive',
        onPress: async () => {
          setDeletingAccount(true);
          const result = await deleteMyAccount();
          setDeletingAccount(false);
          if (!result.ok) {
            Alert.alert(t('common.error'), result.error || t('profile.deleteAccountFailed'));
            return;
          }
          await signOut();
        },
      },
    ]);
  };

  const themeOptions: { key: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'system', label: t('profile.themeSystem'), icon: 'contrast-outline' },
    { key: 'light', label: t('profile.themeLight'), icon: 'sunny-outline' },
    { key: 'dark', label: t('profile.themeDark'), icon: 'moon-outline' },
  ];

  const InfoRow = ({
    icon,
    label,
    children,
    last,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    children: ReactNode;
    last?: boolean;
  }) => (
    <View
      style={[
        styles.infoRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={[styles.infoLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.infoValueWrap}>{children}</View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 8) + 8, paddingBottom: 36 + Math.max(insets.bottom, 8) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.pageTitle, { color: colors.text }]}>{t('nav.profile')}</Text>

        <Pressable
          onPress={openEditProfile}
          style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.identityRow}>
            <View style={styles.identityText}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
                {profile?.full_name ?? '—'}
              </Text>
              {session?.user?.email ? (
                <Text style={[styles.email, { color: colors.textMuted }]} numberOfLines={2}>
                  {session.user.email}
                </Text>
              ) : null}
              <Text style={[styles.editHint, { color: colors.textMuted }]}>{t('profile.editProfileHint')}</Text>
            </View>
            <Pressable
              onPress={openEditProfile}
              hitSlop={8}
              accessibilityLabel={t('profile.editProfileHint')}
              style={styles.avatarWrap}
            >
              {profile?.avatar_url ? (
                <Image
                  key={profile.avatar_url}
                  source={{ uri: profile.avatar_url }}
                  style={styles.avatar}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.avatarInitial, { color: colors.primary }]}>{initial}</Text>
                </View>
              )}
              <View style={[styles.avatarCam, { backgroundColor: colors.secondary, borderColor: colors.surface }]}>
                <Ionicons name="camera" size={12} color={colors.white} />
              </View>
            </Pressable>
          </View>

          {crewProfile ? (
            <InfoRow icon="airplane-outline" label={t('profile.airline')}>
              {airline ? (
                <View style={styles.airlineValue}>
                  <Image source={{ uri: airline.logoUrl }} style={styles.airlineLogo} />
                  <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
                    {airline.name}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
                  {airlineName ?? t('profile.notSet')}
                </Text>
              )}
            </InfoRow>
          ) : null}

          <InfoRow icon="people-outline" label={t('profile.crewBaseLabel')}>
            <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
              {crewBaseValue}
            </Text>
          </InfoRow>

          <InfoRow icon="globe-outline" label={t('profile.language')} last>
            <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
              {profile?.locale ? LOCALE_LABELS[profile.locale as Locale] : LOCALE_LABELS.en}
            </Text>
          </InfoRow>
        </Pressable>

        <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{t('profile.appearanceTitle')}</Text>
          <Text style={[styles.cardHint, { color: colors.textMuted }]}>{t('profile.appearanceHint')}</Text>
          <View style={[styles.themeSeg, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {themeOptions.map((opt, idx) => {
              const selected = themePreference === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.themeSegItem,
                    idx > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
                    selected && {
                      backgroundColor: colors.primaryLight,
                      borderColor: colors.primary,
                      borderWidth: 1.5,
                      borderRadius: 10,
                      margin: 2,
                      borderLeftWidth: 1.5,
                    },
                  ]}
                  onPress={() => void setThemePreference(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Ionicons name={opt.icon} size={16} color={selected ? colors.primary : colors.textMuted} />
                  <Text style={[styles.themeSegText, { color: selected ? colors.primary : colors.text }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {profile?.role === 'crew' ? (
          <TouchableOpacity
            style={[styles.card, styles.linkCard, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => pushRootScreen(navigation as never, 'Plans')}
          >
            <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="card-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.linkTextCol}>
              <Text style={[styles.linkLabel, { color: colors.text }]}>{t('profile.manageSubscription')}</Text>
              {subscriptionMeta ? (
                <Text style={[styles.linkMeta, { color: colors.textMuted }]} numberOfLines={1}>
                  {subscriptionMeta}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}

        <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 4 }]}>
          <TouchableOpacity
            style={styles.signOutRow}
            onPress={() =>
              Alert.alert(t('profile.signOutConfirmTitle'), t('profile.signOutConfirmMessage'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('profile.signOut'), style: 'destructive', onPress: () => void signOut() },
              ])
            }
          >
            <Ionicons name="log-out-outline" size={20} color={colors.secondary} />
            <Text style={[styles.signOutText, { color: colors.text }]}>{t('profile.signOut')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.policyLink} onPress={() => pushRootScreen(navigation as never, 'PrivacyNotice')}>
          <Text style={[styles.policyLinkText, { color: colors.secondary }]}>
            {t('profile.privacyPolicy')} ›
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.policyLink} onPress={() => pushRootScreen(navigation as never, 'TermsDisclaimer')}>
          <Text style={[styles.policyLinkText, { color: colors.secondary }]}>
            {t('profile.termsDisclaimer')} ›
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.policyLink} onPress={() => pushRootScreen(navigation as never, 'ConsentHistory')}>
          <Text style={[styles.policyLinkText, { color: colors.secondary }]}>
            {t('profile.consentHistory')} ›
          </Text>
        </TouchableOpacity>
        <Text style={[styles.appVersion, { color: colors.textMuted }]}>
          {t('profile.appVersion', { version: getAppVersionLabel() })}
        </Text>

        <TouchableOpacity
          style={[styles.deleteProfileBtn, deletingAccount && styles.buttonDisabled]}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        >
          <Text style={[styles.deleteProfileText, { color: colors.error }]}>
            {t('profile.deleteAccountMuted')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 16,
  },
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    minHeight: 64,
  },
  linkTextCol: { flex: 1, minWidth: 0 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontSize: 20, fontWeight: '800' },
  email: { fontSize: 13, marginTop: 4 },
  editHint: { fontSize: 12, marginTop: 6, fontWeight: '500' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 22, fontWeight: '700' },
  avatarCam: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    minHeight: 44,
  },
  infoLabel: { fontSize: 14, fontWeight: '600', flexShrink: 0 },
  infoValueWrap: { flex: 1, alignItems: 'flex-end' },
  infoValue: { fontSize: 14, fontWeight: '600', textAlign: 'right' },
  airlineValue: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  airlineLogo: { width: 20, height: 20, borderRadius: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardHint: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  themeSeg: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    minHeight: 48,
  },
  themeSegItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 4,
    minHeight: 44,
  },
  themeSegText: { fontSize: 13, fontWeight: '700' },
  linkLabel: { fontSize: 15, fontWeight: '600' },
  linkMeta: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    minHeight: 52,
  },
  signOutText: { flex: 1, fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.7 },
  policyLink: { marginTop: 10, alignItems: 'center', paddingVertical: 6, minHeight: 44, justifyContent: 'center' },
  policyLinkText: { fontSize: 13, fontWeight: '600' },
  appVersion: {
    marginTop: 14,
    marginBottom: 8,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '500',
  },
  deleteProfileBtn: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: 10,
  },
  deleteProfileText: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.72,
  },
});
