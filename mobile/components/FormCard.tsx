import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, useThemeMode } from '../theme/colors';
import { radius, shadow } from '../theme/tokens';
import { useMemo } from 'react';

type FormCardProps = {
  children: ReactNode;
  /** Optional left accent strip (flight blue / status green). */
  accentColor?: string;
  style?: object;
};

/** White roster-style card: hairline border, 20pt radius, optional accent. */
export function FormCard({ children, accentColor, style }: FormCardProps) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createCardStyles(), [themeMode]);
  return (
    <View style={[styles.card, shadow.card, style]}>
      {accentColor ? <View style={[styles.accent, { backgroundColor: accentColor }]} /> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

type SectionTitleProps = {
  children: string;
  style?: object;
};

/** Compact bold section label — matches roster day headers. */
export function FormSectionTitle({ children, style }: SectionTitleProps) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createCardStyles(), [themeMode]);
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

function createCardStyles() {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 12,
    },
    accent: { width: 4 },
    body: { flex: 1, paddingVertical: 4 },
    sectionTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 8,
      marginTop: 4,
      paddingHorizontal: 4,
    },
  });
}
