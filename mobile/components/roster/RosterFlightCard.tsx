import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, type ThemeMode } from '../../theme/colors';
import {
  resolveFlightStatusToken,
  resolveRosterCardVisualKind,
  rosterCardChrome,
  rosterCardInk,
  rosterStatusBadge,
} from '../../theme/rosterCardVisual';
import { radius, shadow, typography } from '../../theme/tokens';

export type RosterFlightCardModel = {
  flightNumber: string;
  originIata: string;
  destIata: string;
  originCity?: string;
  destCity?: string;
  /** Display times (already formatted). */
  depTime: string;
  arrTime: string;
  /** When delayed: original scheduled (struck) + estimated. */
  depTimeScheduledStruck?: string | null;
  arrTimeScheduledStruck?: string | null;
  durationLabel: string;
  plusOneDay?: boolean;
  delayMins?: number | null;
  rosterEntryKind?: string | null;
  flightStatus?: string | null;
  isStandbyDutyCode?: boolean;
  isNonFlightBlock?: boolean;
  blockTitle?: string;
  progress?: number | null;
  showLiveTrack?: boolean;
  footerHint?: string | null;
  footerActionLabel?: string | null;
  aircraftReg?: string | null;
  selectionMode?: boolean;
  selected?: boolean;
};

type Props = {
  model: RosterFlightCardModel;
  themeMode: ThemeMode;
  fontScale: number;
  onPress: () => void;
  onLongPress?: () => void;
  onLiveTrack?: () => void;
  onFooterAction?: () => void;
};

function formatDelayCompact(mins: number): string {
  return `+${Math.round(mins)} dk`;
}

export function RosterFlightCard({
  model,
  themeMode,
  fontScale,
  onPress,
  onLongPress,
  onLiveTrack,
  onFooterAction,
}: Props) {
  const { t } = useTranslation();
  const ink = rosterCardInk(themeMode);
  const visual = resolveRosterCardVisualKind({
    rosterEntryKind: model.rosterEntryKind,
    flightStatus: model.flightStatus,
    isStandbyDutyCode: model.isStandbyDutyCode,
  });
  const chrome = rosterCardChrome(visual, themeMode);
  const statusToken = resolveFlightStatusToken({
    rosterEntryKind: model.rosterEntryKind,
    flightStatus: model.flightStatus,
    isStandbyDutyCode: model.isStandbyDutyCode,
    delayMins: model.delayMins,
  });
  const badge = rosterStatusBadge(statusToken, themeMode);

  const statusLabel = useMemo(() => {
    if (model.isNonFlightBlock) {
      if (model.isStandbyDutyCode) return t('roster.statusStandby');
      if ((model.rosterEntryKind || '').toLowerCase() === 'sim') return t('roster.simulatorBlockType');
      return t('roster.offDutyType');
    }
    if (statusToken === 'delayed' && model.delayMins != null) {
      return t('roster.statusDelayedMins', { mins: Math.round(model.delayMins) });
    }
    return t(`roster.status.${statusToken}`);
  }, [model, statusToken, t]);

  const fs = (n: number) => Math.round(n * fontScale);
  const inFlight = visual === 'in_flight';
  const progress = model.progress;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[
        styles.card,
        shadow.card,
        {
          backgroundColor: chrome.backgroundColor,
          borderColor: chrome.borderColor,
          borderWidth: chrome.borderWidth,
        },
        model.selectionMode && model.selected && { borderColor: colors.primary, borderWidth: 2 },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: chrome.accentColor }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text
            style={[
              styles.flightNo,
              typography.tabularNums,
              { color: ink.primary, fontSize: fs(17) },
            ]}
            numberOfLines={1}
          >
            {model.isNonFlightBlock ? model.blockTitle || model.flightNumber : model.flightNumber}
          </Text>
          <View style={[styles.badge, { backgroundColor: badge.backgroundColor }]}>
            <Text style={[styles.badgeText, { color: badge.color, fontSize: fs(12) }]} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
          {model.selectionMode ? (
            <View
              style={[
                styles.check,
                model.selected && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              {model.selected ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={ink.muted} />
          )}
        </View>

        <View style={styles.routeRow}>
          <View style={styles.timeCol}>
            {model.depTimeScheduledStruck ? (
              <Text style={[styles.struck, { color: ink.muted, fontSize: fs(13) }]}>
                {model.depTimeScheduledStruck}
              </Text>
            ) : null}
            <Text style={[styles.bigTime, typography.tabularNums, { color: ink.primary, fontSize: fs(28) }]}>
              {model.depTime}
            </Text>
            <Text style={[styles.iata, { color: ink.secondary, fontSize: fs(13) }]}>
              {model.isNonFlightBlock ? model.originCity || ' ' : model.originIata}
            </Text>
          </View>
          <View style={styles.midCol}>
            <Text style={[styles.dur, { color: ink.muted, fontSize: fs(12) }]}>{model.durationLabel}</Text>
            <View style={styles.routeLine}>
              <View style={[styles.dot, { backgroundColor: colors.border }]} />
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <Ionicons
                name={model.isNonFlightBlock ? 'time-outline' : 'airplane'}
                size={16}
                color={colors.primary}
              />
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <View style={[styles.dot, { backgroundColor: colors.border }]} />
            </View>
          </View>
          <View style={[styles.timeCol, styles.timeColRight]}>
            {model.arrTimeScheduledStruck ? (
              <Text style={[styles.struck, { color: ink.muted, fontSize: fs(13) }]}>
                {model.arrTimeScheduledStruck}
              </Text>
            ) : null}
            <View style={styles.arrTimeRow}>
              <Text style={[styles.bigTime, typography.tabularNums, { color: ink.primary, fontSize: fs(28) }]}>
                {model.arrTime}
              </Text>
              {model.plusOneDay ? (
                <Text style={[styles.plusOne, { color: colors.primary, fontSize: fs(11) }]}>+1</Text>
              ) : null}
            </View>
            <Text style={[styles.iata, { color: ink.secondary, fontSize: fs(13) }]}>
              {model.isNonFlightBlock ? model.destCity || ' ' : model.destIata}
            </Text>
          </View>
        </View>

        {inFlight && progress != null ? (
          <View style={styles.progressWrap}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 1000) / 10}%` }]}>
                <LinearGradient
                  colors={themeMode === 'dark' ? ['#3D5468', '#4D7FFF'] : ['#93C5FD', '#1A5CF5']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>
            <Text style={[styles.progressPct, typography.tabularNums, { color: ink.primary, fontSize: fs(12) }]}>
              {`${Math.round(progress * 100)}%`}
            </Text>
          </View>
        ) : null}

        <View style={styles.footerRow}>
          {model.footerActionLabel && onFooterAction ? (
            <Pressable onPress={onFooterAction} hitSlop={8} style={styles.liveBtn}>
              <Text style={[styles.liveText, { color: colors.error, fontSize: fs(12) }]}>
                {model.footerActionLabel}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.footerHint, { color: ink.muted, fontSize: fs(12) }]} numberOfLines={1}>
              {model.footerHint ||
                (model.aircraftReg ? t('roster.aircraftRegShort', { reg: model.aircraftReg }) : ' ')}
            </Text>
          )}
          {model.showLiveTrack && onLiveTrack ? (
            <Pressable onPress={onLiveTrack} hitSlop={8} style={styles.liveBtn}>
              <Ionicons name="navigate-outline" size={14} color={colors.primary} />
              <Text style={[styles.liveText, { color: colors.primary, fontSize: fs(12) }]}>
                {t('roster.liveTrack')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    overflow: 'hidden',
    flexDirection: 'row',
    marginBottom: 10,
  },
  accent: { width: 4 },
  body: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  flightNo: { fontWeight: '700', flexShrink: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: '48%' },
  badgeText: { fontWeight: '600' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  timeCol: { flex: 1.1 },
  timeColRight: { alignItems: 'flex-end' },
  bigTime: { fontWeight: '700', letterSpacing: -0.5 },
  iata: { fontWeight: '600', marginTop: 2 },
  struck: { textDecorationLine: 'line-through', marginBottom: 2 },
  midCol: { flex: 1.2, alignItems: 'center', paddingHorizontal: 4 },
  dur: { fontWeight: '500', marginBottom: 4 },
  routeLine: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  dot: { width: 5, height: 5, borderRadius: 3 },
  arrTimeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  plusOne: { fontWeight: '700', marginLeft: 2, marginTop: 2 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  progressBar: { flex: 1, height: 4, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 999, overflow: 'hidden' },
  progressPct: { fontWeight: '700', minWidth: 36, textAlign: 'right' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  footerHint: { flex: 1, fontWeight: '500' },
  liveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 4 },
  liveText: { fontWeight: '600' },
});
