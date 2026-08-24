import { useMemo } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../lib/legalUrls';
import { colors, useThemeMode } from '../theme/colors';

type Props = {
  /** Optional in-app screens (App.tsx stack). External URLs always open as fallback. */
  onOpenPrivacy?: () => void;
  onOpenTerms?: () => void;
};

export function SubscriptionLegalDisclosure({ onOpenPrivacy, onOpenTerms }: Props) {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);

  const openPrivacy = () => {
    if (onOpenPrivacy) {
      onOpenPrivacy();
      return;
    }
    void Linking.openURL(PRIVACY_POLICY_URL);
  };

  const openTerms = () => {
    if (onOpenTerms) {
      onOpenTerms();
      return;
    }
    void Linking.openURL(TERMS_OF_USE_URL);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>{t('plans.legalHeading')}</Text>
      <Text style={styles.line}>{t('plans.legalSubscriptionTitle')}</Text>
      <Text style={styles.line}>{t('plans.legalSubscriptionLength')}</Text>
      <Text style={styles.line}>{t('plans.legalSubscriptionPrice')}</Text>
      <Text style={styles.line}>{t('plans.legalAddonPrice')}</Text>
      <Text style={styles.disclaimer}>{t('plans.autoRenewDisclaimer')}</Text>
      <View style={styles.linksRow}>
        <TouchableOpacity onPress={openPrivacy} accessibilityRole="link">
          <Text style={styles.link}>{t('legal.privacyTitle')}</Text>
        </TouchableOpacity>
        <Text style={styles.linkSep}> · </Text>
        <TouchableOpacity onPress={openTerms} accessibilityRole="link">
          <Text style={styles.link}>{t('legal.termsTitle')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    box: {
      marginTop: 18,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    heading: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 14,
      marginBottom: 8,
    },
    line: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      marginBottom: 4,
    },
    disclaimer: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 8,
      marginBottom: 10,
    },
    linksRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    link: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    linkSep: {
      color: colors.textMuted,
      fontSize: 13,
    },
  });
}
