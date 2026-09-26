import { useMemo, type ReactNode } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, useThemeMode } from '../theme/colors';
import { radius } from '../theme/tokens';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Optional label style (e.g. real font-size preview). */
  labelStyle?: StyleProp<TextStyle>;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  /** Track fill; defaults to light gray field fill. */
  trackColor?: string;
};

/**
 * Roster-calendar style segments: gray track, selected = filled blue + white label.
 */
export function SegmentControl<T extends string>({
  options,
  value,
  onChange,
  style,
  trackColor,
}: Props<T>) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const track = trackColor ?? (themeMode === 'dark' ? '#1A2740' : '#F0F1F5');

  return (
    <View style={[styles.track, { backgroundColor: track }, style]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.seg, active && styles.segActive]}
            onPress={() => {
              if (opt.value !== value) onChange(opt.value);
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[styles.segText, active && styles.segTextActive, opt.labelStyle]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  hint?: string;
  onInfoPress?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Compact bold section label (roster day-header weight) + optional one-line hint / ⓘ. */
export function SettingsSectionHeader({ title, hint, onInfoPress, right, style }: SectionHeaderProps) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);

  return (
    <View style={[styles.sectionWrap, style]}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onInfoPress ? (
          <TouchableOpacity
            onPress={onInfoPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Info"
            style={styles.infoBtn}
          >
            <Text style={styles.infoGlyph}>ⓘ</Text>
          </TouchableOpacity>
        ) : null}
        {right}
      </View>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    track: {
      flexDirection: 'row',
      borderRadius: radius.pill,
      padding: 3,
      gap: 2,
    },
    seg: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 40,
    },
    segActive: {
      backgroundColor: colors.primary,
    },
    segText: {
      color: colors.textMuted,
      fontWeight: '700',
      fontSize: 14,
    },
    segTextActive: {
      color: colors.onPrimary,
    },
    sectionWrap: {
      marginBottom: 10,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    infoBtn: {
      paddingHorizontal: 2,
      paddingVertical: 1,
    },
    infoGlyph: {
      fontSize: 15,
      color: colors.textMuted,
      fontWeight: '600',
    },
    sectionHint: {
      marginTop: 4,
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
    },
  });
}
