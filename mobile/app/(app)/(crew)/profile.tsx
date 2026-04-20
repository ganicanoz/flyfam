import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ScrollView,
  Linking,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '@/contexts/SessionContext';
import { normalizeRosterListShow } from '@/lib/rosterListPreferences';
import { RosterListTasksModal } from '@/components/RosterListTasksModal';
import { colors } from '@/theme/colors';
import { AIRLINES } from '@/constants/airlines';
import { LOCALE_LABELS, type Locale } from '@/lib/i18n';
import { deleteMyAccount } from '@/lib/accountDeletion';

const PRIVACY_POLICY_URL = 'https://sites.google.com/view/flyfamapp/ana-sayfa';

export default function CrewProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, crewProfile, session, signOut, refreshProfile } = useSession();
  const [rosterModalVisible, setRosterModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const prefsSeed = normalizeRosterListShow(crewProfile?.roster_list_show);

  const airline =
    crewProfile?.airline_icao
      ? AIRLINES.find((a) => a.icao.toUpperCase() === (crewProfile.airline_icao || '').toUpperCase()) ?? null
      : null;
  const airlineName = airline?.name ?? crewProfile?.company_name ?? null;

  const handleSignOut = () => {
    Alert.alert(t('profile.signOutConfirmTitle'), t('profile.signOutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.signOut'),
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

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
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: t('nav.profile'),
          headerBackTitle: t('common.back'),
        }}
      />
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <View style={styles.card}>
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
                <View style={styles.cardAvatarFallback}>
                  <Text style={styles.cardAvatarInitial}>
                    {(profile?.full_name || session?.user?.email || '?')
                      .trim()
                      .charAt(0)
                      .toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, styles.labelFirst, { color: colors.textSecondary }]}>{t('profile.name')}</Text>
            <Text style={[styles.value, { color: colors.text }]}>{profile?.full_name ?? '—'}</Text>

            {session?.user?.email && (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>{t('profile.email')}</Text>
                <Text style={[styles.value, { color: colors.text }]}>{session.user.email}</Text>
              </>
            )}

            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('profile.language')}</Text>
            <Text style={[styles.value, { color: colors.text }]}>
              {profile?.locale ? LOCALE_LABELS[profile.locale as Locale] : LOCALE_LABELS.en}
            </Text>

            {crewProfile && (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>{t('profile.airline')}</Text>
                {airline ? (
                  <View style={styles.airlineRow}>
                    <Image source={{ uri: airline.logoUrl }} style={styles.airlineLogo} />
                    <Text style={[styles.value, styles.airlineNameText, { color: colors.text }]}>{airline.name}</Text>
                  </View>
                ) : (
                  <Text style={[styles.value, { color: colors.text }]}>{airlineName ?? t('profile.notSet')}</Text>
                )}
              </>
            )}

            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('profile.accountType')}</Text>
            <Text style={[styles.value, { color: colors.text }]}>
              {profile?.role === 'crew' ? t('signUp.crew') : t('signUp.family')}
            </Text>

            <TouchableOpacity
              style={styles.rosterSettingsRow}
              onPress={() => setRosterModalVisible(true)}
              activeOpacity={0.75}
            >
              <View style={styles.rosterSettingsRowInner}>
                <Ionicons name="settings-outline" size={22} color={colors.primary} />
                <Text style={[styles.rosterSettingsLabel, { color: colors.text }]}>
                  {t('profile.rosterListTasksTitle')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: 16 + Math.max(insets.bottom, 8) }]}>
          <TouchableOpacity style={styles.editButton} onPress={() => router.push('/(app)/(crew)/edit-profile')}>
            <View style={styles.editButtonContent}>
              <Ionicons name="pencil" size={22} color={colors.white} />
              <Text style={styles.editButtonText}>{t('common.edit')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.signOut} onPress={handleSignOut}>
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
            onPress={() => {
              Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
            }}
          >
            <Text style={[styles.policyLinkText, { color: colors.primary }]}>{t('profile.privacyPolicy')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.policyLink}
            onPress={() => {
              router.push('/(app)/consent-history');
            }}
          >
            <Text style={[styles.policyLinkText, { color: colors.primary }]}>{t('profile.consentHistory')}</Text>
          </TouchableOpacity>
        </View>

        <RosterListTasksModal
          visible={rosterModalVisible}
          onClose={() => setRosterModalVisible(false)}
          mode="crew"
          crewProfileId={crewProfile?.id ?? null}
          profileUserId={profile?.id ?? null}
          prefsSeed={prefsSeed}
          refreshProfile={refreshProfile}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
  },
  cardAvatarWrap: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    elevation: 10,
  },
  cardAvatarImage: {
    width: 128,
    height: 160,
    borderRadius: 12,
  },
  cardAvatarFallback: {
    width: 128,
    height: 160,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardAvatarInitial: { fontSize: 20, fontWeight: '700', color: colors.primary },
  airlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  airlineLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  airlineNameText: {
    flex: 1,
  },
  label: { fontSize: 14, marginBottom: 4, marginTop: 16, fontWeight: '700' },
  labelFirst: { marginTop: 0 },
  value: { fontSize: 16 },
  rosterSettingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rosterSettingsRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 8,
  },
  rosterSettingsLabel: { fontSize: 15, fontWeight: '700', flex: 1 },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  editButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  editButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editButtonText: { color: colors.white, fontWeight: '700', fontSize: 17 },
  signOut: {
    marginTop: 12,
    backgroundColor: colors.error,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7A0000',
  },
  deleteAccount: {
    marginTop: 12,
    backgroundColor: '#8B0000',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5A0000',
  },
  buttonDisabled: { opacity: 0.7 },
  policyLink: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 4,
  },
  policyLinkText: {
    fontSize: 13,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  signOutContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signOutText: { color: colors.white, fontWeight: '700', fontSize: 16 },
});
