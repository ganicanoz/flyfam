import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors, useThemeMode } from '../../theme/colors';
import { radius, shadow } from '../../theme/tokens';
import { addDaysYmd, type CrewRoomDay, type CrewRoomDayStatus } from '../../lib/crewRoom';
import {
  CrewRoomAvatar,
  CrewRoomStatusPill,
  crewRoomDayLabel,
  CrewRoomFlights,
  crewRoomLayoverTag,
  crewRoomStatusMeta,
} from './CrewRoomParts';

export type CrewRoomTodayPerson = {
  crew_id: string;
  name: string | null;
  avatar_url: string | null;
  isMe: boolean;
};

type Props = {
  people: CrewRoomTodayPerson[];
  dayIndex: Map<string, CrewRoomDay>;
  today: string;
  locale: string;
  onOpenPerson: (crewId: string) => void;
  onInvite: () => void;
};

type GroupKey = 'available' | 'layover' | 'flying' | 'busy' | 'unknown';

const GROUPS: { key: GroupKey; tone: CrewRoomDayStatus; statuses: CrewRoomDayStatus[] }[] = [
  { key: 'available', tone: 'off', statuses: ['off'] },
  { key: 'layover', tone: 'layover', statuses: ['layover'] },
  { key: 'flying', tone: 'flying', statuses: ['flying'] },
  { key: 'busy', tone: 'busy', statuses: ['standby', 'duty', 'busy'] },
  { key: 'unknown', tone: 'unknown', statuses: ['free', 'unknown'] },
];

/** Someone flying out and staying overnight is shown with the layover group. */
function groupOf(d: CrewRoomDay | undefined): GroupKey {
  if (d?.layover) return 'layover';
  const status = d?.status ?? 'unknown';
  return GROUPS.find((g) => g.statuses.includes(status))?.key ?? 'unknown';
}

export function CrewRoomToday({ people, dayIndex, today, locale, onOpenPerson, onInvite }: Props) {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const tomorrow = addDaysYmd(today, 1);

  const others = people.filter((p) => !p.isMe);
  const grouped = GROUPS.map((g) => ({
    ...g,
    items: others.filter((p) => groupOf(dayIndex.get(`${p.crew_id}|${today}`)) === g.key),
  }));

  const statusText = (d: CrewRoomDay | undefined) => {
    const status = d?.status ?? 'unknown';
    return crewRoomLayoverTag(t, d) ?? t(`crewRoom.status.${status}`);
  };

  const tomorrowLine = (crewId: string) => {
    const d = dayIndex.get(`${crewId}|${tomorrow}`);
    if (!d || d.status === 'unknown') return null;
    const where = d.status === 'layover' && d.stations.length > 0 ? ` · ${d.stations.join(', ')}` : '';
    return t('crewRoom.today.tomorrow', { status: `${statusText(d)}${where}` });
  };

  const avatarWithBadge = (p: CrewRoomTodayPerson, d: CrewRoomDay | undefined, size: number) => {
    const meta = crewRoomStatusMeta(d?.layover ? 'layover' : (d?.status ?? 'unknown'));
    return (
      <View style={{ width: size, height: size }}>
        <CrewRoomAvatar name={p.name} uri={p.avatar_url} size={size} />
        <View style={[styles.badge, { backgroundColor: meta.color, borderColor: colors.surface }]}>
          <Ionicons name={meta.icon} size={10} color="#FFFFFF" />
        </View>
      </View>
    );
  };

  const details = (d: CrewRoomDay | undefined) => {
    const status = d?.status ?? 'unknown';
    const layoverTag = crewRoomLayoverTag(t, d);
    return (
      <>
        <View style={styles.pillRow}>
          <CrewRoomStatusPill status={status} label={t(`crewRoom.status.${status}`)} />
          {layoverTag ? <CrewRoomStatusPill status="layover" label={layoverTag} /> : null}
          {d && d.stations.length > 0 && !layoverTag && d.flights.length === 0 ? (
            <Text style={styles.stations}>{d.stations.join(' · ')}</Text>
          ) : null}
        </View>
        {d && d.flights.length > 0 ? (
          <View style={styles.flights}>
            <CrewRoomFlights flights={d.flights} locale={locale} />
          </View>
        ) : null}
      </>
    );
  };

  const cardStyle = [styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <View>
      <Text style={styles.dateLine}>
        {crewRoomDayLabel(today, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>

      {others.length === 0 ? (
        <View style={[cardStyle, styles.emptyCard]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="people" size={26} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>{t('crewRoom.empty.title')}</Text>
          <Text style={styles.emptyText}>{t('crewRoom.empty.message')}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onInvite}>
            <Ionicons name="person-add" size={16} color={colors.onPrimary} />
            <Text style={styles.primaryBtnText}>{t('crewRoom.empty.cta')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {grouped
            .filter((g) => g.items.length > 0)
            .map((g) => {
              const meta = crewRoomStatusMeta(g.tone);
              return (
                <View key={g.key} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={[styles.sectionDot, { backgroundColor: meta.color }]} />
                    <Text style={styles.sectionTitle}>{t(`crewRoom.today.${g.key}`)}</Text>
                  </View>
                  <View style={cardStyle}>
                    {g.items.map((p, i) => {
                      const d = dayIndex.get(`${p.crew_id}|${today}`);
                      const next = tomorrowLine(p.crew_id);
                      return (
                        <TouchableOpacity
                          key={p.crew_id}
                          style={[styles.personRow, i < g.items.length - 1 && styles.rowDivider]}
                          onPress={() => onOpenPerson(p.crew_id)}
                          accessibilityRole="button"
                        >
                          {avatarWithBadge(p, d, 44)}
                          <View style={styles.personText}>
                            <Text style={styles.personName} numberOfLines={1}>
                              {p.name ?? t('crewRoom.someone')}
                            </Text>
                            {details(d)}
                            {next ? <Text style={styles.tomorrow}>{next}</Text> : null}
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={styles.chevron} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
        </>
      )}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    dateLine: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'capitalize',
      marginBottom: 8,
    },
    card: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 6,
      marginBottom: 12,
    },
    badge: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    section: { marginTop: 10 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingHorizontal: 4 },
    sectionDot: { width: 8, height: 8, borderRadius: 4 },
    sectionTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
    personRow: { flexDirection: 'row', gap: 12, paddingVertical: 12, alignItems: 'flex-start' },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    personText: { flex: 1, minWidth: 0, gap: 5 },
    personName: { fontSize: 15, fontWeight: '700', color: colors.text },
    pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    stations: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    flights: { gap: 4, marginTop: 2 },
    tomorrow: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    chevron: { alignSelf: 'center' },
    emptyCard: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20 },
    emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' },
    emptyText: { fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 16 },
    primaryBtn: {
      flexDirection: 'row',
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: radius.button,
      minHeight: 46,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
    },
    primaryBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  });
}
