import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors, useThemeMode } from '../theme/colors';
import { useStackGoBack } from '../lib/useStackGoBack';
import { typography } from '../theme/tokens';

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
};

/**
 * Roster-style page chrome: no blue stack header —
 * round back chip + large dark title (+ optional muted subtitle).
 */
export function ScreenPageHeader({ title, subtitle, onBack }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const goBack = useStackGoBack();

  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) }]}>
      <TouchableOpacity
        onPress={onBack ?? goBack}
        style={styles.backBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <Ionicons name="chevron-back" size={20} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.titleCol}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleCol: {
      flex: 1,
      flexShrink: 1,
      justifyContent: 'center',
    },
    title: {
      color: colors.text,
      fontSize: typography.title.fontSize,
      fontWeight: '800',
      letterSpacing: -0.3,
    },
    subtitle: {
      marginTop: 2,
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '500',
      lineHeight: 18,
    },
  });
}
