import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
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
  type FontSizePreset,
} from '../theme/fontScale';
import { useSession } from '../contexts/SessionContext';
import { SegmentControl, SettingsSectionHeader } from './SegmentControl';
import Ionicons from '@expo/vector-icons/Ionicons';

export type RosterListTasksModalProps = {
  visible: boolean;
  onClose: () => void;
  mode: 'crew' | 'family';
  crewProfileId: string | null;
  profileUserId: string | null;
  prefsSeed: RosterListShowPrefs;
  refreshProfile: () => Promise<void>;
  onAfterSave?: () => void;
  /** Crew only — opens clear-all flow after sheet closes. */
  onClearAllFlights?: () => void;
};

const FONT_PREVIEW_PT: Record<FontSizePreset, number> = {
  small: 13,
  medium: 15,
  large: 17,
};

function prefsEqual(a: RosterListShowPrefs, b: RosterListShowPrefs): boolean {
  return (
    a.flights_only === b.flights_only &&
    a.time_display === b.time_display &&
    a.show_calendar === b.show_calendar &&
    a.show_list === b.show_list
  );
}

export function RosterListTasksModal({
  visible,
  onClose,
  mode,
  crewProfileId,
  profileUserId,
  prefsSeed,
  refreshProfile: _refreshProfile,
  onAfterSave,
  onClearAllFlights,
}: RosterListTasksModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const themeMode = useThemeMode();
  const { patchCrewProfile } = useSession();
  const fontPreset = useFontSizePreset();
  const [optimisticFont, setOptimisticFont] = useState<FontSizePreset>(fontPreset);
  const fieldFill = themeMode === 'dark' ? '#1A2740' : '#F0F1F5';
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [prefs, setPrefs] = useState<RosterListShowPrefs>(() => normalizeRosterListShow(prefsSeed));
  const [saving, setSaving] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      setPrefs(normalizeRosterListShow(prefsSeed));
      setOptimisticFont(fontPreset);
    }
  }, [visible, prefsSeed, fontPreset]);

  const persist = useCallback(
    async (next: RosterListShowPrefs) => {
      if (mode === 'crew') {
        if (!crewProfileId) return false;
        const { error } = await supabase
          .from('crew_profiles')
          .update({ roster_list_show: next })
          .eq('id', crewProfileId);
        if (error) {
          Alert.alert(t('common.error'), error.message);
          return false;
        }
        patchCrewProfile({ roster_list_show: next });
        onAfterSave?.();
        return true;
      }
      if (!profileUserId) return false;
      try {
        await saveFamilyRosterListShow(profileUserId, next);
        onAfterSave?.();
        return true;
      } catch (e) {
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [mode, crewProfileId, profileUserId, patchCrewProfile, onAfterSave, t],
  );

  /** Apply font + prefs when sheet closes — avoids freezing Roster under an open modal. */
  const handleClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const fontChanged = optimisticFont !== fontPreset;
    const rosterChanged = !prefsEqual(prefs, normalizeRosterListShow(prefsSeed));
    if (fontChanged) {
      void setFontSizePreset(optimisticFont);
    }
    if (rosterChanged) {
      setSaving(true);
      const ok = await persist(prefs);
      setSaving(false);
      if (!ok) {
        setPrefs(normalizeRosterListShow(prefsSeed));
        closingRef.current = false;
        return;
      }
    }
    onClose();
  }, [optimisticFont, fontPreset, prefs, prefsSeed, persist, onClose]);

  const showInfo = (title: string, body: string) => {
    Alert.alert(title, body);
  };

  const sheetMaxH = Math.min(winH * 0.78, 580);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => void handleClose()}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={() => void handleClose()}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxH,
              paddingBottom: Math.max(insets.bottom, 12) + 4,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.headerRow}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {t('profile.listSettingsTitle')}
            </Text>
            <TouchableOpacity
              onPress={() => void handleClose()}
              hitSlop={{ top: 10, bottom: 10, left: 12, right: 4 }}
              disabled={saving}
            >
              <Text style={styles.doneText}>{t('profile.listSettingsDone')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <SettingsSectionHeader
              title={t('profile.rosterFontSizeTitle')}
              hint={t('profile.rosterFontSizeHint')}
              onInfoPress={() =>
                showInfo(t('profile.rosterFontSizeTitle'), t('profile.rosterFontSizeInfo'))
              }
            />
            <SegmentControl<FontSizePreset>
              trackColor={fieldFill}
              value={optimisticFont}
              onChange={setOptimisticFont}
              options={(
                [
                  ['small', 'profile.rosterFontSizeSmall'],
                  ['medium', 'profile.rosterFontSizeMedium'],
                  ['large', 'profile.rosterFontSizeLarge'],
                ] as const
              ).map(([key, labelKey]) => ({
                value: key,
                label: t(labelKey),
                labelStyle: { fontSize: FONT_PREVIEW_PT[key] },
              }))}
              style={styles.segment}
            />

            <View style={styles.divider} />

            <SettingsSectionHeader
              title={t('profile.rosterSurfaceTitle')}
              hint={t('profile.rosterSurfaceHint')}
              onInfoPress={() =>
                showInfo(t('profile.rosterSurfaceTitle'), t('profile.rosterSurfaceHint'))
              }
            />
            <SegmentControl<'list' | 'calendar'>
              trackColor={fieldFill}
              value={prefs.show_calendar ? 'calendar' : 'list'}
              onChange={(value) => {
                const nextCalendar = value === 'calendar';
                setPrefs((p) => ({
                  ...p,
                  show_calendar: nextCalendar,
                  show_list: !nextCalendar,
                }));
              }}
              options={[
                { value: 'list', label: t('profile.rosterSurfaceList') },
                { value: 'calendar', label: t('profile.rosterSurfaceCalendar') },
              ]}
              style={styles.segment}
            />

            <View style={styles.divider} />

            {mode === 'crew' ? (
              <>
                <SettingsSectionHeader
                  title={t('profile.rosterTimeDisplayTitle')}
                  hint={t('profile.rosterTimeDisplayHint')}
                  onInfoPress={() =>
                    showInfo(t('profile.rosterTimeDisplayTitle'), t('profile.rosterTimeDisplayInfo'))
                  }
                />
                <SegmentControl<'local' | 'utc'>
                  trackColor={fieldFill}
                  value={prefs.time_display}
                  onChange={(value) => {
                    if (prefs.time_display === value) return;
                    setPrefs((p) => ({ ...p, time_display: value }));
                  }}
                  options={[
                    { value: 'local', label: t('profile.rosterTimeDisplayLocal') },
                    { value: 'utc', label: t('profile.rosterTimeDisplayUtc') },
                  ]}
                  style={styles.segment}
                />
                <View style={styles.divider} />
              </>
            ) : null}

            <SettingsSectionHeader
              title={t('profile.rosterFlightsOnlyTitle')}
              hint={t('profile.rosterFlightsOnlyHint')}
              onInfoPress={() =>
                showInfo(t('profile.rosterFlightsOnlyTitle'), t('profile.rosterFlightsOnlyInfo'))
              }
            />

            <View style={styles.prefRow}>
              <Text style={styles.prefLabel}>{t('profile.rosterFlightsOnlyLabel')}</Text>
              <Switch
                value={prefs.flights_only}
                onValueChange={(v) => setPrefs((p) => ({ ...p, flights_only: v }))}
                trackColor={{ false: colors.border, true: colors.primary + '99' }}
                thumbColor={prefs.flights_only ? colors.primary : colors.textMuted}
                ios_backgroundColor={colors.border}
              />
            </View>

            {mode === 'crew' && onClearAllFlights ? (
              <>
                <View style={styles.divider} />
                <SettingsSectionHeader title={t('roster.dataSectionTitle')} />
                <TouchableOpacity
                  style={styles.dangerRow}
                  onPress={() => {
                    void (async () => {
                      await handleClose();
                      onClearAllFlights();
                    })();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('roster.clearAllFlights')}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                  <Text style={styles.dangerRowText}>{t('roster.clearAllFlights')}</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
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
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(15,27,61,0.45)',
    },
    sheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: 0,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      marginBottom: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 2,
      marginBottom: 12,
    },
    sheetTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: '800',
      color: colors.text,
    },
    doneText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.primary,
    },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingBottom: 8 },
    segment: { marginBottom: 4 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 14,
    },
    prefRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      gap: 10,
    },
    prefLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    dangerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: 4,
    },
    dangerRowText: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.error,
    },
  });
}
