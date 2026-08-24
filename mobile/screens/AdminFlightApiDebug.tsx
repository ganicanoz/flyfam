import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useStackGoBack } from '../lib/useStackGoBack';
import { StackScreenBackButton } from '../components/StackScreenBackButton';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { RootStackParamList } from '../navigationRef';
import { useAdminRoster } from '../contexts/AdminRosterContext';
import { supabase } from '../lib/supabase';
import { computeApiRefreshPhase } from '../lib/flightApiRefreshPhase';
import {
  FR24_FLIGHT_SUMMARY_LIGHT_URL,
  fetchFr24LightForAdminDebug,
  pollFlightForRosterWithTrace,
  type FlightPollTraceEntry,
} from '../lib/flightStatusPoll';
import type { FlightInfo } from '../lib/flightApi';
import {
  buildAdminDbApiComparisonRows,
  formatPollTraceForAdminDisplay,
  type AdminComparisonRow,
  type AdminFlightPhaseMeta,
} from '../lib/flightApiDebugLines';
import { buildAdminPollEdgeSummaryRows } from '../lib/adminCheckFlightPollInfo';
import {
  adminPrioritySectionTitle,
  getFlightProviderPriorityOrder,
  timetableWaterfallPolicyNote,
} from '../lib/flightProviderPriority';
import { colors, useThemeMode } from '../theme/colors';
import { useFontScaleMultiplier } from '../theme/fontScale';

type NavRoute = RouteProp<RootStackParamList, 'AdminFlightApiDebug'>;

function phaseArgsFromRow(row: Record<string, unknown>, nowMs: number) {
  return {
    roster_entry_kind: (row.roster_entry_kind as string | null) ?? null,
    scheduled_departure: (row.scheduled_departure as string | null) ?? null,
    scheduled_arrival: (row.scheduled_arrival as string | null) ?? null,
    estimated_departure: (row.estimated_departure as string | null) ?? null,
    nowMs,
    roster_flight_date: (row.flight_date as string | null) ?? null,
    origin_airport: (row.origin_airport as string | null) ?? null,
    delay_dep_min: (row.delay_dep_min as number | null) ?? null,
    flight_status: (row.flight_status as string | null) ?? null,
    internal_status: (row.internal_status as string | null) ?? null,
    actual_arrival: (row.actual_arrival as string | null) ?? null,
    fr24_datetime_landed_utc: (row.fr24_datetime_landed_utc as string | null) ?? null,
    last_seen_utc: (row.last_seen_utc as string | null) ?? null,
    phase_active_locked: (row.phase_active_locked as boolean | null) ?? null,
  };
}

function pickPollPhase(computed: ReturnType<typeof computeApiRefreshPhase>): 'semi_active' | 'active' {
  if (computed === 'active') return 'active';
  return 'semi_active';
}

function formatAdminApiTime(isoUtc: string, loc: 'tr' | 'en'): string {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return isoUtc;
  const d = new Date(ms);
  const tag = loc === 'tr' ? 'tr-TR' : 'en-US';
  const local = d.toLocaleString(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${local} · ${isoUtc}`;
}

function pickStringWithSource(
  candidates: Array<{ value: unknown; sourceTr: string; sourceEn: string }>,
): { value: string; sourceTr: string; sourceEn: string } {
  for (const c of candidates) {
    if (typeof c.value === 'string' && c.value.trim().length > 0) {
      return { value: c.value.trim(), sourceTr: c.sourceTr, sourceEn: c.sourceEn };
    }
  }
  return { value: '—', sourceTr: 'yok', sourceEn: 'none' };
}

type AdminPctTableRow = { label: string; value: string; source: string };

function buildAdminPercentageTableRows(
  row: Record<string, unknown>,
  info: FlightInfo | null,
  locale: 'tr' | 'en',
): AdminPctTableRow[] {
  const depSelected = pickStringWithSource([
    { value: info?.fr24_progress_dep_utc, sourceTr: 'API fr24_progress_dep_utc', sourceEn: 'API fr24_progress_dep_utc' },
    { value: info?.fr24_datetime_takeoff_utc, sourceTr: 'API fr24_datetime_takeoff_utc', sourceEn: 'API fr24_datetime_takeoff_utc' },
    { value: row.fr24_progress_dep_utc, sourceTr: 'DB fr24_progress_dep_utc', sourceEn: 'DB fr24_progress_dep_utc' },
    { value: row.fr24_datetime_takeoff_utc, sourceTr: 'DB fr24_datetime_takeoff_utc', sourceEn: 'DB fr24_datetime_takeoff_utc' },
    { value: info?.scheduled_departure_utc, sourceTr: 'API scheduled_departure_utc', sourceEn: 'API scheduled_departure_utc' },
    { value: row.scheduled_departure, sourceTr: 'DB scheduled_departure', sourceEn: 'DB scheduled_departure' },
  ]);
  const etaSelected = pickStringWithSource([
    { value: info?.fr24_progress_eta_utc, sourceTr: 'API fr24_progress_eta_utc', sourceEn: 'API fr24_progress_eta_utc' },
    { value: info?.fr24_datetime_landed_utc, sourceTr: 'API fr24_datetime_landed_utc', sourceEn: 'API fr24_datetime_landed_utc' },
    { value: row.fr24_progress_eta_utc, sourceTr: 'DB fr24_progress_eta_utc', sourceEn: 'DB fr24_progress_eta_utc' },
    { value: row.fr24_datetime_landed_utc, sourceTr: 'DB fr24_datetime_landed_utc', sourceEn: 'DB fr24_datetime_landed_utc' },
    { value: info?.scheduled_arrival_utc, sourceTr: 'API scheduled_arrival_utc', sourceEn: 'API scheduled_arrival_utc' },
    { value: row.scheduled_arrival, sourceTr: 'DB scheduled_arrival', sourceEn: 'DB scheduled_arrival' },
  ]);
  const airlabsPct =
    info?.airlabsProgressPercent ??
    (typeof row.airlabs_progress_percent === 'number' ? row.airlabs_progress_percent : null);
  const pctSource = info?.airlabsProgressPercent != null
    ? { tr: 'API airlabsProgressPercent', en: 'API airlabsProgressPercent' }
    : typeof row.airlabs_progress_percent === 'number'
      ? { tr: 'DB airlabs_progress_percent', en: 'DB airlabs_progress_percent' }
      : { tr: '—', en: '—' };

  if (locale === 'tr') {
    return [
      { label: 'Çubuk başı', value: depSelected.value, source: depSelected.sourceTr },
      { label: 'Çubuk bitişi / ETA', value: etaSelected.value, source: etaSelected.sourceTr },
      {
        label: 'AirLabs % (yedek)',
        value: airlabsPct == null ? '—' : String(Math.round(airlabsPct)),
        source: pctSource.tr,
      },
    ];
  }
  return [
    { label: 'Bar start', value: depSelected.value, source: depSelected.sourceEn },
    { label: 'Bar end / ETA', value: etaSelected.value, source: etaSelected.sourceEn },
    {
      label: 'AirLabs % (fallback)',
      value: airlabsPct == null ? '—' : String(Math.round(airlabsPct)),
      source: pctSource.en,
    },
  ];
}

function comparisonRowsToClipboard(rows: AdminComparisonRow[], locale: 'tr' | 'en'): string {
  const sep = '\t';
  const h0 = locale === 'tr' ? 'Alan' : 'Field';
  const h1 = 'DB';
  const h2 = locale === 'tr' ? 'Son poll (API)' : 'Last poll (API)';
  const lines = [
    [h0, h1, h2].join(sep),
    ...rows.map((r) => [r.label, r.db, r.api].map((c) => c.replace(/\n/g, ' ')).join(sep)),
  ];
  return lines.join('\n');
}

export default function AdminFlightApiDebug() {
  const { i18n, t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<NavRoute>();
  const { isAdminUser } = useAdminRoster();
  const themeMode = useThemeMode();
  const isDark = themeMode === 'dark';
  const fontScale = useFontScaleMultiplier();
  const flightId = route.params?.flightId;

  const locale = String(i18n.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';

  const labels = useMemo(() => {
    return locale === 'tr'
      ? {
          trace: 'Birleşik poll · kaynaklar',
          fr24: 'FR24 doğrudan (Flight Summary light)',
          fr24UrlLine: 'GET',
          apiReqHeader: 'İstek zamanları',
          apiReqMerged: 'Birleşik poll',
          apiReqFr24: 'FR24 doğrudan',
          pctHeader: 'Roster çubuğu (seçilen saatler)',
          pollHeader: 'Edge · harici poll özeti',
          compareHeader: 'DB ↔ son poll (tek tablo)',
          compareColField: 'Alan',
          compareColDb: 'DB',
          compareColApi: 'Poll',
          pctColField: 'Alan',
          pctColValue: 'Değer',
          pctColSource: 'Kaynak',
          pollColLabel: 'Öğe',
          pollColValue: 'Değer',
          copyButton: 'Kopyala',
          fr24LoginButton: 'FR24 kullanim panelini ac',
          fr24SyncButton: 'FR24 kullanim verisini cek',
          fr24SyncBusy: 'FR24 verisi cekiliyor...',
          forcePollButton: 'Cooldown\'a ragmen API iste',
          forcePollBusy: 'Isteniyor...',
          copySuccess: 'Detaylar panoya kopyalandı.',
          copyError: 'Panoya kopyalanamadı.',
          noDataToCopy: 'Kopyalanacak veri yok.',
          fr24SyncDone: 'FR24 kullanim verisi alindi.',
          fr24SyncFailed: 'FR24 kullanim verisi alinamadi.',
          apiEmpty: 'API yanıtı yok.',
          loadErr: 'Uçuş yüklenemedi.',
          noId: 'flightId yok.',
          nonFlight: 'Uçuş segmenti değil; API sorgusu yapılmadı.',
        }
      : {
          trace: 'Merged poll · sources',
          fr24: 'FR24 direct (Flight Summary light)',
          fr24UrlLine: 'GET',
          apiReqHeader: 'Request times',
          apiReqMerged: 'Merged poll',
          apiReqFr24: 'FR24 direct',
          pctHeader: 'Roster bar (selected times)',
          pollHeader: 'Edge · external poll summary',
          compareHeader: 'DB ↔ last poll (single table)',
          compareColField: 'Field',
          compareColDb: 'DB',
          compareColApi: 'Poll',
          pctColField: 'Field',
          pctColValue: 'Value',
          pctColSource: 'Source',
          pollColLabel: 'Item',
          pollColValue: 'Value',
          copyButton: 'Copy',
          fr24LoginButton: 'Open FR24 usage panel',
          fr24SyncButton: 'Fetch FR24 usage metrics',
          fr24SyncBusy: 'Fetching FR24 usage metrics...',
          forcePollButton: 'Request API ignoring cooldown',
          forcePollBusy: 'Requesting...',
          copySuccess: 'Copied all details to clipboard.',
          copyError: 'Could not copy to clipboard.',
          noDataToCopy: 'No data to copy.',
          fr24SyncDone: 'FR24 usage metrics fetched.',
          fr24SyncFailed: 'Failed to fetch FR24 usage metrics.',
          apiEmpty: 'No API response.',
          loadErr: 'Could not load flight.',
          noId: 'Missing flightId.',
          nonFlight: 'Not a flight segment; no API poll.',
        };
  }, [locale]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forcePolling, setForcePolling] = useState(false);
  const [fr24Syncing, setFr24Syncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonRows, setComparisonRows] = useState<AdminComparisonRow[]>([]);
  const [pctRows, setPctRows] = useState<AdminPctTableRow[]>([]);
  const [pollEdgeRows, setPollEdgeRows] = useState<{ label: string; value: string }[]>([]);
  const [traceText, setTraceText] = useState<string>('');
  const [fr24TraceText, setFr24TraceText] = useState<string>('');
  const [apiRequestTimes, setApiRequestTimes] = useState<{
    mergedPollIso: string;
    fr24DirectIso: string;
  } | null>(null);
  const [meta, setMeta] = useState<{
    fn: string;
    date: string;
    kind: string | null;
    pollPhase: 'semi_active' | 'active' | null;
  } | null>(null);
  const traceDisplay = traceText.trim().length > 0 ? traceText : locale === 'tr' ? '(Henüz iz yok)' : '(No trace yet)';
  const fr24TraceDisplay =
    fr24TraceText.trim().length > 0
      ? fr24TraceText
      : locale === 'tr'
        ? '(FR24 bölümü yüklenmedi)'
        : '(FR24 section not loaded)';

  const copyPayload = useMemo(() => {
    const lines: string[] = [];
    if (meta) {
      lines.push(
        `${meta.fn} · ${meta.date}${meta.kind && meta.kind !== 'flight' ? ` · ${meta.kind}` : ''}`,
        '',
      );
      if (meta.pollPhase) {
        lines.push(
          adminPrioritySectionTitle(locale),
          timetableWaterfallPolicyNote(locale),
          ...getFlightProviderPriorityOrder(meta.pollPhase, locale).map((n, i) => `${i + 1}. ${n}`),
          '',
        );
      }
    }
    if (pctRows.length > 0) {
      lines.push(labels.pctHeader, ...pctRows.map((r) => `${r.label}\t${r.value}\t${r.source}`), '');
    }
    if (pollEdgeRows.length > 0) {
      lines.push(labels.pollHeader, ...pollEdgeRows.map((r) => `${r.label}: ${r.value}`), '');
    }
    if (apiRequestTimes) {
      lines.push(
        labels.apiReqHeader,
        `${labels.apiReqMerged}: ${formatAdminApiTime(apiRequestTimes.mergedPollIso, locale)}`,
        `${labels.apiReqFr24}: ${formatAdminApiTime(apiRequestTimes.fr24DirectIso, locale)}`,
        '',
      );
    }
    if (comparisonRows.length > 0) {
      lines.push(labels.compareHeader, comparisonRowsToClipboard(comparisonRows, locale), '');
    }
    lines.push(labels.trace, traceDisplay, '', labels.fr24, `${labels.fr24UrlLine} ${FR24_FLIGHT_SUMMARY_LIGHT_URL}`, fr24TraceDisplay);
    return lines.join('\n').trim();
  }, [
    apiRequestTimes,
    comparisonRows,
    fr24TraceDisplay,
    labels,
    locale,
    meta,
    pctRows,
    pollEdgeRows,
    traceDisplay,
  ]);

  const mono = StyleSheet.create({
    text: {
      fontSize: Math.round(11 * fontScale),
      lineHeight: Math.round(15 * fontScale),
      color: colors.text,
      ...Platform.select({
        ios: { fontFamily: 'Menlo' },
        android: { fontFamily: 'monospace' },
        default: { fontFamily: 'monospace' },
      }),
    },
    h: {
      fontSize: Math.round(12 * fontScale),
      fontWeight: '800',
      color: colors.primary,
      marginTop: 14,
      marginBottom: 8,
    },
    sectionFirst: {
      fontSize: Math.round(12 * fontScale),
      fontWeight: '800',
      color: colors.primary,
      marginTop: 0,
      marginBottom: 8,
    },
  });

  const tableStyles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 14,
        },
        head: {
          flexDirection: 'row',
          backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
          paddingVertical: 6,
          paddingHorizontal: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
        },
        row: {
          flexDirection: 'row',
          paddingVertical: 6,
          paddingHorizontal: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          alignItems: 'flex-start',
        },
        rowLast: { borderBottomWidth: 0 },
        col33: { flex: 1, paddingRight: 4 },
        col34: { flex: 1.05, paddingRight: 4 },
        col32: { flex: 0.95 },
      }),
    [isDark],
  );

  const leaveAdminDebug = useCallback(() => {
    const nav = navigation as { canGoBack?: () => boolean; goBack: () => void; navigate: (n: string, p?: object) => void };
    if (nav.canGoBack?.()) {
      nav.goBack();
      return;
    }
    nav.navigate('Main', { screen: 'Roster' });
  }, [navigation]);

  const copyAllDetails = useCallback(async () => {
    const text = copyPayload.trim();
    if (!text) {
      Alert.alert(labels.copyButton, labels.noDataToCopy);
      return;
    }
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text);
      Alert.alert(labels.copyButton, labels.copySuccess);
    } catch {
      Alert.alert(labels.copyButton, labels.copyError);
    }
  }, [copyPayload, labels]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <StackScreenBackButton onPress={leaveAdminDebug} />,
      headerLeftContainerStyle: {
        paddingHorizontal: 0,
        paddingLeft: Platform.OS === 'ios' ? 6 : 4,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
      },
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            void copyAllDetails();
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{
            marginRight: Platform.OS === 'ios' ? 8 : 2,
            paddingVertical: 6,
            paddingHorizontal: 8,
          }}
          accessibilityRole="button"
          accessibilityLabel={labels.copyButton}
        >
          <Text style={{ color: colors.white, fontWeight: '700', fontSize: Math.round(13 * fontScale) }}>
            {labels.copyButton}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, leaveAdminDebug, copyAllDetails, labels.copyButton, fontScale, t]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        leaveAdminDebug();
        return true;
      });
      return () => sub.remove();
    }, [leaveAdminDebug]),
  );

  useEffect(() => {
    if (!isAdminUser) {
      leaveAdminDebug();
    }
  }, [isAdminUser, leaveAdminDebug]);

  const applyRowState = useCallback(
    (
      r: Record<string, unknown>,
      opts: {
        info: FlightInfo | null;
        nowMs: number;
        fn: string;
        date: string;
        kind: string | null;
        skipPoll: boolean;
      },
    ) => {
      const { info, nowMs, fn, date, kind, skipPoll } = opts;
      const computed = computeApiRefreshPhase(phaseArgsFromRow(r, nowMs));
      const phaseDb = String(r.api_refresh_phase ?? '—');
      const pollPh: 'semi_active' | 'active' | null =
        (!kind || kind === 'flight') && computed != null ? pickPollPhase(computed) : null;
      const phaseMeta: AdminFlightPhaseMeta = {
        dbPhase: phaseDb,
        clientPhase: computed,
        pollPhase: pollPh ?? '—',
      };
      setComparisonRows(buildAdminDbApiComparisonRows(r, info, locale, phaseMeta));
      setPctRows(buildAdminPercentageTableRows(r, info, locale));
      setPollEdgeRows(buildAdminPollEdgeSummaryRows(r, nowMs, locale));

      if (skipPoll) {
        setApiRequestTimes(null);
        return;
      }
    },
    [locale],
  );

  const load = useCallback(async (options?: { ignoreCooldown?: boolean }) => {
    if (!flightId) {
      setError(labels.noId);
      setLoading(false);
      return;
    }
    setError(null);
    const { data: row, error: qErr } = await supabase.from('flights').select('*').eq('id', flightId).single();
    if (qErr || !row) {
      setError(qErr?.message ?? labels.loadErr);
      setComparisonRows([]);
      setPctRows([]);
      setPollEdgeRows([]);
      setTraceText('');
      setFr24TraceText('');
      setApiRequestTimes(null);
      setMeta(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const r = row as Record<string, unknown>;
    const fn = String(r.flight_number ?? '')
      .replace(/\s/g, '')
      .trim()
      .toUpperCase();
    const dateRaw = r.flight_date;
    const date =
      typeof dateRaw === 'string'
        ? dateRaw.trim().slice(0, 10)
        : dateRaw instanceof Date && !Number.isNaN(dateRaw.getTime())
          ? dateRaw.toISOString().slice(0, 10)
          : String(dateRaw ?? '')
              .trim()
              .slice(0, 10);
    const kindRaw = r.roster_entry_kind;
    const kind = typeof kindRaw === 'string' && kindRaw.trim().length > 0 ? kindRaw.trim() : null;

    const nowMs = Date.now();
    const computed = computeApiRefreshPhase(phaseArgsFromRow(r, nowMs));
    const pollPh: 'semi_active' | 'active' | null =
      (!kind || kind === 'flight') && computed != null ? pickPollPhase(computed) : null;

    setMeta({ fn, date, kind, pollPhase: pollPh });

    if (kind && kind !== 'flight') {
      applyRowState(r, { info: null, nowMs, fn, date, kind, skipPoll: true });
      setTraceText(
        locale === 'tr'
          ? '(Uçuş segmenti değil — API izi yok)'
          : '(Not a flight segment — no API trace)',
      );
      setFr24TraceText('');
      setApiRequestTimes(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!fn || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      applyRowState(r, { info: null, nowMs, fn, date, kind, skipPoll: true });
      setTraceText(
        locale === 'tr'
          ? `Eksik veya geçersiz uçuş no / tarih (no: "${fn || '—'}", tarih: "${date || '—'}") — sorgu atlandı.`
          : `Missing or invalid flight number / date (fn: "${fn || '—'}", date: "${date || '—'}") — poll skipped.`,
      );
      setFr24TraceText('');
      setApiRequestTimes(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let info: FlightInfo | null = null;
    let trace: FlightPollTraceEntry[] = [];
    try {
      const pack = await pollFlightForRosterWithTrace(fn, date, pollPh ?? 'semi_active', {
        ignoreCooldown: options?.ignoreCooldown === true,
      });
      info = pack.info;
      trace = pack.trace;
    } catch {
      info = null;
      trace = [];
    }
    const mergedPollIso = new Date().toISOString();
    setTraceText(formatPollTraceForAdminDisplay(trace, locale));
    applyRowState(r, { info, nowMs, fn, date, kind, skipPoll: false });

    let fr24DirectIso = mergedPollIso;
    try {
      const fr24 = await fetchFr24LightForAdminDebug(fn, date);
      fr24DirectIso = new Date().toISOString();
      setFr24TraceText(formatPollTraceForAdminDisplay(fr24.trace, locale));
    } catch {
      fr24DirectIso = new Date().toISOString();
      setFr24TraceText(
        locale === 'tr' ? 'FR24 doğrudan sorgu hatası.' : 'FR24 direct query failed.',
      );
    }

    setApiRequestTimes({ mergedPollIso, fr24DirectIso });

    setLoading(false);
    setRefreshing(false);
  }, [applyRowState, flightId, labels, locale]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const onForcePollIgnoreCooldown = useCallback(() => {
    setForcePolling(true);
    setRefreshing(true);
    void load({ ignoreCooldown: true }).finally(() => {
      setForcePolling(false);
      setRefreshing(false);
    });
  }, [load]);

  const openFr24UsagePanel = useCallback(() => {
    void Linking.openURL('https://fr24api.flightradar24.com/usage-metrics?period=30d');
  }, []);

  const triggerFr24UsageSync = useCallback(async () => {
    setFr24Syncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-fr24-usage-metrics', {
        method: 'POST',
      });
      if (error) {
        Alert.alert(labels.fr24SyncFailed, error.message || String(error));
        return;
      }
      if (!data || typeof data !== 'object' || !(data as { ok?: boolean }).ok) {
        Alert.alert(labels.fr24SyncFailed, JSON.stringify(data ?? {}).slice(0, 300));
        return;
      }
      Alert.alert(labels.fr24SyncDone);
    } finally {
      setFr24Syncing(false);
    }
  }, [labels.fr24SyncDone, labels.fr24SyncFailed]);

  if (!flightId) {
    return (
      <View style={styles.center}>
        <Text style={mono.text}>{labels.noId}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {loading && !refreshing ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      ) : null}
      {error ? <Text style={[mono.text, { color: colors.error }]}>{error}</Text> : null}

      {meta ? (
        <Text style={[mono.text, { marginBottom: 10, fontWeight: '700' }]}>
          {meta.fn} · {meta.date}
          {meta.kind && meta.kind !== 'flight' ? ` · ${meta.kind}` : ''}
        </Text>
      ) : null}

      {meta?.pollPhase ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={mono.sectionFirst}>{adminPrioritySectionTitle(locale)}</Text>
          <Text style={[mono.text, { marginBottom: 8, opacity: 0.88 }]} selectable>
            {timetableWaterfallPolicyNote(locale)}
          </Text>
          <View style={tableStyles.card}>
            {getFlightProviderPriorityOrder(meta.pollPhase, locale).map((name, i, arr) => (
              <View
                key={name + String(i)}
                style={[tableStyles.row, i === arr.length - 1 ? tableStyles.rowLast : null]}
              >
                <Text style={[mono.text, { flex: 0.12, fontWeight: '700' }]}>{i + 1}.</Text>
                <Text style={[mono.text, { flex: 0.88 }]} selectable>
                  {name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={openFr24UsagePanel}
        style={{
          marginBottom: 12,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)',
          backgroundColor: isDark ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.12)',
        }}
        accessibilityRole="button"
        accessibilityLabel={labels.fr24LoginButton}
      >
        <Text style={[mono.text, { fontWeight: '700' }]}>{labels.fr24LoginButton}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          void triggerFr24UsageSync();
        }}
        disabled={fr24Syncing}
        style={{
          marginBottom: 12,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)',
          backgroundColor: fr24Syncing
            ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
            : (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(37,99,235,0.12)'),
          opacity: fr24Syncing ? 0.7 : 1,
        }}
        accessibilityRole="button"
        accessibilityLabel={labels.fr24SyncButton}
      >
        <Text style={[mono.text, { fontWeight: '700' }]}>
          {fr24Syncing ? labels.fr24SyncBusy : labels.fr24SyncButton}
        </Text>
      </TouchableOpacity>

      {apiRequestTimes ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={mono.sectionFirst}>{labels.apiReqHeader}</Text>
          <View style={tableStyles.card}>
            <View style={tableStyles.row}>
              <Text style={[mono.text, { flex: 0.38, fontWeight: '600' }]}>{labels.apiReqMerged}</Text>
              <Text style={[mono.text, { flex: 0.62 }]} selectable>
                {formatAdminApiTime(apiRequestTimes.mergedPollIso, locale)}
              </Text>
            </View>
            <View style={[tableStyles.row, tableStyles.rowLast]}>
              <Text style={[mono.text, { flex: 0.38, fontWeight: '600' }]}>{labels.apiReqFr24}</Text>
              <Text style={[mono.text, { flex: 0.62 }]} selectable>
                {formatAdminApiTime(apiRequestTimes.fr24DirectIso, locale)}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {meta?.kind && meta.kind !== 'flight' ? (
        <Text style={[mono.text, { color: colors.error, marginBottom: 10 }]}>{labels.nonFlight}</Text>
      ) : null}

      {!meta?.kind || meta.kind === 'flight' ? (
        <TouchableOpacity
          onPress={onForcePollIgnoreCooldown}
          disabled={forcePolling}
          style={{
            marginBottom: 12,
            borderRadius: 10,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)',
            backgroundColor: forcePolling
              ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
              : (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(37,99,235,0.12)'),
            opacity: forcePolling ? 0.7 : 1,
          }}
          accessibilityRole="button"
          accessibilityLabel={labels.forcePollButton}
        >
          <Text style={[mono.text, { fontWeight: '700' }]}>
            {forcePolling ? labels.forcePollBusy : labels.forcePollButton}
          </Text>
        </TouchableOpacity>
      ) : null}

      {pctRows.length > 0 ? (
        <View style={{ marginBottom: 4 }}>
          <Text style={mono.h}>{labels.pctHeader}</Text>
          <View style={tableStyles.card}>
            <View style={tableStyles.head}>
              <Text style={[mono.text, tableStyles.col34, { fontWeight: '700' }]}>{labels.pctColField}</Text>
              <Text style={[mono.text, tableStyles.col33, { fontWeight: '700' }]}>{labels.pctColValue}</Text>
              <Text style={[mono.text, tableStyles.col32, { fontWeight: '700' }]}>{labels.pctColSource}</Text>
            </View>
            {pctRows.map((row, i) => (
              <View key={i} style={[tableStyles.row, i === pctRows.length - 1 ? tableStyles.rowLast : null]}>
                <Text style={[mono.text, tableStyles.col34]} selectable>
                  {row.label}
                </Text>
                <Text style={[mono.text, tableStyles.col33]} selectable>
                  {row.value}
                </Text>
                <Text style={[mono.text, tableStyles.col32]} selectable>
                  {row.source}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {pollEdgeRows.length > 0 ? (
        <View style={{ marginBottom: 4 }}>
          <Text style={mono.h}>{labels.pollHeader}</Text>
          <View style={tableStyles.card}>
            <View style={tableStyles.head}>
              <Text style={[mono.text, { flex: 0.38, fontWeight: '700' }]}>{labels.pollColLabel}</Text>
              <Text style={[mono.text, { flex: 0.62, fontWeight: '700' }]}>{labels.pollColValue}</Text>
            </View>
            {pollEdgeRows.map((row, i) => (
              <View key={i} style={[tableStyles.row, i === pollEdgeRows.length - 1 ? tableStyles.rowLast : null]}>
                <Text style={[mono.text, { flex: 0.38 }]} selectable>
                  {row.label}
                </Text>
                <Text style={[mono.text, { flex: 0.62 }]} selectable>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {comparisonRows.length > 0 ? (
        <View style={{ marginBottom: 4 }}>
          <Text style={mono.h}>{labels.compareHeader}</Text>
          <View style={tableStyles.card}>
            <View style={tableStyles.head}>
              <Text style={[mono.text, tableStyles.col34, { fontWeight: '700' }]}>{labels.compareColField}</Text>
              <Text style={[mono.text, tableStyles.col33, { fontWeight: '700' }]}>{labels.compareColDb}</Text>
              <Text style={[mono.text, tableStyles.col32, { fontWeight: '700' }]}>{labels.compareColApi}</Text>
            </View>
            {comparisonRows.map((row, i) => (
              <View key={i} style={[tableStyles.row, i === comparisonRows.length - 1 ? tableStyles.rowLast : null]}>
                <Text style={[mono.text, tableStyles.col34]} selectable>
                  {row.label}
                </Text>
                <Text style={[mono.text, tableStyles.col33]} selectable>
                  {row.db}
                </Text>
                <Text style={[mono.text, tableStyles.col32]} selectable>
                  {row.api}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={mono.h}>{labels.trace}</Text>
      <View style={[tableStyles.card, { marginBottom: 14 }]}>
        <Text style={[mono.text, { padding: 10 }]} selectable>
          {traceDisplay}
        </Text>
      </View>

      <Text style={mono.h}>{labels.fr24}</Text>
      <Text style={[mono.text, { marginBottom: 6, opacity: 0.85 }]} selectable>
        {labels.fr24UrlLine} {FR24_FLIGHT_SUMMARY_LIGHT_URL}
      </Text>
      <View style={[tableStyles.card, { marginBottom: 20 }]}>
        <Text style={[mono.text, { padding: 10 }]} selectable>
          {fr24TraceDisplay}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  spinner: { marginVertical: 24 },
});
