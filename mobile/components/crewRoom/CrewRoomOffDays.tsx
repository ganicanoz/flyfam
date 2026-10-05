import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors, useThemeMode } from '../../theme/colors';
import { shadow } from '../../theme/tokens';
import type { CrewRoomDay } from '../../lib/crewRoom';
import { CrewRoomAvatar, crewRoomDayLabel, crewRoomStatusMeta } from './CrewRoomParts';
import type { CrewRoomTodayPerson } from './CrewRoomToday';

type Props = {
  people: CrewRoomTodayPerson[];
  dayIndex: Map<string, CrewRoomDay>;
  days: CrewRoomDay[];
  today: string;
  locale: string;
  onOpenPerson: (crewId: string) => void;
};

/**
 * My upcoming days off and who else in the room is off the same day.
 * Only an explicit off code counts; "no info" days are not treated as available.
 */
export function CrewRoomOffDays({ people, dayIndex, days, today, locale, onOpenPerson }: Props) {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const rows = useMemo(() => {
    const me = people.find((p) => p.isMe);
    if (!me) return [];
    const others = people.filter((p) => !p.isMe);
    return days
      .filter((d) => d.crew_id === me.crew_id && d.day >= today && d.status === 'off')
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({
        day: d.day,
        friends: others.filter((p) => dayIndex.get(`${p.crew_id}|${d.day}`)?.status === 'off'),
      }));
  }, [people, days, dayIndex, today]);

  const offColor = crewRoomStatusMeta('off').color;

  return (
    <View>
      <Text style={styles.hint}>{t('crewRoom.offDays.hint')}</Text>
      {rows.length === 0 ? (
        <View style={[styles.emptyCard, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={styles.emptyText}>{t('crewRoom.offDays.empty')}</Text>
        </View>
      ) : (
        rows.map((r, i) => {
          const newMonth = i === 0 || rows[i - 1].day.slice(0, 7) !== r.day.slice(0, 7);
          const isToday = r.day === today;
          const shared = r.friends.length > 0;
          return (
            <View key={r.day}>
              {newMonth ? (
                <Text style={[styles.month, i > 0 && styles.monthGap]}>
                  {crewRoomDayLabel(r.day, locale, { month: 'long', year: 'numeric' })}
                </Text>
              ) : null}
              <View style={styles.row}>
                <View style={[styles.tile, shadow.card, isToday && { borderColor: colors.primary }]}>
                  <Text style={[styles.tileNum, isToday && { color: colors.primary }]}>{Number(r.day.slice(8, 10))}</Text>
                  <Text style={styles.tileDay}>
                    {crewRoomDayLabel(r.day, locale, { weekday: 'short' }).replace('.', '').toUpperCase()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.card,
                    shared
                      ? { backgroundColor: `${offColor}17` }
                      : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  {shared ? (
                    <View style={styles.friends}>
                      {r.friends.map((p) => (
                        <TouchableOpacity
                          key={p.crew_id}
                          style={[styles.friend, { backgroundColor: colors.surface }]}
                          onPress={() => onOpenPerson(p.crew_id)}
                          accessibilityRole="button"
                        >
                          <CrewRoomAvatar name={p.name} uri={p.avatar_url} size={22} />
                          <Text style={styles.friendName} numberOfLines={1}>
                            {(p.name ?? '').split(' ')[0] || t('crewRoom.someone')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.nobodyRow}>
                      <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.nobody}>{t('crewRoom.offDays.nobody')}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    hint: { fontSize: 13, lineHeight: 18, color: colors.textMuted, marginBottom: 10 },
    month: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
    monthGap: { marginTop: 10 },
    row: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginBottom: 6 },
    tile: {
      width: 46,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
    },
    tileNum: { fontSize: 17, lineHeight: 20, fontWeight: '800', color: colors.text },
    tileDay: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
    card: { flex: 1, minWidth: 0, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
    friends: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    friend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingLeft: 3,
      paddingRight: 10,
      paddingVertical: 3,
      maxWidth: '100%',
    },
    friendName: { fontSize: 13, fontWeight: '700', color: colors.text, flexShrink: 1 },
    nobodyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
    nobody: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    emptyCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
    emptyText: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  });
}
