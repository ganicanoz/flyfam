import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Switch,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, useThemeMode } from '../theme/colors';
import {
  flightsForClearScope,
  type ClearableFlightRow,
} from '../lib/rosterFlightClear';

export type ClearFlightsConfirmModalProps = {
  visible: boolean;
  flights: ClearableFlightRow[];
  todayYmd: string;
  onConfirm: (toDelete: ClearableFlightRow[]) => void;
  onCancel: () => void;
};

/** Confirm clear with default = future; optional include-past toggle. */
export function ClearFlightsConfirmModal({
  visible,
  flights,
  todayYmd,
  onConfirm,
  onCancel,
}: ClearFlightsConfirmModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [includePast, setIncludePast] = useState(false);

  useEffect(() => {
    if (visible) setIncludePast(false);
  }, [visible]);

  const scope = includePast ? 'all' : 'future';
  const { toDelete, activeKept } = flightsForClearScope(flights, scope, todayYmd);
  const count = toDelete.length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              marginBottom: Math.max(insets.bottom, 24),
            },
          ]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{t('roster.clearAllTitle')}</Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {includePast
              ? t('roster.clearAllIncludingPastConfirmMessage', { count })
              : t('roster.clearFutureConfirmMessage', { count })}
          </Text>
          {activeKept > 0 ? (
            <Text style={[styles.note, { color: colors.textMuted }]}>
              {t('roster.clearActiveKeptNote')}
            </Text>
          ) : null}

          <View style={styles.toggleRow}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>
              {t('roster.clearIncludePastToggle')}
            </Text>
            <Switch
              value={includePast}
              onValueChange={setIncludePast}
              trackColor={{ false: colors.border, true: colors.primary + '99' }}
              thumbColor={includePast ? colors.primary : colors.textMuted}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: colors.text }]}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.destructiveBtn, { backgroundColor: colors.error }]}
              onPress={() => onConfirm(toDelete)}
              disabled={count === 0}
              accessibilityRole="button"
            >
              <Text style={styles.destructiveText}>{t('roster.clearAllConfirm')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(15,27,61,0.45)',
    },
    card: {
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 20,
    },
    title: {
      fontSize: 17,
      fontWeight: '800',
      marginBottom: 8,
    },
    message: {
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 22,
      marginBottom: 8,
    },
    note: {
      fontSize: 13,
      fontWeight: '500',
      marginBottom: 12,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    toggleLabel: {
      flex: 1,
      fontSize: 14,
      fontWeight: '600',
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 8,
    },
    btn: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    cancelBtn: {
      borderWidth: StyleSheet.hairlineWidth * 2,
      backgroundColor: 'transparent',
    },
    cancelText: { fontSize: 16, fontWeight: '700' },
    destructiveBtn: { opacity: 1 },
    destructiveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
}
