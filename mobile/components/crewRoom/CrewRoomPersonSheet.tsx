import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Alert, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, useThemeMode } from '../../theme/colors';
import { radius, shadow } from '../../theme/tokens';
import {
  crewRoomLevelRank,
  removeCrewRoomContact,
  setCrewRoomShare,
  type CrewRoomDay,
  type CrewRoomMe,
  type CrewRoomPerson,
} from '../../lib/crewRoom';
import {
  CrewRoomAvatar,
  crewRoomDayLabel,
  crewRoomErrorMessage,
  CrewRoomFlights,
  crewRoomStatusMeta,
  pickCrewRoomLevel,
} from './CrewRoomParts';

type Props = {
  person: CrewRoomPerson | null;
  me: CrewRoomMe;
  days: CrewRoomDay[];
  today: string;
  locale: string;
  onClose: () => void;
  onChanged: () => void;
};

export function CrewRoomPersonSheet({ person, me, days, today, locale, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleDay = (day: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  /** Upcoming days up to their last known roster day (trailing unknown days are not shown). */
  const upcoming = useMemo(() => {
    if (!person) return [];
    const theirs = days
      .filter((d) => d.crew_id === person.crew_id && d.day >= today)
      .sort((a, b) => a.day.localeCompare(b.day));
    let last = -1;
    theirs.forEach((d, i) => {
      if (d.status !== 'unknown') last = i;
    });
    return theirs.slice(0, last + 1);
  }, [person, days, today]);

  /** Consecutive layover days at the same place merged into one stay. */
  const stays = useMemo(() => {
    const out: { key: string; start: string; end: string; places: string[] }[] = [];
    for (const d of upcoming) {
      if (!d.layover) continue;
      const key = d.layover_at.join(',');
      const prev = out[out.length - 1];
      if (prev && prev.key === key && nextYmd(prev.end) === d.day) {
        prev.end = d.day;
      } else {
        out.push({ key, start: d.day, end: d.day, places: d.layover_at });
      }
    }
    return out;
  }, [upcoming]);

  if (!person) return null;

  const name = person.name ?? t('crewRoom.someone');
  const sharesWithMe = crewRoomLevelRank(person.their_level) > 0;
  const placeHidden = crewRoomLevelRank(person.their_level) < crewRoomLevelRank('destination');
  const cardStyle = [styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  const run = async (fn: () => Promise<unknown>, closeAfter = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onChanged();
      if (closeAfter) onClose();
    } catch (e) {
      Alert.alert(t('common.error'), crewRoomErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const editLevel = () => {
    pickCrewRoomLevel(t, {
      title: t('crewRoom.people.shareWith', { name }),
      message: t('crewRoom.level.explain'),
      current: person.my_override,
      allowDefault: true,
      defaultLabel: t('crewRoom.level.useDefaultWith', { level: t(`crewRoom.level.${me.default_level}`) }),
      onPick: (level) => void run(() => setCrewRoomShare(person.crew_id, level)),
    });
  };

  const confirmRemove = () => {
    const linkId = person.link_id;
    Alert.alert(t('crewRoom.people.removeTitle'), t('crewRoom.people.removeMessage', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('crewRoom.people.remove'),
        style: 'destructive',
        onPress: () => void run(() => removeCrewRoomContact(linkId), true),
      },
    ]);
  };

  const dateText = (ymd: string) =>
    ymd === today
      ? t('crewRoom.person.today')
      : crewRoomDayLabel(ymd, locale, { weekday: 'short', day: 'numeric', month: 'short' });

  const rangeText = (start: string, end: string) =>
    start === end ? dateText(start) : `${dateText(start)} – ${dateText(end)}`;

  const layoverColor = crewRoomStatusMeta('layover').color;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 14 : Math.max(insets.top, 8) + 6 }]}>
          <View style={styles.headerSpacer} />
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('crewRoom.person.close')}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 32 + Math.max(insets.bottom, 8) }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.identity}>
            <CrewRoomAvatar name={person.name} uri={person.avatar_url} size={64} />
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
            <Text style={styles.meta}>
              {t('crewRoom.people.theyShare', { level: t(`crewRoom.level.${person.their_level}`) })}
              {' · '}
              {t('crewRoom.people.youShare', { level: t(`crewRoom.level.${person.my_level}`) })}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={editLevel} disabled={busy}>
                <Ionicons name="options-outline" size={16} color={colors.primary} />
                <Text style={styles.actionText}>{t('crewRoom.person.shareSetting')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={confirmRemove} disabled={busy}>
                <Ionicons name="person-remove-outline" size={16} color={colors.error} />
                <Text style={[styles.actionText, { color: colors.error }]}>{t('crewRoom.people.remove')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {sharesWithMe && upcoming.length > 0 ? (
            <View style={cardStyle}>
              <Text style={styles.cardTitle}>{t('crewRoom.person.layoversTitle')}</Text>
              {stays.length === 0 ? (
                <Text style={styles.cardHint}>{t('crewRoom.person.layoversEmpty')}</Text>
              ) : (
                stays.map((s, i) => (
                  <View key={`${s.start}-${s.key}`} style={[styles.stayRow, i < stays.length - 1 && styles.rowDivider]}>
                    <View style={[styles.stayIcon, { backgroundColor: `${layoverColor}1F` }]}>
                      <Ionicons name="bed" size={16} color={layoverColor} />
                    </View>
                    <View style={styles.dayBody}>
                      <Text style={styles.stayPlace} numberOfLines={1}>
                        {s.places.length > 0 ? s.places.join(', ') : t('crewRoom.person.layoverNoPlace')}
                      </Text>
                      <Text style={styles.stayDates}>{rangeText(s.start, s.end)}</Text>
                    </View>
                  </View>
                ))
              )}
              {stays.length > 0 && placeHidden ? (
                <Text style={styles.cardHint}>{t('crewRoom.person.layoverPlaceHidden')}</Text>
              ) : null}
            </View>
          ) : null}

          {!sharesWithMe || upcoming.length === 0 ? (
            <View style={cardStyle}>
              <Text style={styles.cardTitle}>{t('crewRoom.person.upcomingTitle')}</Text>
              <Text style={styles.cardHint}>
                {t(!sharesWithMe ? 'crewRoom.person.notSharing' : 'crewRoom.person.noRoster')}
              </Text>
            </View>
          ) : (
            <View style={styles.days}>
              <Text style={styles.sectionTitle}>{t('crewRoom.person.upcomingTitle')}</Text>
              {upcoming.map((d, i) => {
                const meta = crewRoomStatusMeta(d.status);
                const hasFlights = d.flights.length > 0;
                const open = hasFlights && expanded.has(d.day);
                const sameStay = (o: CrewRoomDay | undefined) =>
                  !!o && o.layover && o.layover_at.join(',') === d.layover_at.join(',');
                const stayStart = d.layover && !sameStay(upcoming[i - 1]);
                const stayEnd = d.layover && !sameStay(upcoming[i + 1]);
                const title =
                  d.status === 'flying' ? t('crewRoom.person.flightDuty') : t(`crewRoom.status.${d.status}`);
                const route = hasFlights
                  ? routeChain(d)
                  : d.status === 'layover'
                    ? d.layover_at.join(', ')
                    : d.stations.join(' · ');
                const stayText =
                  !d.layover || d.status === 'layover'
                    ? ''
                    : d.layover_at.length > 0
                      ? `${t('crewRoom.person.layoverNoPlace')} · ${d.layover_at.join(', ')}`
                      : t('crewRoom.person.layoverNoPlace');
                const isToday = d.day === today;
                return (
                  <View key={d.day}>
                    <View style={styles.dayRow}>
                      {d.layover ? (
                        <View
                          style={[
                            styles.stayBar,
                            { backgroundColor: layoverColor },
                            stayStart && styles.stayBarStart,
                            stayEnd && styles.stayBarEnd,
                          ]}
                        />
                      ) : null}
                      <View style={[styles.tile, shadow.card, isToday && { borderColor: colors.primary }]}>
                        <Text style={[styles.tileNum, isToday && { color: colors.primary }]}>
                          {Number(d.day.slice(8, 10))}
                        </Text>
                        <Text style={styles.tileDay}>
                          {crewRoomDayLabel(d.day, locale, { weekday: 'short' }).replace('.', '').toUpperCase()}
                        </Text>
                      </View>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        disabled={!hasFlights}
                        onPress={() => toggleDay(d.day)}
                        style={[styles.dayCard, { backgroundColor: `${meta.color}17` }]}
                        accessibilityRole={hasFlights ? 'button' : undefined}
                      >
                        <View style={styles.dayCardTop}>
                          <View style={styles.dayCardText}>
                            <View style={styles.dayTitleRow}>
                              <Ionicons name={meta.icon} size={14} color={meta.color} />
                              <Text style={[styles.dayTitle, { color: meta.color }]} numberOfLines={1}>
                                {title}
                              </Text>
                              {stayText ? (
                                <View style={[styles.stayTag, { backgroundColor: `${layoverColor}1F` }]}>
                                  <Text style={[styles.stayTagText, { color: layoverColor }]} numberOfLines={1}>
                                    {stayText}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            {route ? (
                              <Text style={styles.daySub} numberOfLines={1}>
                                {route}
                              </Text>
                            ) : null}
                          </View>
                          {hasFlights ? (
                            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={meta.color} />
                          ) : null}
                        </View>
                        {open ? (
                          <View style={[styles.dayLegs, { borderTopColor: `${meta.color}33` }]}>
                            <CrewRoomFlights flights={d.flights} locale={locale} bare />
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 6 },
    headerSpacer: { width: 36 },
    grabber: { width: 40, height: 5, borderRadius: 3, opacity: Platform.OS === 'ios' ? 1 : 0 },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { paddingHorizontal: 16 },
    identity: { alignItems: 'center', marginBottom: 16, gap: 6 },
    name: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: 6 },
    meta: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
    actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      minHeight: 36,
    },
    actionText: { fontSize: 13, fontWeight: '700', color: colors.primary },
    card: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 16,
      marginBottom: 12,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
    cardHint: { fontSize: 13, lineHeight: 18, marginTop: 4, color: colors.textMuted },
    days: { marginBottom: 12 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginLeft: STAY_GUTTER, marginBottom: 10 },
    dayRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10, paddingLeft: STAY_GUTTER, marginBottom: 6 },
    stayBar: { position: 'absolute', left: 2, top: 0, bottom: -6, width: 4 },
    stayBarStart: { top: 8, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
    stayBarEnd: { bottom: 8, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
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
    dayCard: { flex: 1, minWidth: 0, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center' },
    dayCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dayCardText: { flex: 1, minWidth: 0 },
    dayTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dayTitle: { flexShrink: 1, fontSize: 14, fontWeight: '700' },
    daySub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    stayTag: { marginLeft: 'auto', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 0 },
    stayTagText: { fontSize: 11, fontWeight: '700' },
    dayLegs: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    dayBody: { flex: 1, minWidth: 0, gap: 4 },
    stayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    stayIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    stayPlace: { fontSize: 15, fontWeight: '700', color: colors.text },
    stayDates: { fontSize: 13, color: colors.textSecondary },
  });
}

const STAY_GUTTER = 14;

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

function nextYmd(ymd: string): string {
  return addDays(ymd, 1);
}

/** "IST → JED → IST" when the legs connect; otherwise the day's away stations ("CTA · STR"). */
function routeChain(d: CrewRoomDay): string {
  const legs = d.flights;
  const connected = legs.every((f, i) => i === 0 || (!!f.from && f.from === legs[i - 1].to));
  if (!connected) return d.stations.join(' · ');
  const out: string[] = [];
  if (legs[0]?.from) out.push(legs[0].from);
  for (const f of legs) if (f.to) out.push(f.to);
  return out.join(' → ');
}
