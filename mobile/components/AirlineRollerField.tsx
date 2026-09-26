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
import { AIRLINES, type Airline } from '../constants/airlines';

const ITEM_H = 40;
const VISIBLE_ROWS = 5;
const PAD = ((VISIBLE_ROWS - 1) / 2) * ITEM_H;

type WheelProps = {
  data: string[];
  index: number;
  onIndexChange: (index: number) => void;
};

function WheelColumn({ data, index, onIndexChange }: WheelProps) {
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
    if (settling.current) return;
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
        onLayout={onLayout}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        contentContainerStyle={{ paddingVertical: PAD }}
      >
        {data.map((label, i) => {
          const selected = i === index;
          return (
            <View key={`${label}-${i}`} style={styles.wheelItem}>
              <Text style={[styles.wheelItemText, selected && styles.wheelItemTextSelected]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function sortAirlines(preferredIata: string | null | undefined): Airline[] {
  const pref = (preferredIata || '').trim().toUpperCase();
  const copy = [...AIRLINES].sort((a, b) => a.iata.localeCompare(b.iata) || a.name.localeCompare(b.name));
  if (!pref) return copy;
  const idx = copy.findIndex((a) => a.iata === pref);
  if (idx <= 0) return copy;
  const [hit] = copy.splice(idx, 1);
  return [hit!, ...copy];
}

type Props = {
  /** Selected airline IATA (e.g. PC, XQ). */
  value: string;
  onChange: (nextIata: string, airline: Airline | null) => void;
  /** Prefer this IATA at top of the roller (usually profile airline). */
  preferredIata?: string | null;
  editable?: boolean;
  accessibilityLabel?: string;
};

/**
 * Compact airline IATA trigger + roller sheet from AIRLINES dataset.
 */
export default function AirlineRollerField({
  value,
  onChange,
  preferredIata,
  editable = true,
  accessibilityLabel,
}: Props) {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(themeMode), [themeMode]);
  const airlines = useMemo(() => sortAirlines(preferredIata), [preferredIata]);
  const labels = useMemo(
    () => airlines.map((a) => `${a.iata}  ·  ${a.name}`),
    [airlines],
  );

  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  const openPicker = () => {
    if (!editable) return;
    const cur = (value || '').trim().toUpperCase();
    const found = Math.max(0, airlines.findIndex((a) => a.iata === cur));
    setIdx(found);
    setOpen(true);
  };

  const confirm = () => {
    const a = airlines[idx] ?? null;
    onChange(a?.iata ?? '', a);
    setOpen(false);
  };

  const selected = airlines.find((a) => a.iata === (value || '').trim().toUpperCase()) ?? null;
  const triggerLabel = selected?.iata || value || '—';

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, !editable && styles.triggerDisabled]}
        onPress={openPicker}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || t('addFlight.airlineCode')}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {triggerLabel}
        </Text>
        <Text style={styles.triggerChevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={styles.headerCancel}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>{t('addFlight.airlineCode')}</Text>
              <TouchableOpacity onPress={confirm} hitSlop={8}>
                <Text style={styles.headerAction}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.wheelsRow}>
              {open ? <WheelColumn data={labels} index={idx} onIndexChange={setIdx} /> : null}
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
      height: 48,
      minWidth: 56,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      backgroundColor: colors.primary,
      borderTopLeftRadius: 12,
      borderBottomLeftRadius: 12,
    },
    triggerDisabled: { opacity: 0.55 },
    triggerText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    triggerChevron: { color: colors.onPrimary, fontSize: 11, opacity: 0.9, marginLeft: 1 },
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
    headerCancel: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
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
    wheelItem: { height: ITEM_H, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    wheelItemText: { color: colors.textMuted, fontSize: 16, fontWeight: '500' },
    wheelItemTextSelected: { color: colors.text, fontWeight: '700', fontSize: 17 },
  });
}
