import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Alert, Platform, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, useThemeMode } from '../../theme/colors';
import { radius, shadow } from '../../theme/tokens';
import { updateCrewRoomPrefs, type CrewRoomMe } from '../../lib/crewRoom';
import { crewRoomErrorMessage, pickCrewRoomLevel } from './CrewRoomParts';

type Props = {
  me: CrewRoomMe;
  onClose: () => void;
  onChanged: () => void;
};

export function CrewRoomSettingsSheet({ me, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      Alert.alert(t('common.error'), crewRoomErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const editDefaultLevel = () => {
    pickCrewRoomLevel(t, {
      title: t('crewRoom.settings.defaultLevel'),
      message: t('crewRoom.level.explain'),
      current: me.default_level,
      onPick: (level) => {
        if (level) void run(() => updateCrewRoomPrefs({ defaultLevel: level }));
      },
    });
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 14 : Math.max(insets.top, 8) + 6 }]}>
          <Text style={styles.title} numberOfLines={1}>
            {t('crewRoom.settings.title')}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('crewRoom.person.close')}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 32 + Math.max(insets.bottom, 8) }]}>
          <View style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity style={[styles.row, styles.rowDivider]} onPress={editDefaultLevel} disabled={busy}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{t('crewRoom.settings.defaultLevel')}</Text>
                <Text style={styles.rowMeta}>{t('crewRoom.settings.defaultLevelHint')}</Text>
              </View>
              <Text style={styles.valueText}>{t(`crewRoom.level.${me.default_level}`)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={[styles.row, styles.rowDivider]}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{t('crewRoom.settings.invisible')}</Text>
                <Text style={styles.rowMeta}>{t('crewRoom.settings.invisibleHint')}</Text>
              </View>
              <Switch
                value={me.invisible}
                disabled={busy}
                onValueChange={(v) => void run(() => updateCrewRoomPrefs({ invisible: v }))}
              />
            </View>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{t('crewRoom.settings.notifyLayover')}</Text>
                <Text style={styles.rowMeta}>{t('crewRoom.settings.notifyLayoverHint')}</Text>
              </View>
              <Switch
                value={me.notify_layover}
                disabled={busy}
                onValueChange={(v) => void run(() => updateCrewRoomPrefs({ notifyLayover: v }))}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 12,
    },
    title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { paddingHorizontal: 16 },
    card: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, minHeight: 56 },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
    rowMeta: { fontSize: 12, marginTop: 2, color: colors.textMuted, lineHeight: 16 },
    valueText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  });
}
