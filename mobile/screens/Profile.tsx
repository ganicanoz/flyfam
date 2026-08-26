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
import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSession } from '../contexts/SessionContext';
import { useAdminRoster } from '../contexts/AdminRosterContext';
import { colors, setThemePreference, useThemeMode, useThemePreference, type ThemePreference } from '../theme/colors';
import { AIRLINES } from '../constants/airlines';
import { normalizeCrewAirlineIcaoTypo } from '../lib/pdfRosterImport';
import { LOCALE_LABELS, type Locale } from '../lib/i18n';
import { deleteMyAccount } from '../lib/accountDeletion';
import { pushRootScreen } from '../lib/pushRootScreen';
import { getAppVersionLabel } from '../lib/appVersion';

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

  const onProfileCardPress = () => {
    if (onProfileSecretTap()) {
      (navigation as { navigate: (name: string) => void }).navigate('Roster');
    }
  };

  const airlineIcaoNorm = crewProfile?.airline_icao
    ? normalizeCrewAirlineIcaoTypo(crewProfile.airline_icao)
    : '';
  const airline =
    airlineIcaoNorm.length > 0
      ? AIRLINES.find((a) => a.icao.toUpperCase() === airlineIcaoNorm.toUpperCase()) ?? null
      : null;
  const airlineName = airline?.name ?? crewProfile?.company_name ?? null;

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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 28 + Math.max(insets.bottom, 8) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Pressable
          onPress={onProfileCardPress}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.cardTopRow}>
            <View style={styles.cardDetails}>
              <Text style={[styles.label, styles.labelFirst, { color: colors.textSecondary }]}>{t('profile.name')}</Text>
              <Text style={[styles.value, styles.valueInColumn, { color: colors.text }]} numberOfLines={3}>
                {profile?.full_name ?? '—'}
              </Text>

              {session?.user?.email && (
                <>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{t('profile.email')}</Text>
                  <Text
                    style={[styles.value, styles.valueInColumn, { color: colors.text }]}
                    numberOfLines={3}
                    ellipsizeMode="tail"
                  >
                    {session.user.email}
                  </Text>
                </>
              )}

              {crewProfile && (
                <>
                  <Text style={[styles.label, styles.labelCompact, { color: colors.textSecondary }]}>
                    {t('profile.airline')}
                  </Text>
                  {airline ? (
                    <View style={styles.airlineRow}>
                      <Image source={{ uri: airline.logoUrl }} style={styles.airlineLogo} />
                      <Text
                        style={[styles.value, styles.airlineNameText, { color: colors.text }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {airline.name}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.value, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
                      {airlineName ?? t('profile.notSet')}
                    </Text>
                  )}
                </>
              )}

              <Text style={[styles.label, styles.labelCompact, { color: colors.textSecondary }]}>
                {t('profile.language')}
              </Text>
              <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
                {profile?.locale ? LOCALE_LABELS[profile.locale as Locale] : LOCALE_LABELS.en}
              </Text>
            </View>

            <View style={styles.cardAvatarWrap}>
              {profile?.avatar_url ? (
                <Image
                  key={profile.avatar_url}
                  source={{ uri: profile.avatar_url }}
                  style={styles.cardAvatarImage}
                  resizeMode="cover"
                  onError={(e) => {
                    console.warn('[Profile avatar] load error', profile.avatar_url, e.nativeEvent?.error);
                  }}
                />
              ) : (
                <View style={[styles.cardAvatarFallback, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <Text style={[styles.cardAvatarInitial, { color: colors.primary }]}>
                    {(profile?.full_name || session?.user?.email || '?')
                      .trim()
                      .charAt(0)
                      .toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.roleBadge}>
                <View style={styles.roleBadgeRow}>
                  {profile?.role === 'crew' ? (
                    <MaterialIcons name="flight-takeoff" size={16} color={colors.text} />
                  ) : (
                    <Ionicons name="people-outline" size={14} color={colors.text} />
                  )}
                  <Text style={[styles.roleBadgeText, { color: colors.text }]} numberOfLines={1}>
                    {profile?.role === 'crew' ? t('profile.roleCrew') : t('profile.roleFamily')}
                  </Text>
                </View>
                {profile?.role === 'crew' ? (
                  <Text style={[styles.roleBaseText, { color: colors.text }]} numberOfLines={1}>
                    {(crewProfile?.home_base_iata ?? '').trim().toUpperCase() || t('profile.notSet')}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.editInCard, { backgroundColor: colors.primary }]}
            onPress={() => pushRootScreen(navigation as never, 'EditProfile')}
          >
            <View style={styles.editButtonContent}>
              <Ionicons name="pencil" size={18} color={colors.onPrimary} />
              <Text style={styles.editButtonText}>{t('profile.editProfileAction')}</Text>
            </View>
          </TouchableOpacity>
        </Pressable>

        <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.settingsTitle, { color: colors.text }]}>{t('profile.appearanceTitle')}</Text>
          <Text style={[styles.settingsHint, { color: colors.textSecondary }]}>{t('profile.appearanceHint')}</Text>
          <View style={styles.themeRow}>
            {themeOptions.map((opt) => {
              const selected = themePreference === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.themeChip,
                    {
                      backgroundColor: selected ? colors.primary : colors.background,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => void setThemePreference(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Ionicons
                    name={opt.icon}
                    size={16}
                    color={selected ? colors.onPrimary : colors.text}
                  />
                  <Text style={[styles.themeChipText, { color: selected ? colors.onPrimary : colors.text }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {profile?.role === 'crew' && (
          <TouchableOpacity
            style={[styles.manageSubscriptionButton, { borderColor: colors.primary, backgroundColor: colors.surface }]}
            onPress={() => pushRootScreen(navigation as never, 'Plans')}
          >
            <View style={styles.editButtonContent}>
              <Ionicons name="card-outline" size={20} color={colors.primary} />
              <Text style={[styles.manageSubscriptionButtonText, { color: colors.primary }]}>
                {t('profile.manageSubscription')}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.signOut}
          onPress={() =>
            Alert.alert(t('profile.signOutConfirmTitle'), t('profile.signOutConfirmMessage'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('profile.signOut'),
                style: 'destructive',
                onPress: () => void signOut(),
              },
            ])
          }
        >
          <View style={styles.signOutContent}>
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
            <Text style={styles.signOutText}>{t('profile.signOut')}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteAccount, deletingAccount && styles.buttonDisabled]}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
        >
          <View style={styles.signOutContent}>
            <Ionicons name="trash-outline" size={20} color={colors.white} />
            <Text style={styles.signOutText}>{t('profile.deleteAccountAction')}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.policyLink}
          onPress={() => pushRootScreen(navigation as never, 'PrivacyNotice')}
        >
          <Text style={[styles.policyLinkText, { color: colors.primary }]}>{t('profile.privacyPolicy')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.policyLink}
          onPress={() => pushRootScreen(navigation as never, 'TermsDisclaimer')}
        >
          <Text style={[styles.policyLinkText, { color: colors.primary }]}>{t('profile.termsDisclaimer')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.policyLink}
          onPress={() => pushRootScreen(navigation as never, 'ConsentHistory')}
        >
          <Text style={[styles.policyLinkText, { color: colors.primary }]}>{t('profile.consentHistory')}</Text>
        </TouchableOpacity>
        <Text style={[styles.appVersion, { color: colors.textMuted }]} accessibilityRole="text">
          {t('profile.appVersion', { version: getAppVersionLabel() })}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  cardDetails: {
    flex: 1,
    minWidth: 0,
  },
  cardAvatarWrap: {
    flexShrink: 0,
    alignItems: 'center',
    width: 76,
  },
  cardAvatarImage: {
    width: 76,
    height: 96,
    borderRadius: 10,
  },
  cardAvatarFallback: {
    width: 76,
    height: 96,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardAvatarInitial: { fontSize: 18, fontWeight: '700', color: colors.primary },
  roleBadge: {
    marginTop: 8,
    alignItems: 'center',
    width: 88,
    gap: 2,
  },
  roleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },
  roleBaseText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoCol: {
    flex: 1,
    minWidth: 0,
  },
  labelCompact: { marginTop: 12 },
  airlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 22,
  },
  airlineLogo: {
    width: 22,
    height: 22,
    borderRadius: 4,
    flexShrink: 0,
  },
  airlineNameText: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 22,
  },
  editInCard: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 9,
    alignItems: 'center',
  },
  settingsCard: {
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  settingsTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  settingsHint: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  themeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  themeChipText: { fontSize: 13, fontWeight: '700' },
  manageSubscriptionButton: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  manageSubscriptionButtonText: { fontWeight: '700', fontSize: 15 },
  label: { fontSize: 14, marginBottom: 4, marginTop: 16, fontWeight: '700' },
  labelFirst: { marginTop: 0 },
  value: { fontSize: 16 },
  valueInColumn: { flexShrink: 1 },
  editButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  signOut: {
    marginTop: 20,
    backgroundColor: colors.error,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7A0000',
  },
  deleteAccount: {
    marginTop: 8,
    backgroundColor: '#8B0000',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5A0000',
  },
  buttonDisabled: { opacity: 0.7 },
  policyLink: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 1,
  },
  policyLinkText: {
    fontSize: 12,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  signOutContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  signOutText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  appVersion: {
    marginTop: 14,
    marginBottom: 2,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '500',
  },
});
