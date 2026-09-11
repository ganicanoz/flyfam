import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../lib/supabase';
import {
  addCalendarDaysToYmd,
  calendarDateFromUtcIsoInTimeZone,
  formatFlightTimeInTz,
} from '../lib/dateUtils';
import { getAirportDisplay, getAirportTimezone } from '../constants/airports';
import { useSession } from '../contexts/SessionContext';
import { colors, useThemeMode } from '../theme/colors';
import { cardAccent, radius, rosterMarks, spacing, typography } from '../theme/tokens';
import KeyboardSafeScroll from '../components/KeyboardSafeScroll';
import TimeRollerField from '../components/TimeRollerField';
import DateRollerField from '../components/DateRollerField';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { BottomActionBar } from '../components/BottomActionBar';
import { FormCard } from '../components/FormCard';
import {
  isStandbyOccupationCode,
  localDateTimeInTimezoneToUtcIso,
} from '../lib/pdfRosterImport';
import {
  rosterOccupationLabelEn,
  rosterOccupationLabelTr,
} from '../lib/rosterOccupationLabels';

/** Base yoksa Pegasus / TR varsayılanı. */
const DUTY_FALLBACK_TZ = 'Europe/Istanbul';

type EditDutyParams = { flightId: string; readOnly?: boolean };

function toUtcIsoFromDateTime(dateStr: string, timeStr: string, timeZone: string): string | null {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return null;
  const [hs, ms] = timeStr.trim().split(':');
  const hh = String(hs ?? '0').padStart(2, '0');
  const mm = String(ms ?? '0').padStart(2, '0');
  return localDateTimeInTimezoneToUtcIso(dateStr, `${hh}:${mm}`, timeZone);
}

function dutyTimeHHMM(iso: string | null | undefined, timeZone: string): string {
  const t = formatFlightTimeInTz(iso, timeZone);
  return t === '—' ? '' : t;
}

function timeToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/** Bitiş saati ≤ başlangıç → ertesi gün (sıfır süre yok; eşit saat = 24sa). */
function resolveEndYmd(startYmd: string, startHhmm: string, endHhmm: string): string {
  const sm = timeToMinutes(startHhmm);
  const em = timeToMinutes(endHhmm);
  if (sm == null || em == null || !/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return startYmd;
  return em <= sm ? addCalendarDaysToYmd(startYmd, 1) : startYmd;
}

function formatDuration(minutes: number | null, language: string): string {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if ((language || '').toLowerCase().startsWith('tr')) {
    if (h > 0 && m > 0) return `${h}sa ${m}dk`;
    if (h > 0) return `${h}sa`;
    return `${m}dk`;
  }
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Örn. `09 Eylül 2026` */
function formatLongYmd(ymd: string, language: string): string {
  const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const at = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  if (Number.isNaN(at.getTime())) return ymd;
  const isTr = (language || '').toLowerCase().startsWith('tr');
  return at.toLocaleDateString(isTr ? 'tr-TR' : 'en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatRelativeAgo(iso: string, language: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  const isTr = (language || '').toLowerCase().startsWith('tr');
  if (diffMin < 1) return isTr ? 'az önce' : 'just now';
  if (diffMin < 60) return isTr ? `${diffMin} dk önce` : `${diffMin} min ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return isTr ? `${h} sa önce` : `${h}h ago`;
  const days = Math.floor(h / 24);
  return isTr ? `${days} g önce` : `${days}d ago`;
}

export default function EditDuty() {
  const { t, i18n } = useTranslation();
  const { crewProfile } = useSession();
  const themeMode = useThemeMode();
  const accent = cardAccent('standby', themeMode);
  const marks = rosterMarks(themeMode);
  const styles = useMemo(() => createStyles(), [themeMode]);
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: EditDutyParams }, 'params'>>();
  const flightId = route.params?.flightId;
  const readOnly = route.params?.readOnly === true;

  const [code, setCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  /** Kullanıcı bitiş tarihini elle seçtiyse otomatik +1 ezilmez. */
  const [endDateManual, setEndDateManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [airportName, setAirportName] = useState<string | null>(null);
  const [lastNoticeAt, setLastNoticeAt] = useState<string | null>(null);

  const dutyBaseIata = (crewProfile?.home_base_iata ?? '').trim().toUpperCase() || null;
  const dutyTz =
    (dutyBaseIata ? getAirportTimezone(dutyBaseIata) : null) ?? DUTY_FALLBACK_TZ;

  const isTr = String(i18n.language || '').toLowerCase().startsWith('tr');
  const fieldFill = colors.inputFill;
  const isStandby = isStandbyOccupationCode(code);

  const applyAutoEndDate = useCallback(
    (nextStart: string, nextStartTime: string, nextEndTime: string) => {
      if (endDateManual) return;
      if (!nextStart || !nextStartTime || !nextEndTime) return;
      setEndDate(resolveEndYmd(nextStart, nextStartTime, nextEndTime));
    },
    [endDateManual],
  );

  const endIsNextDay = useMemo(() => {
    if (!startDate || !endDate) return false;
    return endDate > startDate;
  }, [startDate, endDate]);

  const durationText = useMemo(() => {
    if (!startDate || !endDate || !startTime || !endTime) return '—';
    const dep = toUtcIsoFromDateTime(startDate, startTime, dutyTz);
    const arr = toUtcIsoFromDateTime(endDate, endTime, dutyTz);
    if (!dep || !arr) return '—';
    const depMs = Date.parse(dep);
    const arrMs = Date.parse(arr);
    if (!Number.isFinite(depMs) || !Number.isFinite(arrMs) || arrMs <= depMs) return '—';
    return formatDuration(Math.round((arrMs - depMs) / 60000), i18n.language || 'tr');
  }, [startDate, endDate, startTime, endTime, dutyTz, i18n.language]);

  const locationLine = useMemo(() => {
    if (!dutyBaseIata) return null;
    const info = getAirportDisplay(dutyBaseIata);
    const cityFallback =
      (crewProfile?.home_base_city ?? '').trim() ||
      (isTr ? info?.city_tr || info?.city : info?.city) ||
      null;
    const name = (airportName ?? cityFallback)?.trim() || null;
    return name ? `${dutyBaseIata} · ${name}` : dutyBaseIata;
  }, [dutyBaseIata, airportName, crewProfile?.home_base_city, isTr]);

  useEffect(() => {
    if (!dutyBaseIata) {
      setAirportName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('airports')
        .select('iata, name, name_tr, city, city_tr')
        .eq('iata', dutyBaseIata)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        setAirportName(null);
        return;
      }
      const nm = isTr
        ? (data.name_tr || data.name || data.city_tr || data.city || null)
        : (data.name || data.name_tr || data.city || data.city_tr || null);
      setAirportName(typeof nm === 'string' && nm.trim() ? nm.trim() : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [dutyBaseIata, isTr]);

  useEffect(() => {
    if (!flightId) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('flights')
        .select('flight_number, flight_date, scheduled_departure, scheduled_arrival, roster_entry_kind')
        .eq('id', flightId)
        .single();
      if (cancelled) return;
      setFetching(false);
      if (error || !data) return;
      const fn = ((data.flight_number as string) ?? '').trim().toUpperCase();
      setCode(fn);
      const sDate =
        calendarDateFromUtcIsoInTimeZone(data.scheduled_departure as string, dutyTz) ||
        ((data.flight_date as string) ?? '');
      const eDate =
        calendarDateFromUtcIsoInTimeZone(data.scheduled_arrival as string, dutyTz) || sDate;
      const sTime = dutyTimeHHMM(data.scheduled_departure as string, dutyTz);
      const eTime = dutyTimeHHMM(data.scheduled_arrival as string, dutyTz);
      setStartDate(sDate);
      setEndDate(eDate);
      setStartTime(sTime);
      setEndTime(eTime);
      // DB’deki bitiş günü otomatik kuraldan farklıysa manuel kabul et.
      const autoEnd = resolveEndYmd(sDate, sTime, eTime);
      setEndDateManual(!!eDate && eDate !== autoEnd);
    })();
    return () => {
      cancelled = true;
    };
  }, [flightId, dutyTz]);

  useEffect(() => {
    if (!crewProfile?.user_id || !startDate) {
      setLastNoticeAt(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('user_activity_events')
        .select('occurred_at, meta')
        .eq('user_id', crewProfile.user_id)
        .eq('event_type', 'family_push')
        .order('occurred_at', { ascending: false })
        .limit(20);
      if (cancelled) return;
      const hit = (data ?? []).find((row) => {
        const meta = (row as { meta?: Record<string, unknown> }).meta;
        return meta?.kind === 'standby_assigned' && String(meta?.date ?? '') === startDate;
      });
      setLastNoticeAt(hit ? String((hit as { occurred_at: string }).occurred_at) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [crewProfile?.user_id, startDate]);

  const onChangeStartTime = (v: string) => {
    setStartTime(v);
    applyAutoEndDate(startDate, v, endTime);
  };

  const onChangeEndTime = (v: string) => {
    setEndTime(v);
    applyAutoEndDate(startDate, startTime, v);
  };

  const onChangeStartDate = (ymd: string) => {
    setStartDate(ymd);
    applyAutoEndDate(ymd, startTime, endTime);
  };

  const onChangeEndDate = (ymd: string) => {
    setEndDateManual(true);
    setEndDate(ymd);
  };

  const handleSave = async () => {
    if (!startDate || startDate.length !== 10) {
      Alert.alert(t('common.error'), t('editDuty.errorDate'));
      return;
    }
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) {
      Alert.alert(t('common.error'), t('editDuty.errorTimes'));
      return;
    }
    const resolvedEnd = endDateManual
      ? endDate || resolveEndYmd(startDate, startTime, endTime)
      : resolveEndYmd(startDate, startTime, endTime);
    setLoading(true);
    const depIso = toUtcIsoFromDateTime(startDate, startTime, dutyTz);
    const arrIso = toUtcIsoFromDateTime(resolvedEnd, endTime, dutyTz);
    if (!depIso || !arrIso || Date.parse(arrIso) <= Date.parse(depIso)) {
      setLoading(false);
      Alert.alert(t('common.error'), t('editDuty.errorTimes'));
      return;
    }
    const { error } = await supabase
      .from('flights')
      .update({
        flight_date: startDate,
        scheduled_departure: depIso,
        scheduled_arrival: arrIso,
      })
      .eq('id', flightId);
    setLoading(false);
    if (error) {
      Alert.alert(t('common.error'), error.message);
      return;
    }
    navigation.goBack();
  };

  const handleAssignNotice = () => {
    if (!flightId || !startDate) return;
    Alert.alert(t('roster.assignFlightsConfirmTitle'), t('roster.assignFlightsConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('roster.assignFlightsContinue'),
        onPress: () => {
          navigation.navigate('AddFlight', {
            prefillFlightDate: startDate,
            replaceStandbyFlightId: flightId,
          });
        },
      },
    ]);
  };

  const handleDelete = () => {
    Alert.alert(t('editDuty.deleteTitle'), t('editDuty.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeleting(true);
            const { error: rpcErr } = await supabase.rpc('remove_me_from_flight', {
              p_flight_id: flightId,
            });
            if (rpcErr) {
              const { error } = await supabase.from('flights').delete().eq('id', flightId);
              setDeleting(false);
              if (error) {
                Alert.alert(t('common.error'), error.message);
                return;
              }
            } else {
              setDeleting(false);
            }
            navigation.goBack();
          })();
        },
      },
    ]);
  };

  if (fetching) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }

  const startDateCaption = startDate
    ? `${formatLongYmd(startDate, i18n.language || 'tr')} · ${t('editDuty.localCaption')}`
    : t('editDuty.placeholderDate');
  const endDateCaption = endDate
    ? `${formatLongYmd(endDate, i18n.language || 'tr')} · ${
        endIsNextDay ? t('editDuty.nextDayCaption') : t('editDuty.localCaption')
      }`
    : t('editDuty.placeholderDate');

  const badgeLabel = String(t('editDuty.nightDutyBadge')).toLocaleUpperCase(i18n.language || 'tr');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={t('editDuty.title')} />
      <KeyboardSafeScroll
        style={styles.scroll}
        contentContainerStyle={[styles.content, !readOnly && { paddingBottom: 140 }]}
        bottomOffset={48}
      >
        {locationLine ? (
          <View
            style={styles.locationRow}
            accessibilityRole="text"
            accessibilityLabel={locationLine}
          >
            <Ionicons name="location-sharp" size={18} color={colors.primary} />
            <Text style={styles.locationText}>{locationLine}</Text>
          </View>
        ) : null}

        <View
          style={[styles.nightBadge, { backgroundColor: colors.primaryLight }]}
          accessibilityRole="text"
          accessibilityLabel={badgeLabel}
          accessible
        >
          <Ionicons name="moon" size={12} color={colors.secondary} />
          <Text style={[styles.nightBadgeText, { color: colors.secondary }]} numberOfLines={1}>
            {badgeLabel}
          </Text>
        </View>

        <FormCard accentColor={accent}>
          <View style={styles.cardInner}>
            <View style={styles.timeBlock}>
              <Text style={styles.fieldLabel}>{t('editDuty.startTime')}</Text>
              {readOnly ? (
                <Text style={[styles.timeBig, { backgroundColor: fieldFill }]}>
                  {startTime || '—'}
                </Text>
              ) : (
                <TimeRollerField
                  value={startTime}
                  onChange={onChangeStartTime}
                  placeholder={t('editDuty.placeholderTime')}
                />
              )}
              {readOnly ? (
                <Text style={[styles.readValue, { backgroundColor: fieldFill }]}>{startDateCaption}</Text>
              ) : (
                <DateRollerField
                  value={startDate}
                  onChange={onChangeStartDate}
                  displayLabel={startDateCaption}
                  placeholder={t('editDuty.placeholderDate')}
                  accessibilityLabel={t('editDuty.startTime')}
                />
              )}
            </View>

            <View style={styles.timeBlock}>
              <Text style={styles.fieldLabel}>{t('editDuty.endTime')}</Text>
              {readOnly ? (
                <Text style={[styles.timeBig, { backgroundColor: fieldFill }]}>
                  {endTime || '—'}
                </Text>
              ) : (
                <TimeRollerField
                  value={endTime}
                  onChange={onChangeEndTime}
                  placeholder={t('editDuty.placeholderTime')}
                />
              )}
              {readOnly ? (
                <Text style={[styles.readValue, { backgroundColor: fieldFill }]}>{endDateCaption}</Text>
              ) : (
                <DateRollerField
                  value={endDate}
                  onChange={onChangeEndDate}
                  displayLabel={endDateCaption}
                  placeholder={t('editDuty.placeholderDate')}
                  accessibilityLabel={t('editDuty.endTime')}
                />
              )}
            </View>

            <View style={[styles.durationBox, { backgroundColor: fieldFill }]}>
              <Text style={styles.durationLabel}>{t('editDuty.windowDuration')}</Text>
              <Text style={[styles.durationValue, { color: colors.secondary }]}>{durationText}</Text>
            </View>
          </View>
        </FormCard>

        {!readOnly && isStandby ? (
          <View style={styles.noticeBlock}>
            <TouchableOpacity
              style={[
                styles.assignBox,
                {
                  backgroundColor: marks.standbyBadgeBg,
                  borderColor:
                    themeMode === 'dark' ? 'rgba(240,176,96,0.35)' : 'rgba(245,158,11,0.28)',
                },
              ]}
              onPress={handleAssignNotice}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('roster.assignFlightsA11y')}
            >
              <View style={[styles.assignIconWrap, { backgroundColor: marks.standbyLine }]}>
                <Ionicons name="airplane" size={16} color="#FFFFFF" />
              </View>
              <Text style={[styles.assignBoxText, { color: marks.standbyBadgeText }]}>
                {t('roster.assignFlights')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={marks.standbyBadgeText} />
            </TouchableOpacity>
            {lastNoticeAt ? (
              <Text style={styles.lastNotice}>
                {t('editDuty.lastNotice', {
                  when: formatRelativeAgo(lastNoticeAt, i18n.language || 'tr'),
                })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!isStandby && code ? (
          <Text style={styles.codeHint}>
            {(isTr ? rosterOccupationLabelTr(code) : rosterOccupationLabelEn(code)) || code}
          </Text>
        ) : null}
      </KeyboardSafeScroll>

      {!readOnly ? (
        <BottomActionBar>
          <PrimaryButton
            title={t('editDuty.saveChanges')}
            onPress={() => void handleSave()}
            loading={loading}
          />
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={handleDelete}
            disabled={deleting}
            accessibilityRole="button"
          >
            {deleting ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.deleteBtnText}>{t('editDuty.deleteTitle')}</Text>
            )}
          </TouchableOpacity>
        </BottomActionBar>
      ) : null}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xl },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: spacing.sm,
      paddingHorizontal: 2,
    },
    locationText: {
      ...typography.cardTitle,
      color: colors.text,
      flexShrink: 1,
    },
    nightBadge: {
      alignSelf: 'flex-start',
      height: 24,
      minHeight: 24,
      maxHeight: 24,
      paddingHorizontal: 11,
      borderRadius: radius.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginBottom: spacing.sm,
    },
    nightBadgeText: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    cardInner: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 4 },
    timeBlock: { marginBottom: spacing.sm },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginBottom: 6,
      marginTop: 4,
    },
    timeBig: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '700',
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: radius.button,
      overflow: 'hidden',
      marginBottom: 8,
      ...typography.tabularNums,
    },
    readValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.button,
      overflow: 'hidden',
      marginTop: 8,
    },
    durationBox: {
      marginTop: spacing.sm,
      borderRadius: radius.button,
      paddingVertical: 12,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    durationLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    durationValue: { fontSize: 16, fontWeight: '800' },
    noticeBlock: { marginTop: spacing.sm, gap: 8 },
    assignBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: radius.button,
      borderWidth: StyleSheet.hairlineWidth,
      minHeight: 48,
    },
    assignIconWrap: {
      width: 30,
      height: 30,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assignBoxText: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
    },
    lastNotice: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
      textAlign: 'center',
    },
    codeHint: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    deleteBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      minHeight: 44,
      marginTop: 4,
    },
    deleteBtnText: { color: colors.error, fontSize: 15, fontWeight: '700' },
  });
}
