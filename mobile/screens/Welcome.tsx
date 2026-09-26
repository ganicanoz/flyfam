import { View, Text, StyleSheet, Image, Alert, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { changeAppLocale } from '../lib/i18n';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { splashIconAsset, splashWordmarkAsset } from '../constants/splashBrand';
import { colors } from '../theme/colors';
import { spacing } from '../theme/tokens';

const GRADIENT = ['#B8CCF5', '#D6E2F8', '#F5F6FA'] as const;

export default function Welcome() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const isTr = String(i18n.language ?? '').toLowerCase().startsWith('tr');

  const openLanguageMenu = () => {
    Alert.alert(t('profile.language'), undefined, [
      {
        text: '🇹🇷 Türkçe',
        onPress: () => {
          void changeAppLocale('tr');
        },
      },
      {
        text: '🇬🇧 English',
        onPress: () => {
          void changeAppLocale('en');
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...GRADIENT]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />

      {/* Soft vector décor — not stock photography */}
      <View pointerEvents="none" style={styles.decorLayer}>
        <View style={[styles.cloud, styles.cloudA]} />
        <View style={[styles.cloud, styles.cloudB]} />
        <View style={[styles.cloud, styles.cloudC]} />
        <View style={styles.routeWrap}>
          <View style={styles.routeDashRow}>
            {Array.from({ length: 14 }).map((_, i) => (
              <View key={i} style={[styles.routeDash, i % 2 === 1 && styles.routeDashGap]} />
            ))}
          </View>
        </View>
      </View>

      <View
        style={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 12) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
          },
        ]}
      >
        <View style={styles.topBar}>
          <View style={styles.topBarSpacer} />
          <Pressable
            onPress={openLanguageMenu}
            style={styles.langPill}
            accessibilityRole="button"
            accessibilityLabel={t('profile.language')}
          >
            <Text style={styles.langPillText}>{isTr ? '🇹🇷 TR ▾' : '🇬🇧 EN ▾'}</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Image
            source={splashIconAsset}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="FlyFam"
          />
          <Image
            source={splashWordmarkAsset}
            style={styles.wordmark}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <Text style={styles.tagline}>{t('splash.tagline')}</Text>
        </View>

        <View style={styles.flexGrow} />

        <View style={styles.actions}>
          <PrimaryButton title={t('welcome.signIn')} onPress={() => navigation.navigate('SignIn')} />
          <SecondaryButton
            title={t('welcome.signUp')}
            onPress={() => navigation.navigate('SignUp')}
            style={styles.secondaryGap}
          />
        </View>

        <Text style={styles.legal}>
          {t('welcome.legalBefore')}
          <Text
            style={styles.legalLink}
            onPress={() => navigation.navigate('TermsDisclaimer')}
          >
            {t('welcome.termsLink')}
          </Text>
          {t('welcome.legalAnd')}
          <Text
            style={styles.legalLink}
            onPress={() => navigation.navigate('PrivacyNotice')}
          >
            {t('welcome.privacyLink')}
          </Text>
          {t('welcome.legalAfter')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F6FA',
  },
  decorLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  cloud: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
  },
  cloudA: { width: 160, height: 52, top: '18%', left: -40 },
  cloudB: { width: 120, height: 40, top: '28%', right: -20 },
  cloudC: { width: 90, height: 32, top: '42%', left: '22%' },
  routeWrap: {
    position: 'absolute',
    top: '36%',
    left: '12%',
    right: '12%',
    transform: [{ rotate: '-8deg' }],
    opacity: 0.14,
  },
  routeDashRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeDash: {
    height: 2,
    width: 10,
    borderRadius: 1,
    backgroundColor: '#FFFFFF',
  },
  routeDashGap: {
    width: 6,
    backgroundColor: 'transparent',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  topBarSpacer: { flex: 1 },
  langPill: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    minHeight: 36,
    justifyContent: 'center',
  },
  langPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  hero: {
    alignItems: 'center',
    marginTop: 28,
    paddingHorizontal: 8,
  },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 24,
  },
  wordmark: {
    marginTop: 16,
    width: 168,
    height: 44,
  },
  tagline: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  flexGrow: { flex: 1, minHeight: 24 },
  actions: {
    width: '100%',
    marginBottom: 16,
  },
  secondaryGap: {
    marginTop: 12,
  },
  legal: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  legalLink: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
