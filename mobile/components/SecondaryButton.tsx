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

/** Full-width secondary pill — white fill, gray border, dark label (header icon-button language). */
export function SecondaryButton({ title, onPress, loading, disabled, style }: Props) {
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
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Text style={styles.btnText}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

function createStyles() {
  return StyleSheet.create({
    btn: {
      backgroundColor: colors.surface,
      paddingVertical: 16,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 52,
    },
    btnDisabled: { opacity: 0.4 },
    btnText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
