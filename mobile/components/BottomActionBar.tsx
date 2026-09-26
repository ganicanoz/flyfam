import { useMemo, type ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, useThemeMode } from '../theme/colors';
import { spacing } from '../theme/tokens';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Sticky footer bar on theme background; sits above home indicator / keyboard parent. */
export function BottomActionBar({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 12),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    bar: {
      paddingHorizontal: spacing.xl,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  });
}
