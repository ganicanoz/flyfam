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

const MONTHS_TR = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];
const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function parseYmd(value: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function formatYmd(y: number, m: number, d: number): string {
  const dim = daysInMonth(y, m);
  const day = Math.min(Math.max(1, d), dim);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

  const scrollToIndex = useCallback((i: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, i) * ITEM_H, animated });
  }, []);

  const onLayout = () => {
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
            <View key={`${label}-${i}`} style={styles.wheelItem}>
              <Text style={[styles.wheelItemText, selected && styles.wheelItemTextSelected]}>{label}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

type Props = {
  /** YYYY-MM-DD */
  value: string;
  onChange: (nextYmd: string) => void;
  editable?: boolean;
  /** Shown on the trigger (e.g. long date · Local). */
  displayLabel: string;
  placeholder?: string;
  accessibilityLabel?: string;
  /** Match sibling form controls (no top margin, fixed 48 height, single line). */
  compact?: boolean;
};

/**
 * YYYY-MM-DD date field with JS roller sheet (no native DateTimePicker).
 * Matches TimeRollerField UX — works even when RNDateTimePicker isn’t in the binary.
 */
export default function DateRollerField({
  value,
  onChange,
  editable = true,
  displayLabel,
  placeholder = '—',
  accessibilityLabel,
  compact = false,
}: Props) {
  const { t, i18n } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(themeMode), [themeMode]);
  const isTr = String(i18n.language || '').toLowerCase().startsWith('tr');
  const months = isTr ? MONTHS_TR : MONTHS_EN;

  const parsed = parseYmd(value);
  const now = new Date();
  const yearStart = (parsed?.y ?? now.getFullYear()) - 2;
  const YEARS = Array.from({ length: 6 }, (_, i) => String(yearStart + i));

  const [open, setOpen] = useState(false);
  const [yearIdx, setYearIdx] = useState(0);
  const [monthIdx, setMonthIdx] = useState((parsed?.m ?? now.getMonth() + 1) - 1);
  const [dayIdx, setDayIdx] = useState((parsed?.d ?? now.getDate()) - 1);

  const openPicker = () => {
    if (!editable) return;
    const p = parseYmd(value);
    const y = p?.y ?? now.getFullYear();
    const m = p?.m ?? now.getMonth() + 1;
    const d = p?.d ?? now.getDate();
    const yi = Math.max(0, YEARS.indexOf(String(y)));
    setYearIdx(yi >= 0 ? yi : 2);
    setMonthIdx(Math.max(0, Math.min(11, m - 1)));
    setDayIdx(Math.max(0, Math.min(daysInMonth(y, m) - 1, d - 1)));
    setOpen(true);
  };

  const selectedYear = parseInt(YEARS[yearIdx] ?? String(now.getFullYear()), 10);
  const selectedMonth = monthIdx + 1;
  const dayCount = daysInMonth(selectedYear, selectedMonth);
  const DAYS = Array.from({ length: dayCount }, (_, i) => String(i + 1).padStart(2, '0'));
  const safeDayIdx = Math.min(dayIdx, dayCount - 1);

  const confirm = () => {
    onChange(formatYmd(selectedYear, selectedMonth, safeDayIdx + 1));
    setOpen(false);
  };

  const hasValue = !!parsed;

  return (
    <>
      <TouchableOpacity
        style={[
          styles.trigger,
          compact && styles.triggerCompact,
          !editable && styles.triggerDisabled,
        ]}
        onPress={openPicker}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || displayLabel}
      >
        <Text
          style={[styles.triggerText, compact && styles.triggerTextCompact, !hasValue && styles.triggerPlaceholder]}
          numberOfLines={compact ? 1 : 2}
        >
          {hasValue ? displayLabel : placeholder}
        </Text>
        <Text style={styles.triggerChevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.headerSpacer} />
              <Text style={styles.sheetTitle}>{t('editDuty.date')}</Text>
              <TouchableOpacity onPress={confirm} hitSlop={8}>
                <Text style={styles.headerAction}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.wheelsRow}>
              {open ? (
                <>
                  <WheelColumn
                    data={DAYS}
                    index={safeDayIdx}
                    onIndexChange={setDayIdx}
                    enabled
                  />
                  <WheelColumn
                    data={months}
                    index={monthIdx}
                    onIndexChange={(i) => {
                      setMonthIdx(i);
                      const dim = daysInMonth(selectedYear, i + 1);
                      if (dayIdx >= dim) setDayIdx(dim - 1);
                    }}
                    enabled
                  />
                  <WheelColumn
                    data={YEARS}
                    index={yearIdx}
                    onIndexChange={(i) => {
                      setYearIdx(i);
                      const y = parseInt(YEARS[i] ?? String(selectedYear), 10);
                      const dim = daysInMonth(y, selectedMonth);
                      if (dayIdx >= dim) setDayIdx(dim - 1);
                    }}
                    enabled
                  />
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
      marginTop: 8,
      gap: 8,
    },
    triggerCompact: {
      marginTop: 0,
      minHeight: 48,
      height: 48,
      paddingVertical: 0,
      borderWidth: 0,
    },
    triggerDisabled: { opacity: 0.55 },
    triggerText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    triggerTextCompact: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    triggerPlaceholder: { color: colors.textMuted, fontWeight: '500' },
    triggerChevron: { color: colors.textMuted, fontSize: 14 },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,27,61,0.35)' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    headerAction: { color: colors.primary, fontSize: 16, fontWeight: '700' },
    headerSpacer: { width: 48 },
    wheelsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingTop: 8,
      height: ITEM_H * VISIBLE_ROWS,
    },
    wheelCol: { flex: 1, height: ITEM_H * VISIBLE_ROWS, overflow: 'hidden' },
    wheelScroll: { flex: 1 },
    selectionBand: {
      position: 'absolute',
      left: 4,
      right: 4,
      top: PAD,
      height: ITEM_H,
      borderRadius: 10,
      backgroundColor: themeMode === 'dark' ? 'rgba(77,127,255,0.18)' : 'rgba(26,92,245,0.10)',
      zIndex: 0,
    },
    wheelItem: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
    wheelItemText: { color: colors.textMuted, fontSize: 18, fontWeight: '500' },
    wheelItemTextSelected: { color: colors.text, fontWeight: '700', fontSize: 20 },
  });
}
