import { useMemo } from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { colors, useThemeMode } from '../theme/colors';
import { radius } from '../theme/tokens';

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Full-width primary pill CTA — blue fill, 40% opacity when disabled. */
export function PrimaryButton({ title, onPress, loading, disabled, style }: Props) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const inactive = !!(disabled || loading);

  return (
    <TouchableOpacity
      style={[styles.btn, inactive && styles.btnDisabled, style]}
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <Text style={styles.btnText}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

function createStyles() {
  return StyleSheet.create({
    btn: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 52,
    },
    btnDisabled: { opacity: 0.4 },
    btnText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
