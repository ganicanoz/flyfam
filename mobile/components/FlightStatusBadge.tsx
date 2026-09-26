import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTranslation } from 'react-i18next';
import { type ThemeMode } from '../theme/colors';
import { resolveRosterCardVisualKind } from '../theme/rosterCardVisual';
import { radius, statusChrome, type FlightStatusToken } from '../theme/tokens';

/** Kart / detayda gösterilen durum rozeti (planlı = rozet yok). */
export type FlightStatusBadgeKind = 'inFlight' | 'delayed' | 'landed' | 'cancelled';

export function resolveFlightStatusBadgeKind(args: {
  rosterEntryKind?: string | null;
  flightStatus?: string | null;
  isStandbyDutyCode?: boolean;
  /** Yalnızca gerçek pozitif gecikme (dk). */
  delayMins?: number | null;
  isPast?: boolean;
}): FlightStatusBadgeKind | null {
  const status = String(args.flightStatus ?? '').toLowerCase();
  if (status === 'cancelled') return 'cancelled';

  const visual = resolveRosterCardVisualKind(args);
  if (visual === 'duty_off' || visual === 'standby') return null;
  if (visual === 'in_flight') return 'inFlight';
  if (visual === 'landed') return 'landed';

  const delay =
    args.delayMins != null && Number.isFinite(args.delayMins) ? Math.round(args.delayMins) : null;
  if (delay != null && delay > 0) return 'delayed';

  // Geçmiş planlı uçuşlar iniş gibi gösterilir (mevcut kart davranışı).
  if (args.isPast) return 'landed';

  return null;
}

function kindToChromeToken(kind: FlightStatusBadgeKind): FlightStatusToken {
  switch (kind) {
    case 'inFlight':
    case 'landed':
      // İndi ve Havada aynı yeşil ton.
      return 'inFlight';
    case 'delayed':
      return 'delayed';
    case 'cancelled':
      return 'cancelled';
  }
}

type Props = {
  kind: FlightStatusBadgeKind | null | undefined;
  /** Pozitif gecikme dk; yoksa süre eklenmez. */
  delayMins?: number | null;
  themeMode: ThemeMode;
  /** Küçük ekranda gecikme süresini gizle. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tonlu 24 durum rozeti — açık tonlu arka plan + koyu metin + ikon/nokta.
 * Planlı uçuşlarda `kind=null` → render yok.
 */
export function FlightStatusBadge({
  kind,
  delayMins,
  themeMode,
  compact = false,
  style,
}: Props) {
  const { t, i18n } = useTranslation();
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

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

  const delayShown =
    !compact &&
    delayMins != null &&
    Number.isFinite(delayMins) &&
    Math.round(delayMins) > 0
      ? Math.round(delayMins)
      : null;

  const labelCore = useMemo(() => {
    if (!kind) return '';
    const lang = String(i18n.language || 'tr');
    const raw =
      kind === 'inFlight'
        ? t('roster.status.inFlight')
        : kind === 'delayed'
          ? t('roster.status.delayed')
          : kind === 'landed'
            ? t('roster.statusLanded')
            : t('roster.status.cancelled');
    return String(raw).toLocaleUpperCase(lang);
  }, [kind, i18n.language, t]);

  const label = useMemo(() => {
    if (!labelCore) return '';
    if (delayShown == null || (kind !== 'inFlight' && kind !== 'delayed')) return labelCore;
    const suffix = t('roster.delayMinsSuffix');
    return `${labelCore} · +${delayShown} ${suffix}`;
  }, [labelCore, delayShown, kind, t]);

  useEffect(() => {
    if (kind !== 'inFlight' || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [kind, reduceMotion, pulse]);

  if (!kind || !label) return null;

  const chrome = statusChrome(kindToChromeToken(kind), themeMode);
  const iconColor = chrome.text;
  const a11y =
    delayShown != null && (kind === 'inFlight' || kind === 'delayed')
      ? `${labelCore}, +${delayShown} ${t('roster.delayMinsSuffix')}`
      : labelCore;

  const icon =
    kind === 'inFlight' ? (
      <Animated.View style={{ opacity: pulse }}>
        <Ionicons name="airplane" size={12} color={iconColor} />
      </Animated.View>
    ) : kind === 'delayed' ? (
      <Ionicons name="time-outline" size={12} color={iconColor} />
    ) : kind === 'landed' ? (
      <MaterialIcons name="flight-land" size={13} color={iconColor} />
    ) : (
      <Ionicons name="close-circle" size={12} color={iconColor} />
    );

  return (
    <View
      style={[styles.badge, { backgroundColor: chrome.bg }, style]}
      accessibilityRole="text"
      accessibilityLabel={a11y}
      accessible
    >
      {icon}
      <Text
        style={[styles.text, { color: chrome.text }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </View>
  );
}

const BADGE_H = 24;

const styles = StyleSheet.create({
  badge: {
    height: BADGE_H,
    minHeight: BADGE_H,
    maxHeight: BADGE_H,
    paddingHorizontal: 11,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    maxWidth: '100%',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
});
