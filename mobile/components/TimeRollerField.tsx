import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, useThemeMode } from '../theme/colors';

const ITEM_H = 40;
const VISIBLE_ROWS = 5;
const PAD = ((VISIBLE_ROWS - 1) / 2) * ITEM_H;

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function parseHHmm(value: string): { h: number; m: number } | null {
  const v = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(v)) return null;
  const [hs, ms] = v.split(':');
  const h = Number(hs);
  const m = Number(ms);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function formatHHmm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

type WheelProps = {
  data: string[];
  index: number;
  onIndexChange: (index: number) => void;
  enabled: boolean;
};

function WheelColumn({ data, index, onIndexChange, enabled }: WheelProps) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(themeMode), [themeMode]);
  const scrollRef = useRef<ScrollView>(null);
  const settling = useRef(false);

  const scrollToIndex = useCallback(
    (i: number, animated: boolean) => {
      const y = Math.max(0, i) * ITEM_H;
      scrollRef.current?.scrollTo({ y, animated });
    },
    [],
  );

  const onLayout = () => {
    // Modal her açılışta mount → seçili satırı ortala.
    requestAnimationFrame(() => scrollToIndex(index, false));
  };

  const snapFromOffset = useCallback(
    (y: number) => {
      const raw = Math.round(y / ITEM_H);
      const next = Math.max(0, Math.min(data.length - 1, raw));
      settling.current = true;
      scrollRef.current?.scrollTo({ y: next * ITEM_H, animated: true });
      if (next !== index) onIndexChange(next);
      setTimeout(() => {
        settling.current = false;
      }, 120);
    },
    [data.length, index, onIndexChange],
  );

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!enabled || settling.current) return;
    snapFromOffset(e.nativeEvent.contentOffset.y);
  };

  return (
    <View style={styles.wheelCol}>
      {/* Şerit metnin altında; dolgu yarı saydam — seçili saat görünür kalsın */}
      <View pointerEvents="none" style={styles.selectionBand} />
      <ScrollView
        ref={scrollRef}
        style={styles.wheelScroll}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        nestedScrollEnabled
        scrollEnabled={enabled}
        onLayout={onLayout}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        contentContainerStyle={{ paddingVertical: PAD }}
      >
        {data.map((label, i) => {
          const selected = i === index;
          return (
            <View key={label} style={styles.wheelItem}>
              <Text style={[styles.wheelItemText, selected && styles.wheelItemTextSelected]}>{label}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  editable?: boolean;
  /** Allow empty time (optional fields). */
  allowClear?: boolean;
  placeholder?: string;
  /** Second line inside the field (e.g. local airport time). */
  subtitle?: string | null;
  onOpen?: () => void;
};

/**
 * HH:MM time field with iOS-style hour/minute rollers (no keyboard typing).
 */
export default function TimeRollerField({
  value,
  onChange,
  editable = true,
  allowClear = false,
  placeholder = '--:--',
  subtitle,
  onOpen,
}: Props) {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(themeMode), [themeMode]);
  const parsed = parseHHmm(value);
  const [open, setOpen] = useState(false);
  const [hourIdx, setHourIdx] = useState(parsed?.h ?? 12);
  const [minIdx, setMinIdx] = useState(parsed?.m ?? 0);

  const openPicker = () => {
    if (!editable) return;
    const p = parseHHmm(value);
    setHourIdx(p?.h ?? 12);
    setMinIdx(p?.m ?? 0);
    onOpen?.();
    setOpen(true);
  };

  const confirm = () => {
    onChange(formatHHmm(hourIdx, minIdx));
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const display = parsed ? formatHHmm(parsed.h, parsed.m) : placeholder;

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, !editable && styles.triggerDisabled]}
        onPress={openPicker}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={display}
      >
        <View style={styles.triggerMain}>
          <Text style={[styles.triggerText, !parsed && styles.triggerPlaceholder]}>{display}</Text>
          {subtitle ? <Text style={styles.triggerSubtitle}>{subtitle}</Text> : null}
        </View>
        <Text style={styles.triggerChevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              {allowClear ? (
                <TouchableOpacity onPress={clear} hitSlop={8}>
                  <Text style={styles.headerActionMuted}>{t('common.clear')}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.headerSpacer} />
              )}
              <Text style={styles.sheetTitle}>{t('common.time')}</Text>
              <TouchableOpacity onPress={confirm} hitSlop={8}>
                <Text style={styles.headerAction}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.wheelsRow}>
              {open ? (
                <>
                  <WheelColumn data={HOURS} index={hourIdx} onIndexChange={setHourIdx} enabled />
                  <Text style={styles.colon}>:</Text>
                  <WheelColumn data={MINUTES} index={minIdx} onIndexChange={setMinIdx} enabled />
                </>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(themeMode: 'light' | 'dark') {
  return StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: themeMode === 'dark' ? '#1A2740' : '#F0F1F5',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === 'ios' ? 12 : 10,
      minHeight: 44,
    },
    triggerDisabled: { opacity: 0.55 },
    triggerMain: { flex: 1, minWidth: 0 },
    triggerText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    triggerPlaceholder: { color: colors.textMuted, fontWeight: '500' },
    triggerSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
    triggerChevron: { color: colors.textMuted, fontSize: 14, marginLeft: 8 },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: Platform.OS === 'ios' ? 28 : 16,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    headerAction: { color: colors.primary, fontSize: 16, fontWeight: '700' },
    headerActionMuted: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
    headerSpacer: { width: 56 },
    wheelsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: ITEM_H * VISIBLE_ROWS,
      paddingHorizontal: 24,
      marginTop: 8,
    },
    colon: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      marginHorizontal: 6,
      marginBottom: 2,
    },
    wheelCol: {
      width: 88,
      height: ITEM_H * VISIBLE_ROWS,
      overflow: 'hidden',
    },
    selectionBand: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: PAD,
      height: ITEM_H,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
      backgroundColor: themeMode === 'dark' ? 'rgba(96,165,250,0.18)' : 'rgba(37,99,235,0.12)',
      zIndex: 0,
    },
    wheelScroll: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 2,
      backgroundColor: 'transparent',
    },
    wheelItem: {
      height: ITEM_H,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wheelItemText: {
      fontSize: 18,
      color: colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    wheelItemTextSelected: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 22,
    },
  });
}
