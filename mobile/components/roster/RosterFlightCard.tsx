import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors, type ThemeMode } from '../../theme/colors';
import {
  resolveFlightStatusToken,
  resolveRosterCardVisualKind,
  rosterCardChrome,
  rosterCardInk,
  rosterStatusBadge,
} from '../../theme/rosterCardVisual';
import {
  cardAccent,
  radius,
  rosterListSpacing,
  rosterMarks,
  shadow,
  typography,
} from '../../theme/tokens';

export type RosterCompactKind = 'standby' | 'off' | 'layover';

export type RosterFlightCardModel = {
  flightNumber: string;
  originIata: string;
  destIata: string;
  originCity?: string;
  destCity?: string;
  depTime: string;
  arrTime: string;
  durationLabel: string;
  plusOneDay?: boolean;
  delayMins?: number | null;
  rosterEntryKind?: string | null;
  flightStatus?: string | null;
  isStandbyDutyCode?: boolean;
  isNonFlightBlock?: boolean;
  compactKind?: RosterCompactKind | null;
  blockTitle?: string;
  layoverStationLabel?: string | null;
  hotelHint?: string | null;
  progress?: number | null;
  showLiveTrack?: boolean;
  /** Opsiyonel alt satır (reg vb.) — geri sayım yok. */
  footerHint?: string | null;
  showAssignAction?: boolean;
  aircraftReg?: string | null;
  isPast?: boolean;
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
  const marks = rosterMarks(themeMode);
  const visual = resolveRosterCardVisualKind({
    rosterEntryKind: model.rosterEntryKind,
    flightStatus: model.flightStatus,
    isStandbyDutyCode: model.isStandbyDutyCode,
  });
  const chrome = rosterCardChrome(visual, themeMode);
  const delayMins = model.delayMins != null && model.delayMins > 0 ? Math.round(model.delayMins) : null;
  const statusToken = resolveFlightStatusToken({
    rosterEntryKind: model.rosterEntryKind,
    flightStatus: model.flightStatus,
    isStandbyDutyCode: model.isStandbyDutyCode,
    delayMins,
  });

  const compactKind: RosterCompactKind | null =
    model.compactKind ??
    (model.isNonFlightBlock
      ? model.isStandbyDutyCode
        ? 'standby'
        : 'off'
      : null);

  const isStandby = compactKind === 'standby';
  const isOffCompact = compactKind === 'off';
  const isLayover = compactKind === 'layover';
  const inFlight = visual === 'in_flight';

  const badge = rosterStatusBadge(
    model.isPast || visual === 'landed'
      ? 'completed'
      : statusToken === 'onTime'
        ? 'scheduled'
        : statusToken,
    themeMode,
  );

  const statusLabel = useMemo(() => {
    if (model.isPast || visual === 'landed') return t('roster.status.completed');
    if (visual === 'in_flight') return t('roster.status.inFlight');
    if (statusToken === 'cancelled') return t('roster.status.cancelled');
    if (statusToken === 'delayed' && delayMins != null) {
      return t('roster.statusDelayedMins', { mins: delayMins });
    }
    if (statusToken === 'delayed') return t('roster.status.delayed');
    return t('roster.statusScheduled');
  }, [model.isPast, visual, statusToken, delayMins, t]);

  const fs = (n: number) => Math.round(n * fontScale);
  const progress = model.progress;
  const accent = isLayover
    ? cardAccent('layover', themeMode)
    : isOffCompact
      ? cardAccent('duty_off', themeMode)
      : isStandby
        ? cardAccent('standby', themeMode)
        : chrome.accentColor;

  const chevron = <Ionicons name="chevron-forward" size={16} color={ink.muted} />;

  // —— Kompakt: nöbet / off / yatı ——
  if (isStandby || isOffCompact || isLayover) {
    const kindBadge = isStandby
      ? { bg: marks.standbyBadgeBg, text: marks.standbyBadgeText }
      : isLayover
        ? { bg: marks.layoverBadgeBg, text: marks.layoverBadgeText }
        : { bg: marks.offBadgeBg, text: marks.offBadgeText };
    const kindLabel = isStandby
      ? t('roster.statusStandby')
      : isLayover
        ? t('roster.legendLayover')
        : t('roster.offBadge');
    const detailLine = isStandby
      ? `${model.depTime} – ${model.arrTime}${model.durationLabel.trim() ? ` · ${model.durationLabel}` : ''}`
      : isLayover
        ? model.layoverStationLabel || model.blockTitle || t('roster.legendLayover')
        : t('roster.restDay');

    return (
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[
          styles.compactCard,
          shadow.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: model.isPast ? 0.72 : 1,
          },
        ]}
      >
        <View style={[styles.accent, { backgroundColor: accent }]} />
        <View style={styles.compactBody}>
          <View style={styles.standbyTop}>
            <View style={[styles.kindBadge, { backgroundColor: kindBadge.bg }]}>
              <Text style={[styles.kindBadgeText, { color: kindBadge.text, fontSize: fs(12) }]}>
                {kindLabel}
              </Text>
            </View>
            <Text
              style={[
                styles.standbyTimes,
                typography.tabularNums,
                { color: ink.primary, fontSize: fs(15) },
              ]}
              numberOfLines={1}
            >
              {detailLine}
            </Text>
            {chevron}
          </View>
          {isLayover && model.hotelHint ? (
            <Text style={[styles.hotelHint, { color: ink.muted, fontSize: fs(12) }]} numberOfLines={1}>
              {model.hotelHint}
            </Text>
          ) : null}
          {isStandby && model.showAssignAction && onFooterAction ? (
            <Pressable
              onPress={onFooterAction}
              hitSlop={6}
              style={[styles.assignPill, { backgroundColor: marks.standbyBadgeBg }]}
            >
              <Text style={[styles.assignPillText, { color: marks.standbyBadgeText, fontSize: fs(12) }]}>
                {t('roster.assignFlights')}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={marks.standbyBadgeText} />
            </Pressable>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  // —— Uçuş kartı ——
  const footerLeft =
    model.aircraftReg ? t('roster.aircraftRegShort', { reg: model.aircraftReg }) : model.footerHint;
  const showFooter = !!(footerLeft || (model.showLiveTrack && onLiveTrack));

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
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: model.isPast ? 0.72 : 1,
        },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text
            style={[styles.flightNo, typography.tabularNums, { color: ink.primary, fontSize: fs(16) }]}
            numberOfLines={1}
          >
            {model.flightNumber}
          </Text>
          <View style={[styles.badge, { backgroundColor: badge.backgroundColor }]}>
            <Text style={[styles.badgeText, { color: badge.color, fontSize: fs(12) }]} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={ink.muted} />
        </View>

        <View style={[styles.routeRow, !showFooter && !inFlight && { marginBottom: 0 }]}>
          <View style={styles.timeCol}>
            <Text style={[styles.bigTime, typography.tabularNums, { color: ink.primary, fontSize: fs(26) }]}>
              {model.depTime}
            </Text>
            <Text style={[styles.iata, { color: ink.secondary, fontSize: fs(13) }]}>{model.originIata}</Text>
            {model.originCity ? (
              <Text style={[styles.city, { color: ink.muted, fontSize: fs(11) }]} numberOfLines={1}>
                {model.originCity}
              </Text>
            ) : null}
          </View>
          <View style={styles.midCol}>
            <Text style={[styles.dur, typography.tabularNums, { color: ink.muted, fontSize: fs(11) }]}>
              {model.durationLabel}
            </Text>
            <View style={styles.routeLine}>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <Ionicons name="airplane" size={14} color={ink.secondary} style={styles.planeIcon} />
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            </View>
          </View>
          <View style={[styles.timeCol, styles.timeColRight]}>
            <View style={styles.arrTimeRow}>
              <Text style={[styles.bigTime, typography.tabularNums, { color: ink.primary, fontSize: fs(26) }]}>
                {model.arrTime}
              </Text>
              {model.plusOneDay ? (
                <Text style={[styles.plusOne, { color: ink.secondary, fontSize: fs(11) }]}>+1</Text>
              ) : null}
            </View>
            <Text style={[styles.iata, { color: ink.secondary, fontSize: fs(13) }]}>{model.destIata}</Text>
            {model.destCity ? (
              <Text style={[styles.city, { color: ink.muted, fontSize: fs(11) }]} numberOfLines={1}>
                {model.destCity}
              </Text>
            ) : null}
          </View>
        </View>

        {inFlight && progress != null ? (
          <View style={styles.progressWrap}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 10}%`,
                    backgroundColor: ink.secondary,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressPct, typography.tabularNums, { color: ink.muted, fontSize: fs(11) }]}>
              %{Math.round(Math.min(1, Math.max(0, progress)) * 100)}
            </Text>
          </View>
        ) : null}

        {showFooter ? (
          <View style={styles.footerRow}>
            <Text style={[styles.footerHint, { color: ink.muted, fontSize: fs(12) }]} numberOfLines={1}>
              {footerLeft || ' '}
            </Text>
            {model.showLiveTrack && onLiveTrack ? (
              <Pressable onPress={onLiveTrack} hitSlop={8} style={styles.liveBtn}>
                <Ionicons name="location-outline" size={14} color={ink.secondary} />
                <Text style={[styles.liveText, { color: ink.secondary, fontSize: fs(12) }]}>
                  {t('roster.liveTrack')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const pad = rosterListSpacing.cardPadding;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  accent: { width: 4 },
  body: { flex: 1, paddingHorizontal: pad, paddingVertical: pad },
  compactCard: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  compactBody: { flex: 1, paddingHorizontal: pad, paddingVertical: 10, gap: 8 },
  standbyTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  standbyTimes: { flex: 1, fontWeight: '700' },
  kindBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  kindBadgeText: { fontWeight: '700' },
  hotelHint: { fontWeight: '500', paddingLeft: 2 },
  assignPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.button,
    minHeight: 44,
  },
  assignPillText: { fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  flightNo: { fontWeight: '800', flexShrink: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontWeight: '600' },

  routeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  timeCol: { flex: 1.1 },
  timeColRight: { alignItems: 'flex-end' },
  bigTime: { fontWeight: '700', letterSpacing: -0.4 },
  iata: { fontWeight: '700', marginTop: 2 },
  city: { fontWeight: '500', marginTop: 1 },
  midCol: { flex: 1.2, alignItems: 'center', paddingHorizontal: 4 },
  dur: { fontWeight: '500', marginBottom: 4 },
  routeLine: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  planeIcon: { marginHorizontal: 2 },
  arrTimeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  plusOne: { fontWeight: '700', marginLeft: 2, marginTop: 2 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  progressBar: { flex: 1, height: 4, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 999 },
  progressPct: { fontWeight: '600', minWidth: 28 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
  },
  footerHint: { flex: 1, fontWeight: '500' },
  liveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  liveText: { fontWeight: '600' },
});
