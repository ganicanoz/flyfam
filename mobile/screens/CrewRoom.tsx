import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, useThemeMode } from '../theme/colors';
import { radius, shadow } from '../theme/tokens';
import { pushRootScreen } from '../lib/pushRootScreen';
import { useSession } from '../contexts/SessionContext';
import {
  addDaysYmd,
  CrewRoomError,
  fetchCrewRoomDays,
  fetchCrewRoomOverview,
  localYmd,
  type CrewRoomDay,
  type CrewRoomDayStatus,
  type CrewRoomOverview,
  type CrewRoomPerson,
} from '../lib/crewRoom';
import {
  crewRoomDayLabel as dayLabel,
  crewRoomErrorMessage,
  crewRoomStatusMeta,
} from '../components/crewRoom/CrewRoomParts';
import { CrewRoomOffDays } from '../components/crewRoom/CrewRoomOffDays';
import { CrewRoomPeoplePanel } from '../components/crewRoom/CrewRoomPeoplePanel';
import { CrewRoomPersonSheet } from '../components/crewRoom/CrewRoomPersonSheet';
import { CrewRoomSettingsSheet } from '../components/crewRoom/CrewRoomSettingsSheet';
import { CrewRoomToday } from '../components/crewRoom/CrewRoomToday';

type Segment = 'today' | 'week' | 'offDays' | 'people';

/** Server allows at most 62 days; covers next month's roster once it is published. */
const RANGE_DAYS = 60;
const WEEK_PAGES = 4;

type RoomPerson = {
  crew_id: string;
  name: string | null;
  avatar_url: string | null;
  isMe: boolean;
  person: CrewRoomPerson | null;
};

export default function CrewRoom() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const { profile } = useSession();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const locale = String(i18n.language || '').toLowerCase().startsWith('tr') ? 'tr-TR' : 'en-US';

  const [segment, setSegment] = useState<Segment>('today');
  const [overview, setOverview] = useState<CrewRoomOverview | null>(null);
  const [days, setDays] = useState<CrewRoomDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [weekPage, setWeekPage] = useState(0);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSeq = useRef(0);

  const today = localYmd();

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      const seq = ++loadSeq.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const ov = await fetchCrewRoomOverview();
        let ds: CrewRoomDay[] = [];
        if (ov.me.has_access) {
          try {
            ds = await fetchCrewRoomDays(today, addDaysYmd(today, RANGE_DAYS));
          } catch (e) {
            if (!(e instanceof CrewRoomError && e.code === 'subscription_required')) throw e;
          }
        }
        if (seq !== loadSeq.current) return;
        setOverview(ov);
        setDays(ds);
        setLoadError(null);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setLoadError(crewRoomErrorMessage(t, e));
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [t, today],
  );

  useFocusEffect(
    useCallback(() => {
      void load(overview ? 'silent' : 'initial');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const dayIndex = useMemo(() => {
    const m = new Map<string, CrewRoomDay>();
    for (const d of days) m.set(`${d.crew_id}|${d.day}`, d);
    return m;
  }, [days]);

  const roomPeople: RoomPerson[] = useMemo(() => {
    if (!overview) return [];
    const me: RoomPerson = {
      crew_id: overview.me.crew_id,
      name: overview.me.name,
      avatar_url: profile?.avatar_url ?? null,
      isMe: true,
      person: null,
    };
    const others = overview.people
      .filter((p) => p.their_level !== 'hidden' && p.has_access)
      .map<RoomPerson>((p) => ({
        crew_id: p.crew_id,
        name: p.name,
        avatar_url: p.avatar_url,
        isMe: false,
        person: p,
      }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', locale));
    return [me, ...others];
  }, [overview, locale, profile?.avatar_url]);

  const openPerson = overview?.people.find((p) => p.crew_id === openPersonId) ?? null;

  const statusLabel = (s: CrewRoomDayStatus) => t(`crewRoom.status.${s}`);

  const cardStyle = [styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  const renderGate = () => (
    <View style={[cardStyle, styles.gateCard]}>
      <View style={[styles.gateIcon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name="lock-closed" size={22} color={colors.primary} />
      </View>
      <Text style={styles.gateTitle}>{t('crewRoom.gate.title')}</Text>
      <Text style={styles.gateText}>{t('crewRoom.gate.message')}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={() => pushRootScreen(navigation as never, 'Plans')}>
        <Text style={styles.primaryBtnText}>{t('crewRoom.gate.cta')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderWeek = () => {
    const start = addDaysYmd(today, weekPage * 7);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
    return (
      <View style={cardStyle}>
        <View style={styles.weekNav}>
          <TouchableOpacity
            onPress={() => setWeekPage((n) => Math.max(0, n - 1))}
            disabled={weekPage === 0}
            style={[styles.iconBtn, weekPage === 0 && styles.disabled]}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.cardTitle}>
            {dayLabel(weekDays[0], locale, { day: 'numeric', month: 'short' })} –{' '}
            {dayLabel(weekDays[6], locale, { day: 'numeric', month: 'short' })}
          </Text>
          <TouchableOpacity
            onPress={() => setWeekPage((n) => Math.min(WEEK_PAGES - 1, n + 1))}
            disabled={weekPage >= WEEK_PAGES - 1}
            style={[styles.iconBtn, weekPage >= WEEK_PAGES - 1 && styles.disabled]}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.weekHeaderRow}>
          <View style={styles.weekNameCol} />
          {weekDays.map((ymd) => (
            <View key={ymd} style={styles.weekCell}>
              <Text style={[styles.weekDayName, ymd === today && { color: colors.primary }]}>
                {dayLabel(ymd, locale, { weekday: 'short' })}
              </Text>
              <Text style={[styles.weekDayNum, ymd === today && { color: colors.primary }]}>
                {dayLabel(ymd, locale, { day: 'numeric' })}
              </Text>
            </View>
          ))}
        </View>
        {roomPeople.map((p) => (
          <View key={p.crew_id} style={styles.weekRow}>
            <TouchableOpacity
              style={styles.weekNameCol}
              disabled={p.isMe}
              onPress={() => setOpenPersonId(p.crew_id)}
            >
              <Text style={[styles.weekName, !p.isMe && { color: colors.primary }]} numberOfLines={1}>
                {p.isMe ? t('crewRoom.you') : (p.name ?? '').split(' ')[0] || t('crewRoom.someone')}
              </Text>
            </TouchableOpacity>
            {weekDays.map((ymd) => {
              const d = dayIndex.get(`${p.crew_id}|${ymd}`);
              const status = d?.layover ? 'layover' : (d?.status ?? 'unknown');
              const meta = crewRoomStatusMeta(status);
              const station = d ? (d.layover_at[0] ?? d.stations[0]) : undefined;
              return (
                <View key={ymd} style={styles.weekCell}>
                  <View style={[styles.weekChip, { backgroundColor: `${meta.color}1F` }]}>
                    <Ionicons name={meta.icon} size={13} color={meta.color} />
                    {station ? (
                      <Text style={[styles.weekStation, { color: meta.color }]} numberOfLines={1}>
                        {station}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        <View style={styles.legend}>
          {(['off', 'flying', 'layover', 'standby', 'busy'] as CrewRoomDayStatus[]).map((s) => {
            const meta = crewRoomStatusMeta(s);
            return (
              <View key={s} style={styles.legendItem}>
                <Ionicons name={meta.icon} size={12} color={meta.color} />
                <Text style={styles.legendText}>{statusLabel(s)}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const segments: { key: Segment; label: string; badge?: number }[] = [
    { key: 'today', label: t('crewRoom.tabs.today') },
    { key: 'week', label: t('crewRoom.tabs.week') },
    { key: 'offDays', label: t('crewRoom.tabs.offDays') },
    { key: 'people', label: t('crewRoom.tabs.people'), badge: overview?.incoming.length || undefined },
  ];

  const hasAccess = overview?.me.has_access === true;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Math.max(insets.top, 8) + 8, paddingBottom: 32 + Math.max(insets.bottom, 8) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={colors.primary} />
        }
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {t('nav.crewRoom')}
          </Text>
          {overview ? (
            <TouchableOpacity
              onPress={() => setSettingsOpen(true)}
              style={[styles.pageIconBtn, { borderColor: colors.border }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('crewRoom.settings.title')}
            >
              <Ionicons name="settings-outline" size={18} color={colors.text} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.pageSubtitle}>{t('crewRoom.subtitle')}</Text>

        {loading && !overview ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : loadError && !overview ? (
          <View style={cardStyle}>
            <Text style={styles.cardHint}>{loadError}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => void load('initial')}>
              <Text style={styles.primaryBtnText}>{t('crewRoom.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : !hasAccess ? (
          renderGate()
        ) : (
          <>
            <View style={[styles.segWrap, { backgroundColor: themeMode === 'dark' ? '#1A2740' : '#E9ECF2' }]}>
              {segments.map((s) => {
                const selected = segment === s.key;
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.segItem, selected && { backgroundColor: colors.surface }]}
                    onPress={() => setSegment(s.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[styles.segText, { color: selected ? colors.text : colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {s.label}
                    </Text>
                    {s.badge ? (
                      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.badgeText}>{s.badge > 99 ? '99+' : s.badge}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            {segment === 'today' ? (
              <CrewRoomToday
                people={roomPeople}
                dayIndex={dayIndex}
                today={today}
                locale={locale}
                onOpenPerson={setOpenPersonId}
                onInvite={() => setSegment('people')}
              />
            ) : null}
            {segment === 'week' && renderWeek()}
            {segment === 'offDays' ? (
              <CrewRoomOffDays
                people={roomPeople}
                dayIndex={dayIndex}
                days={days}
                today={today}
                locale={locale}
                onOpenPerson={setOpenPersonId}
              />
            ) : null}
            {segment === 'people' && overview ? (
              <CrewRoomPeoplePanel
                overview={overview}
                onOpenPerson={setOpenPersonId}
                onChanged={() => void load('silent')}
              />
            ) : null}
          </>
        )}
      </ScrollView>
      {overview && openPerson ? (
        <CrewRoomPersonSheet
          person={openPerson}
          me={overview.me}
          days={days}
          today={today}
          locale={locale}
          onClose={() => setOpenPersonId(null)}
          onChanged={() => void load('silent')}
        />
      ) : null}
      {overview && settingsOpen ? (
        <CrewRoomSettingsSheet
          me={overview.me}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => void load('silent')}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
    scroll: { paddingHorizontal: 16 },
    pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    pageTitle: { flexShrink: 1, fontSize: 28, fontWeight: '800', letterSpacing: -0.3, color: colors.text },
    pageIconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    pageSubtitle: { fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 14, color: colors.textMuted },
    card: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 16,
      marginBottom: 12,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    cardHint: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 12, color: colors.textMuted },
    segWrap: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3, marginBottom: 12 },
    segItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minHeight: 38,
      borderRadius: 9,
      paddingHorizontal: 2,
    },
    segText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
    badge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
    gateCard: { alignItems: 'center', paddingVertical: 24 },
    gateIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    gateTitle: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
    gateText: { fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 16 },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.button,
      minHeight: 46,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
    },
    primaryBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
    iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    weekHeaderRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 },
    weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    weekNameCol: { width: 64, paddingRight: 4 },
    weekName: { fontSize: 12, fontWeight: '700', color: colors.text },
    weekCell: { flex: 1, alignItems: 'center' },
    weekDayName: { fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
    weekDayNum: { fontSize: 13, fontWeight: '800', color: colors.text },
    weekChip: {
      width: '92%',
      minHeight: 34,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 3,
    },
    weekStation: { fontSize: 9, fontWeight: '800', marginTop: 1 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
    disabled: { opacity: 0.35 },
  });
}
