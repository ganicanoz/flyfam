import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Alert,
  ScrollView,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import {
  normalizeRosterListShow,
  type RosterListShowPrefs,
} from '../lib/rosterListPreferences';
import { saveFamilyRosterListShow } from '../lib/familyRosterListPrefs';
import { colors, useThemeMode } from '../theme/colors';
import {
  setFontSizePreset,
  useFontSizePreset,
  useFontScaleMultiplier,
  type FontSizePreset,
} from '../theme/fontScale';

export type RosterListTasksModalProps = {
  visible: boolean;
  onClose: () => void;
  mode: 'crew' | 'family';
  crewProfileId: string | null;
  profileUserId: string | null;
  prefsSeed: RosterListShowPrefs;
  refreshProfile: () => Promise<void>;
  onAfterSave?: () => void;
};

export function RosterListTasksModal({
  visible,
  onClose,
  mode,
  crewProfileId,
  profileUserId,
  prefsSeed,
  refreshProfile,
  onAfterSave,
}: RosterListTasksModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const themeMode = useThemeMode();
  const fontPreset = useFontSizePreset();
  const fontScale = useFontScaleMultiplier();
  const fs = (n: number) => Math.round(n * fontScale);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 20,
        },
        sheet: {
          width: '100%',
          maxWidth: 400,
          backgroundColor: colors.surface,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        },
        sheetTitle: {
          fontSize: fs(18),
          fontWeight: '800',
          color: colors.text,
          paddingHorizontal: 18,
          paddingTop: 18,
          paddingBottom: 8,
        },
        sheetScroll: { maxHeight: 360 },
        sheetScrollContent: { paddingHorizontal: 18, paddingBottom: 8 },
        hint: { fontSize: fs(13), lineHeight: fs(18), color: colors.textMuted, marginBottom: 12 },
        saving: { marginVertical: 8 },
        fontSection: { marginBottom: 8 },
        fontSectionTitle: {
          fontSize: fs(15),
          fontWeight: '700',
          color: colors.text,
          marginBottom: 6,
        },
        fontSectionHint: { fontSize: fs(12), color: colors.textMuted, marginBottom: 10, lineHeight: fs(16) },
        fontChipsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
        fontChip: {
          flex: 1,
          paddingVertical: 10,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surfaceAlt,
          alignItems: 'center',
        },
        fontChipActive: {
          borderColor: colors.primary,
          backgroundColor: colors.primaryLight,
        },
        fontChipText: { fontSize: fs(14), fontWeight: '700', color: colors.text },
        fontChipTextActive: { color: colors.primary },
        prefRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        prefRowLast: { borderBottomWidth: 0 },
        prefLabel: { fontSize: fs(15), flex: 1, paddingRight: 12, color: colors.text },
        doneBtn: {
          marginHorizontal: 18,
          marginTop: 4,
          marginBottom: 16,
          backgroundColor: colors.primary,
          paddingVertical: 14,
          borderRadius: 10,
          alignItems: 'center',
        },
        doneBtnText: { color: colors.white, fontWeight: '700', fontSize: fs(17) },
      }),
    [fontScale, themeMode]
  );
  const [prefs, setPrefs] = useState<RosterListShowPrefs>(() => normalizeRosterListShow(prefsSeed));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setPrefs(normalizeRosterListShow(prefsSeed));
  }, [visible, prefsSeed]);

  const persist = useCallback(
    async (next: RosterListShowPrefs) => {
      if (mode === 'crew') {
        if (!crewProfileId) return;
        setSaving(true);
        const { error } = await supabase
          .from('crew_profiles')
          .update({ roster_list_show: next })
          .eq('id', crewProfileId);
        setSaving(false);
        if (error) {
          Alert.alert(t('common.error'), error.message);
          setPrefs(normalizeRosterListShow(prefsSeed));
          return;
        }
        await refreshProfile();
        onAfterSave?.();
        return;
      }
      if (!profileUserId) return;
      setSaving(true);
      try {
        await saveFamilyRosterListShow(profileUserId, next);
        onAfterSave?.();
      } catch (e) {
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
        setPrefs(normalizeRosterListShow(prefsSeed));
      } finally {
        setSaving(false);
      }
    },
    [mode, crewProfileId, profileUserId, prefsSeed, refreshProfile, onAfterSave, t]
  );

  const onToggle = (key: keyof RosterListShowPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void persist(next);
  };

  const onSetTimeDisplay = (value: 'local' | 'utc') => {
    if (prefs.time_display === value) return;
    const next = { ...prefs, time_display: value };
    setPrefs(next);
    void persist(next);
  };

  const maxH = Math.min(winH * 0.78, 520);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { maxHeight: maxH, marginBottom: Math.max(insets.bottom, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.sheetTitle}>{t('profile.rosterListTasksTitle')}</Text>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={styles.hint}>{t('profile.rosterListTasksHint')}</Text>
            <View style={styles.fontSection}>
              <Text style={styles.fontSectionTitle}>{t('profile.rosterFontSizeTitle')}</Text>
              <Text style={styles.fontSectionHint}>{t('profile.rosterFontSizeHint')}</Text>
              <View style={styles.fontChipsRow}>
                {(
                  [
                    ['small', 'profile.rosterFontSizeSmall'],
                    ['medium', 'profile.rosterFontSizeMedium'],
                    ['large', 'profile.rosterFontSizeLarge'],
                  ] as const
                ).map(([key, labelKey]) => {
                  const active = fontPreset === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.fontChip, active && styles.fontChipActive]}
                      onPress={() => void setFontSizePreset(key as FontSizePreset)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.fontChipText, active && styles.fontChipTextActive]}>
                        {t(labelKey)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {mode === 'crew' ? (
              <View style={styles.fontSection}>
                <Text style={styles.fontSectionTitle}>{t('profile.rosterTimeDisplayTitle')}</Text>
                <Text style={styles.fontSectionHint}>{t('profile.rosterTimeDisplayHint')}</Text>
                <View style={styles.fontChipsRow}>
                  {(
                    [
                      ['local', 'profile.rosterTimeDisplayLocal'],
                      ['utc', 'profile.rosterTimeDisplayUtc'],
                    ] as const
                  ).map(([key, labelKey]) => {
                    const active = prefs.time_display === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.fontChip, active && styles.fontChipActive]}
                        onPress={() => onSetTimeDisplay(key)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.fontChipText, active && styles.fontChipTextActive]}>
                          {t(labelKey)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}
            {saving ? <ActivityIndicator style={styles.saving} color={colors.primary} /> : null}
            <View style={styles.prefRow}>
              <Text style={styles.prefLabel}>{t('profile.rosterShowOffDays')}</Text>
              <Switch
                value={prefs.off_days}
                onValueChange={(v) => onToggle('off_days', v)}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={prefs.off_days ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={styles.prefRow}>
              <Text style={styles.prefLabel}>{t('profile.rosterShowTraining')}</Text>
              <Switch
                value={prefs.training}
                onValueChange={(v) => onToggle('training', v)}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={prefs.training ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={styles.prefRow}>
              <Text style={styles.prefLabel}>{t('profile.rosterShowSimulator')}</Text>
              <Switch
                value={prefs.simulator}
                onValueChange={(v) => onToggle('simulator', v)}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={prefs.simulator ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={[styles.prefRow, styles.prefRowLast]}>
              <Text style={styles.prefLabel}>{t('profile.rosterShowOther')}</Text>
              <Switch
                value={prefs.other}
                onValueChange={(v) => onToggle('other', v)}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={prefs.other ? colors.primary : colors.textMuted}
              />
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>{t('common.ok')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
