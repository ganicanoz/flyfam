import { View, Text, Image, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TFunction } from 'i18next';
import { colors } from '../../theme/colors';
import {
  CREW_ROOM_LEVELS,
  CrewRoomError,
  type CrewRoomDay,
  type CrewRoomDayStatus,
  type CrewRoomFlight,
  type CrewRoomLevel,
} from '../../lib/crewRoom';

type IconName = keyof typeof Ionicons.glyphMap;

export function crewRoomTime(iso: string | null, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function localYmd(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * A day's flights in one compact box, one aligned line per leg:
 * bold departure time · origin ✈ destination · bold arrival time (+1).
 */
export function CrewRoomFlights({
  flights,
  locale,
  bare = false,
}: {
  flights: CrewRoomFlight[];
  locale: string;
  /** No box background/padding (when placed inside an already tinted card). */
  bare?: boolean;
}) {
  if (flights.length === 0) return null;
  return (
    <View style={bare ? styles.flightBare : [styles.flightBox, { backgroundColor: colors.surfaceAlt }]}>
      {flights.map((f, i) => {
        const depDay = localYmd(f.dep);
        const arrDay = localYmd(f.arr);
        const nextDay = !!depDay && !!arrDay && arrDay !== depDay;
        return (
          <View key={`${f.no}-${i}`} style={styles.flightLine}>
            <Text style={[styles.flightTime, { color: colors.text }]}>{crewRoomTime(f.dep, locale) || '--:--'}</Text>
            <Text style={[styles.flightStation, { color: colors.textSecondary }]}>{f.from ?? '—'}</Text>
            <Ionicons name="airplane" size={11} color={colors.primary} />
            <Text style={[styles.flightStation, { color: colors.textSecondary }]}>{f.to ?? '—'}</Text>
            <Text style={[styles.flightTime, { color: colors.text }]}>
              {crewRoomTime(f.arr, locale) || '--:--'}
              {nextDay ? <Text style={[styles.flightNextDay, { color: colors.textMuted }]}>+1</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function crewRoomDayLabel(ymd: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, opts);
}

/** Extra "layover" tag for days whose main status is something else (e.g. flying out and staying). */
export function crewRoomLayoverTag(
  t: TFunction,
  d: Pick<CrewRoomDay, 'status' | 'layover' | 'layover_at'> | undefined,
): string | null {
  if (!d?.layover || d.status === 'layover') return null;
  const label = t('crewRoom.status.layover');
  return d.layover_at.length > 0 ? `${label} · ${d.layover_at.join(', ')}` : label;
}

export function crewRoomStatusMeta(status: CrewRoomDayStatus): { icon: IconName; color: string } {
  switch (status) {
    case 'flying':
      return { icon: 'airplane', color: colors.primary };
    case 'layover':
      return { icon: 'bed', color: '#7C3AED' };
    case 'standby':
      return { icon: 'time', color: '#E8890C' };
    case 'duty':
      return { icon: 'briefcase', color: '#64748B' };
    case 'busy':
      return { icon: 'remove-circle', color: '#64748B' };
    case 'off':
      return { icon: 'sunny', color: colors.success };
    case 'free':
      return { icon: 'ellipsis-horizontal-circle', color: colors.textMuted };
    default:
      return { icon: 'help-circle', color: colors.textMuted };
  }
}

export function CrewRoomAvatar({
  name,
  uri,
  size = 40,
}: {
  name: string | null | undefined;
  uri?: string | null;
  size?: number;
}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        styles.avatarFallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primaryLight },
      ]}
    >
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: size * 0.4 }}>{initial}</Text>
    </View>
  );
}

export function CrewRoomStatusPill({ status, label }: { status: CrewRoomDayStatus; label: string }) {
  const meta = crewRoomStatusMeta(status);
  return (
    <View style={[styles.pill, { backgroundColor: `${meta.color}1F` }]}>
      <Ionicons name={meta.icon} size={12} color={meta.color} />
      <Text style={[styles.pillText, { color: meta.color }]}>{label}</Text>
    </View>
  );
}

/** Native action sheet substitute: Alert with one button per level. */
export function pickCrewRoomLevel(
  t: TFunction,
  opts: {
    title: string;
    message?: string;
    current: CrewRoomLevel | null;
    allowDefault?: boolean;
    defaultLabel?: string;
    onPick: (level: CrewRoomLevel | null) => void;
  },
) {
  const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }[] =
    CREW_ROOM_LEVELS.map((level) => ({
      text: `${opts.current === level ? '✓ ' : ''}${t(`crewRoom.level.${level}`)}`,
      onPress: () => opts.onPick(level),
    }));
  if (opts.allowDefault) {
    buttons.unshift({
      text: `${opts.current == null ? '✓ ' : ''}${opts.defaultLabel ?? t('crewRoom.level.useDefault')}`,
      onPress: () => opts.onPick(null),
    });
  }
  buttons.push({ text: t('common.cancel'), style: 'cancel' });
  Alert.alert(opts.title, opts.message, buttons);
}

export function crewRoomErrorMessage(t: TFunction, e: unknown): string {
  if (e instanceof CrewRoomError && e.code !== 'unknown') {
    return t(`crewRoom.errors.${e.code}`);
  }
  return t('crewRoom.errors.generic');
}

const styles = StyleSheet.create({
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 12, fontWeight: '700' },
  flightBox: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 4, alignSelf: 'flex-start' },
  flightBare: { gap: 4 },
  flightLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flightTime: { minWidth: 44, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  flightStation: { width: 30, fontSize: 12, fontWeight: '600', textAlign: 'center', letterSpacing: 0.3 },
  flightNextDay: { fontSize: 10, fontWeight: '700' },
});
