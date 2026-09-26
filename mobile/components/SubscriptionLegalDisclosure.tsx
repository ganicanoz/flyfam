import { useMemo, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../lib/legalUrls';
import { colors, useThemeMode } from '../theme/colors';

type Props = {
  /** Optional in-app screens (App.tsx stack). External URLs always open as fallback. */
  onOpenPrivacy?: () => void;
  onOpenTerms?: () => void;
  /** Compact summary rows + expandable details (Plans screen). */
  compact?: boolean;
  /** Extra footer under legal links (e.g. restore purchases). */
  footer?: ReactNode;
};

export function SubscriptionLegalDisclosure({
  onOpenPrivacy,
  onOpenTerms,
  compact = false,
  footer,
}: Props) {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [detailsOpen, setDetailsOpen] = useState(false);

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

  if (compact) {
    return (
      <View style={styles.box}>
        <View style={styles.summaryRow}>
          <Ionicons name="refresh-outline" size={16} color={colors.primary} />
          <Text style={styles.summaryText}>{t('plans.legalSummaryRenew')}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Ionicons name="close-circle-outline" size={16} color={colors.primary} />
          <Text style={styles.summaryText}>{t('plans.legalSummaryCancel')}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Ionicons name="logo-apple" size={16} color={colors.primary} />
          <Text style={styles.summaryText}>{t('plans.legalSummaryStore')}</Text>
        </View>

        <TouchableOpacity
          onPress={() => setDetailsOpen((v) => !v)}
          style={styles.detailsToggle}
          accessibilityRole="button"
        >
          <Text style={styles.detailsToggleText}>{t('plans.legalDetails')}</Text>
          <Ionicons
            name={detailsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.primary}
          />
        </TouchableOpacity>

        {detailsOpen ? (
          <View style={styles.detailsBody}>
            <Text style={styles.line}>{t('plans.legalSubscriptionTitle')}</Text>
            <Text style={styles.line}>{t('plans.legalSubscriptionLength')}</Text>
            <Text style={styles.line}>{t('plans.legalSubscriptionPrice')}</Text>
            <Text style={styles.line}>{t('plans.legalAddonPrice')}</Text>
            <Text style={styles.disclaimer}>{t('plans.autoRenewDisclaimer')}</Text>
          </View>
        ) : null}

        <View style={styles.linksRow}>
          <TouchableOpacity onPress={openPrivacy} accessibilityRole="link">
            <Text style={styles.link}>{t('legal.privacyTitle')}</Text>
          </TouchableOpacity>
          <Text style={styles.linkSep}>·</Text>
          <TouchableOpacity onPress={openTerms} accessibilityRole="link">
            <Text style={styles.link}>{t('legal.termsTitle')}</Text>
          </TouchableOpacity>
        </View>
        {footer}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>{t('plans.legalHeading')}</Text>
      <Text style={styles.line}>{t('plans.legalSubscriptionTitle')}</Text>
      <Text style={styles.line}>{t('plans.legalSubscriptionLength')}</Text>
      <Text style={styles.line}>{t('plans.legalSubscriptionPrice')}</Text>
      <Text style={styles.line}>{t('plans.legalAddonPrice')}</Text>
      <Text style={styles.disclaimer}>{t('plans.autoRenewDisclaimer')}</Text>
      <View style={styles.linksCol}>
        <TouchableOpacity onPress={openPrivacy} accessibilityRole="link" style={styles.linkHit}>
          <Text style={styles.link}>{t('legal.privacyTitle')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openTerms} accessibilityRole="link" style={styles.linkHit}>
          <Text style={styles.link}>{t('legal.termsTitle')}</Text>
        </TouchableOpacity>
      </View>
      {footer}
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
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
    },
    summaryText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      flex: 1,
    },
    detailsToggle: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      minHeight: 36,
    },
    detailsToggleText: {
      color: colors.primary,
      fontWeight: '700',
      fontSize: 13,
    },
    detailsBody: {
      marginTop: 4,
      marginBottom: 4,
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
    linksCol: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 8,
    },
    linksRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 10,
    },
    linkSep: { color: colors.textMuted },
    linkHit: {
      alignSelf: 'stretch',
    },
    link: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
      textDecorationLine: 'underline',
      flexShrink: 1,
    },
  });
}
