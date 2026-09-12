import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors, type ThemeMode } from '../../theme/colors';
import {
  resolveRosterCardVisualKind,
  rosterCardChrome,
  rosterCardInk,
} from '../../theme/rosterCardVisual';
import { significantArrivalSkewMins } from '../../lib/flightDelayThreshold';
import {
  FlightStatusBadge,
  resolveFlightStatusBadgeKind,
} from '../FlightStatusBadge';
import {
  cardAccent,
  radius,
  rosterListSpacing,
  rosterMarks,
  shadow,
  typography,
} from '../../theme/tokens';
import { scaleListBodyText } from '../../theme/fontScale';

export type RosterCompactKind = 'standby' | 'off' | 'layover';

export type RosterFlightCardModel = {
  flightNumber: string;
  originIata: string;
  destIata: string;
  originCity?: string;
  destCity?: string;
  depTime: string;
  arrTime: string;
  /** Planlı saat — yalnızca sapma varsa, güncel saatin altında üstü çizili. */
  depStruck?: string | null;
  arrStruck?: string | null;
  /** Dakika sapması: + gecikme, − erken (rozet / renk). */
  delayMins?: number | null;
  /** Kalkış / varış için ayrı sapma (renk). Yoksa delayMins kullanılır. */
  depSkewMins?: number | null;
  arrSkewMins?: number | null;
  durationLabel: string;
  plusOneDay?: boolean;
  rosterEntryKind?: string | null;
  flightStatus?: string | null;
  isStandbyDutyCode?: boolean;
  isNonFlightBlock?: boolean;
  compactKind?: RosterCompactKind | null;
  blockTitle?: string;
  layoverStationLabel?: string | null;
  /** Nöbet: "09 Eylül · 22:00 – 06:00" */
  standbyScheduleLine?: string | null;
  progress?: number | null;
  /** Çubuk sağında kısa kalan süre: "3sa 44dk kaldı". */
  progressRemainLabel?: string | null;
  progressNearingArrival?: boolean;
  showLiveTrack?: boolean;
  footerHint?: string | null;
  showAssignAction?: boolean;
  showSuggestOccupation?: boolean;
  aircraftReg?: string | null;
  aircraftType?: string | null;
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
  onSuggestOccupation?: () => void;
};

export function RosterFlightCard({
  model,
  themeMode,
  fontScale,
  onPress,
  onLongPress,
  onLiveTrack,
  onFooterAction,
  onSuggestOccupation,
}: Props) {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const ink = rosterCardInk(themeMode);
  const marks = rosterMarks(themeMode);
  const visual = resolveRosterCardVisualKind({
    rosterEntryKind: model.rosterEntryKind,
    flightStatus: model.flightStatus,
    isStandbyDutyCode: model.isStandbyDutyCode,
  });
  const chrome = rosterCardChrome(visual, themeMode);
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
  const isLanded = visual === 'landed' || (!!model.isPast && !inFlight);
  const rawSkew =
    model.delayMins != null && Number.isFinite(model.delayMins) ? Math.round(model.delayMins) : null;
  // İniş sonrası: ≥15 dk geç = gecikme; 1–14 normal.
  const delayMinsRaw = rawSkew != null && rawSkew !== 0 ? rawSkew : null;
  const delayMins = isLanded
    ? significantArrivalSkewMins(delayMinsRaw)
    : delayMinsRaw;
  const depSkew =
    model.depSkewMins != null && model.depSkewMins !== 0
      ? Math.round(model.depSkewMins)
      : delayMins;
  const arrSkewRaw =
    model.arrSkewMins != null && model.arrSkewMins !== 0
      ? Math.round(model.arrSkewMins)
      : delayMins;
  const arrSkew = isLanded ? significantArrivalSkewMins(arrSkewRaw) : arrSkewRaw;

  /** Rozette yalnızca gerçek pozitif gecikme. */
  const delayForBadge =
    delayMins != null && delayMins > 0 ? delayMins : null;

  const badgeKind = resolveFlightStatusBadgeKind({
    rosterEntryKind: model.rosterEntryKind,
    flightStatus: model.flightStatus,
    isStandbyDutyCode: model.isStandbyDutyCode,
    delayMins: delayForBadge,
    isPast: isLanded,
  });

  const lateOrange = marks.standbyBadgeText;
  const earlyGreen = themeMode === 'dark' ? '#4ADE80' : '#16A34A';
  const timeColorForSkew = (skew: number | null | undefined) => {
    if (skew == null || skew === 0) return ink.primary;
    return skew > 0 ? lateOrange : earlyGreen;
  };

  const fs = (n: number) => scaleListBodyText(n, fontScale ?? 1);
  const chip = (n: number) => n;
  const progress = model.progress;
  const progressClamped =
    progress != null ? Math.min(1, Math.max(0, progress)) : null;
  const nearing = !!model.progressNearingArrival && progressClamped != null && progressClamped < 1;
  const fillColor = nearing ? marks.standbyBadgeText : colors.primary;
  const thumbBorder = themeMode === 'dark' ? colors.surface : '#FFFFFF';

  const accent =
    isLayover
      ? cardAccent('layover', themeMode)
      : isOffCompact
        ? cardAccent('duty_off', themeMode)
        : isStandby
          ? cardAccent('standby', themeMode)
          : chrome.accentColor;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(!!v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!inFlight || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [inFlight, reduceMotion, pulse]);

  const stationLine = (iata: string, city?: string) =>
    city ? `${iata} ${city}` : iata;

  const badgeCompact = windowWidth < 360;

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
    const station = model.layoverStationLabel?.trim() || null;
    const standbySchedule =
      model.standbyScheduleLine?.trim() ||
      `${model.depTime} – ${model.arrTime}`;
    const offDetailLine = isLayover
      ? [station, kindLabel, model.arrTime || null]
          .filter((x) => !!(x && String(x).trim()))
          .join(' · ')
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
          {isStandby ? (
            <View style={styles.standbyColumns}>
              <View style={styles.standbyLeft}>
                <View style={styles.standbyRow}>
                  <View style={[styles.kindBadge, { backgroundColor: kindBadge.bg }]}>
                    <Text style={[styles.kindBadgeText, { color: kindBadge.text, fontSize: chip(12) }]}>
                      {kindLabel}
                    </Text>
                  </View>
                  {station ? (
                    <Text
                      style={[
                        styles.standbyStation,
                        typography.tabularNums,
                        { color: ink.primary, fontSize: fs(15) },
                      ]}
                      numberOfLines={1}
                    >
                      {station}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={[
                    styles.standbySchedule,
                    typography.tabularNums,
                    { color: ink.primary, fontSize: fs(14) },
                  ]}
                  numberOfLines={1}
                >
                  {standbySchedule}
                </Text>
              </View>
              {model.showAssignAction && onFooterAction ? (
                <Pressable
                  onPress={onFooterAction}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('roster.assignFlightsA11y')}
                  style={[styles.assignTextBtn, { backgroundColor: marks.standbyLine }]}
                >
                  <Ionicons name="airplane" size={16} color="#FFFFFF" />
                  <Text style={[styles.assignTextBtnLabel, { fontSize: chip(10) }]} numberOfLines={2}>
                    {t('roster.assignFlights')}
                  </Text>
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={ink.muted} style={styles.assignChevron} />
              )}
            </View>
          ) : (
            <View style={styles.standbyColumns}>
              <View style={styles.standbyLeft}>
                <View style={styles.standbyTop}>
                  {isLayover ? null : (
                    <View style={[styles.kindBadge, { backgroundColor: kindBadge.bg }]}>
                      <Text style={[styles.kindBadgeText, { color: kindBadge.text, fontSize: chip(12) }]}>
                        {kindLabel}
                      </Text>
                    </View>
                  )}
                  <Text
                    style={[
                      styles.standbyTimes,
                      typography.tabularNums,
                      { color: ink.primary, fontSize: fs(15) },
                    ]}
                    numberOfLines={1}
                  >
                    {offDetailLine}
                  </Text>
                </View>
                {model.showSuggestOccupation && onSuggestOccupation ? (
                  <Text style={[styles.suggestHint, { color: ink.muted, fontSize: chip(11) }]} numberOfLines={1}>
                    {t('roster.suggestOccupationHint')}
                  </Text>
                ) : null}
              </View>
              {model.showSuggestOccupation && onSuggestOccupation ? (
                <Pressable
                  onPress={onSuggestOccupation}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('roster.suggestOccupationA11y')}
                  style={[styles.suggestTextBtn, { borderColor: marks.offLine, backgroundColor: marks.offBadgeBg }]}
                >
                  <Text style={[styles.suggestTextBtnLabel, { color: marks.offBadgeText, fontSize: chip(11) }]} numberOfLines={2}>
                    {t('roster.suggestOccupation')}
                  </Text>
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={ink.muted} style={styles.assignChevron} />
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  const progressPct = progressClamped != null ? Math.round(progressClamped * 1000) / 10 : 0;
  const trackColor = themeMode === 'dark' ? 'rgba(148,163,184,0.35)' : '#E5E9F0';
  /** Biten uçuş: açık yeşil. Aktif: soft yeşil (rozetten daha soluk). */
  const landedBg =
    themeMode === 'dark' ? 'rgba(34,197,94,0.10)' : 'rgba(22,163,74,0.06)';
  const liveBg =
    themeMode === 'dark' ? 'rgba(34,197,94,0.14)' : 'rgba(22,163,74,0.08)';
  const cardBg = isLanded ? landedBg : inFlight ? liveBg : colors.surface;
  const aircraftMeta = useMemo(() => {
    if (!inFlight) return null;
    const type = model.aircraftType?.trim() || null;
    const reg = model.aircraftReg?.trim() || null;
    if (type && reg) return `${type} · ${reg}`;
    if (type) return type;
    if (reg) return reg;
    return null;
  }, [inFlight, model.aircraftType, model.aircraftReg]);

  const showDepStruck = !!(model.depStruck && model.depStruck !== model.depTime);
  const showArrStruck = !!(model.arrStruck && model.arrStruck !== model.arrTime);

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
          backgroundColor: cardBg,
          borderColor: inFlight || isLanded ? accent : colors.border,
          opacity: model.isPast && !inFlight && !isLanded ? 0.72 : 1,
        },
      ]}
    >
      {inFlight && !reduceMotion ? (
        <Animated.View style={[styles.accent, { backgroundColor: accent, opacity: pulse }]} />
      ) : (
        <View style={[styles.accent, { backgroundColor: accent }]} />
      )}
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={styles.titleLeft}>
            <Text
              style={[styles.flightNo, typography.tabularNums, { color: ink.primary, fontSize: fs(16) }]}
              numberOfLines={1}
            >
              {model.flightNumber || '—'}
            </Text>
            <FlightStatusBadge
              kind={badgeKind}
              delayMins={delayForBadge}
              themeMode={themeMode}
              compact={badgeCompact}
              style={styles.statusBadge}
            />
          </View>
          {model.showLiveTrack && onLiveTrack ? (
            <Pressable
              onPress={onLiveTrack}
              hitSlop={6}
              style={[styles.livePill, { backgroundColor: colors.primary }]}
              accessibilityLabel={t('roster.trackFr24A11y')}
            >
              <Ionicons name="play" size={11} color={colors.onPrimary} />
              <Text style={[styles.livePillText, { color: colors.onPrimary }]}>{t('roster.liveTrack')}</Text>
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={ink.muted} style={styles.chevron} />
          )}
        </View>

        <View style={[styles.routeRow, !inFlight && { marginBottom: 0 }]}>
          <View style={styles.timeCol}>
            <View style={styles.timeInline}>
              <Text
                style={[
                  styles.bigTime,
                  typography.tabularNums,
                  {
                    color: timeColorForSkew(isLanded || showDepStruck ? depSkew : null),
                    fontSize: fs(22),
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {model.depTime}
              </Text>
            </View>
            {showDepStruck ? (
              <Text
                style={[
                  styles.plannedStruck,
                  typography.tabularNums,
                  { color: ink.muted, textDecorationLine: 'line-through' },
                ]}
                numberOfLines={1}
              >
                {model.depStruck}
              </Text>
            ) : null}
            <Text style={[styles.station, { color: ink.secondary, fontSize: chip(12) }]} numberOfLines={1}>
              {stationLine(model.originIata, model.originCity)}
            </Text>
          </View>

          <View style={styles.midCol}>
            <Text
              style={[styles.dur, typography.tabularNums, { color: ink.muted, fontSize: chip(11) }]}
              numberOfLines={1}
            >
              {model.durationLabel.trim() ? `✈ ${model.durationLabel}` : '✈'}
            </Text>
            {aircraftMeta ? (
              <Text
                style={[styles.aircraftMid, typography.tabularNums, { color: ink.muted }]}
                numberOfLines={1}
              >
                {aircraftMeta}
              </Text>
            ) : !inFlight ? (
              <View style={styles.routeLine}>
                <View style={[styles.line, { backgroundColor: colors.border }]} />
                <View style={[styles.line, { backgroundColor: colors.border }]} />
              </View>
            ) : null}
          </View>

          <View style={[styles.timeCol, styles.timeColRight]}>
            <View style={styles.arrTimeWrap}>
              <Text
                style={[
                  styles.bigTime,
                  typography.tabularNums,
                  {
                    color: timeColorForSkew(isLanded || showArrStruck ? arrSkew : null),
                    fontSize: fs(22),
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {model.arrTime}
              </Text>
              {model.plusOneDay ? (
                <Text
                  style={[styles.plusOneBadge, { color: ink.secondary }]}
                  accessibilityLabel={t('roster.plusOneDayLabel')}
                >
                  +1
                </Text>
              ) : null}
            </View>
            {showArrStruck ? (
              <Text
                style={[
                  styles.plannedStruck,
                  styles.plannedStruckRight,
                  typography.tabularNums,
                  { color: ink.muted, textDecorationLine: 'line-through' },
                ]}
                numberOfLines={1}
              >
                {model.arrStruck}
              </Text>
            ) : null}
            <Text
              style={[styles.station, { color: ink.secondary, fontSize: chip(12), textAlign: 'right' }]}
              numberOfLines={1}
            >
              {stationLine(model.destIata, model.destCity)}
            </Text>
          </View>
        </View>

        {inFlight && progressClamped != null ? (
          <View style={styles.progressRow}>
            <View style={styles.progressTrackWrap}>
              <View style={[styles.progressBar, { backgroundColor: trackColor }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPct}%`,
                      backgroundColor: fillColor,
                    },
                  ]}
                />
              </View>
              <View
                pointerEvents="none"
                style={[
                  styles.progressThumb,
                  {
                    left: `${progressPct}%`,
                    borderColor: thumbBorder,
                    backgroundColor: fillColor,
                  },
                ]}
              />
            </View>
            {model.progressRemainLabel ? (
              <Text
                style={[styles.remainLabel, typography.tabularNums, { color: ink.muted }]}
                numberOfLines={1}
              >
                {model.progressRemainLabel}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const pad = rosterListSpacing.cardPadding;
const PROGRESS_BAR_H = 4;
const THUMB = 10;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  accent: { width: 4 },
  body: { flex: 1, paddingHorizontal: pad, paddingVertical: 12, gap: 8 },
  compactCard: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  compactBody: { flex: 1, paddingHorizontal: pad, paddingVertical: 10, gap: 6 },
  standbyColumns: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  standbyLeft: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  standbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
  },
  standbyTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  standbyStation: { fontWeight: '700', flexShrink: 1, minWidth: 0 },
  standbyTimes: { flex: 1, fontWeight: '700' },
  standbySchedule: { fontWeight: '700' },
  kindBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  kindBadgeText: { fontWeight: '700' },
  assignTextBtn: {
    alignSelf: 'center',
    marginLeft: 'auto',
    flexShrink: 0,
    width: 68,
    height: 56,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  assignTextBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 12,
  },
  assignChevron: {
    marginLeft: 'auto',
  },
  suggestHint: { fontWeight: '600' },
  suggestTextBtn: {
    alignSelf: 'center',
    marginLeft: 'auto',
    flexShrink: 0,
    width: 72,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestTextBtnLabel: {
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 13,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  titleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  flightNo: { fontWeight: '800', flexShrink: 0 },
  statusBadge: { flexShrink: 1 },
  chevron: { flexShrink: 0 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexShrink: 0,
  },
  livePillText: { fontWeight: '700', fontSize: 12 },

  routeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  timeCol: { flex: 1.15, minWidth: 0 },
  timeColRight: { alignItems: 'flex-end' },
  timeInline: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexWrap: 'nowrap' },
  bigTime: { fontWeight: '700', letterSpacing: -0.4 },
  arrTimeWrap: {
    position: 'relative',
    alignSelf: 'flex-end',
    paddingRight: 14,
    paddingTop: 2,
  },
  plannedStruck: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  plannedStruckRight: { textAlign: 'right', alignSelf: 'stretch' },
  plusOneBadge: {
    position: 'absolute',
    top: -1,
    right: 0,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13,
  },
  station: { fontWeight: '600', marginTop: 2 },
  midCol: { flex: 1, alignItems: 'center', paddingHorizontal: 4, paddingTop: 4 },
  dur: { fontWeight: '600' },
  aircraftMid: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
    letterSpacing: 0.2,
  },
  routeLine: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 6, gap: 4 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },

  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrackWrap: {
    flex: 1,
    position: 'relative',
    height: Math.max(PROGRESS_BAR_H, THUMB),
    justifyContent: 'center',
  },
  progressBar: {
    height: PROGRESS_BAR_H,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: PROGRESS_BAR_H,
    borderRadius: 999,
  },
  progressThumb: {
    position: 'absolute',
    top: '50%',
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    marginTop: -THUMB / 2,
    borderRadius: THUMB / 2,
    borderWidth: 2,
  },
  remainLabel: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 0,
    maxWidth: '36%',
  },
});
