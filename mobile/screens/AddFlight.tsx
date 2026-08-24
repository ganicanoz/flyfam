import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { FlightInfo, fetchFlightByNumber, airportLocalHhmmToUtcIso } from '../lib/flightApi';
import { AIRLINES } from '../constants/airlines';
import {
  formatLocalCalendarWeekdayLong,
  getLocalDateString,
  getLocalDateStringTomorrow,
  formatFlightTimeLocal,
  formatFlightTimeUTC,
} from '../lib/dateUtils';
import { getAirportDisplay } from '../constants/airports';
import { colors, useThemeMode } from '../theme/colors';
import * as DocumentPicker from 'expo-document-picker';
import { cacheDirectory as fsCacheDirectory, copyAsync } from 'expo-file-system/legacy';
import { extractText, isAvailable } from 'expo-pdf-text-extract';
import { importPdfFlightsViaRpc, isRosterPdfImportSupportedForCrewAirline } from '../lib/pdfRosterImport';
import { mergePdfRowsFromTextParse } from '../lib/pdfRowMerge';
import { parseRosterPdfFromDevice, pdfParseSourceDevLabel } from '../lib/rosterPdfParse';
import type { PdfFlightRow } from '../lib/pdfRosterImport';
import { triggerAirportBoardCacheRefreshIfDue } from '../lib/airportBoardCache';
import { alertWithCopy } from '../lib/alertWithCopy';
import { buildPdfImportReport, showPdfImportAlert } from '../lib/pdfImportAlert';
import { notifyFamilyStandbyAssigned } from '../lib/notifyFamily';
import FlightOperationOverlay from '../components/FlightOperationOverlay';
import KeyboardSafeScroll, { scrollInputIntoView } from '../components/KeyboardSafeScroll';

// Date format DD.MM.YYYY for UI; internal/API use YYYY-MM-DD
function toDisplayDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}
function fromDisplayDate(display: string): string {
  const trimmed = display.replace(/\s/g, '').trim();
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    const dd = d!.padStart(2, '0');
    const mm = m!.padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return '';
}

function todayIso(): string {
  return getLocalDateString();
}
function tomorrowIso(): string {
  return getLocalDateStringTomorrow();
}

// Extract numeric part of flight number (e.g. "614" from "614", "PC614", "PGT614")
function numericPart(input: string): string {
  const trimmed = input.replace(/\s/g, '').trim();
  const digits = trimmed.replace(/\D/g, '');
  return digits;
}

/** True if input looks like a full flight code (e.g. PC614, VF1234, TK1823). */
function isFullFlightNumber(input: string): boolean {
  const t = input.replace(/\s/g, '').trim();
  return /^[A-Z]{2,3}\d{2,4}$/i.test(t) && t.length >= 5;
}

/** Resolve to full flight number: full code as-is (VF1234, TK1823), or default airline + digits (614 → PC614). */
function resolveFlightNumber(airlineIata: string | null, input: string): string | null {
  const trimmed = input.replace(/\s/g, '').trim().toUpperCase();
  if (!trimmed) return null;
  if (/^[A-Z]{2,3}\d{2,4}$/.test(trimmed) && trimmed.length >= 5) return trimmed;
  if (airlineIata && /^\d+$/.test(trimmed) && trimmed.length >= 2) return airlineIata + trimmed;
  if (trimmed.length >= 5) return trimmed;
  return null;
}

// Build full IATA flight number from profile airline + number (e.g. PGT + "614" -> "PC614")
function fullFlightNumberIata(airlineIcao: string | null, numberInput: string): string | null {
  const num = numericPart(numberInput);
  if (!num || num.length < 2) return null;
  const airline = AIRLINES.find((a) => a.icao === airlineIcao);
  if (!airline) return null;
  return airline.iata + num;
}

// Return-flight feature temporarily disabled (keep helper removed to avoid unused code).

type FlightRow = {
  id: string;
  flightNumberInput: string;
  dateIso: string;
  dateInput: string;
  flightInfo: FlightInfo | null;
  manualOrigin: string;
  manualDestination: string;
  manualDepTime: string;
  manualArrTime: string;
  fetching: boolean;
  lookupFailed: boolean;
  lastLookupKey: string | null;
};

function createEmptyRow(dateIsoPrefill?: string): FlightRow {
  const iso =
    dateIsoPrefill && /^\d{4}-\d{2}-\d{2}$/.test(dateIsoPrefill) ? dateIsoPrefill : todayIso();
  return {
    id: String(Date.now() + Math.random()),
    flightNumberInput: '',
    dateIso: iso,
    dateInput: toDisplayDate(iso),
    flightInfo: null,
    manualOrigin: '',
    manualDestination: '',
    manualDepTime: '',
    manualArrTime: '',
    fetching: false,
    lookupFailed: false,
    lastLookupKey: null,
  };
}

export default function AddFlight() {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createAddFlightStyles(), [themeMode]);
  const { crewProfile } = useSession();
  const [rows, setRows] = useState<FlightRow[]>([createEmptyRow()]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  // Return-flight flow is temporarily disabled.
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
  const onFieldFocus = (e: { nativeEvent?: { target?: unknown } }) => {
    setTimeout(() => scrollInputIntoView(scrollRef, e, 160), 80);
  };
  const route = useRoute<
    RouteProp<
      {
        params: {
          prefillFlightNumber?: string;
          sharedPdfUri?: string;
          prefillFlightDate?: string;
          replaceStandbyFlightId?: string;
        };
      },
      'params'
    >
  >();
  const sharedImportStartedRef = useRef<string | null>(null);
  const standbyDateAppliedRef = useRef(false);
  const standbyPrefillDate =
    typeof route.params?.prefillFlightDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(route.params.prefillFlightDate)
      ? route.params.prefillFlightDate
      : null;
  const replaceStandbyFlightId =
    typeof route.params?.replaceStandbyFlightId === 'string' &&
    route.params.replaceStandbyFlightId.trim().length > 0
      ? route.params.replaceStandbyFlightId.trim()
      : null;
  const isStandbyAssignMode = Boolean(replaceStandbyFlightId);

  const airline = crewProfile?.airline_icao ? AIRLINES.find((a) => a.icao === crewProfile.airline_icao) : null;

  const pdfReportBase = useCallback(
    () => ({
      crewAirlineIcao: crewProfile?.airline_icao ?? null,
      crewAirlineIata: airline?.iata ?? null,
    }),
    [crewProfile?.airline_icao, airline?.iata],
  );

  const showPdfImportNotSupportedAlert = useCallback(() => {
    const mailto = 'mailto:flyfamapp@gmail.com?subject=FlyFam%20PDF%20Roster%20Talebi';
    const title = t('addFlight.importFlightsAirlineImportNotSupportedTitle');
    const message = t('addFlight.importFlightsAirlineImportNotSupportedMessage');
    alertWithCopy(title, message, {
      copyText: buildPdfImportReport({ title, message, ...pdfReportBase() }),
      extraButtons: [
        { text: t('addFlight.importFlightsAirlineImportNotSupportedCancel'), style: 'cancel' },
        {
          text: t('addFlight.importFlightsAirlineImportNotSupportedSendRoster'),
          onPress: () => {
            void Linking.openURL(mailto);
          },
        },
      ],
    });
  }, [t, pdfReportBase]);
  const hasAnyRow = rows.length > 0;

  useFocusEffect(
    useCallback(() => {
      triggerAirportBoardCacheRefreshIfDue();
    }, []),
  );

  const updateRow = useCallback((id: string, patch: Partial<FlightRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const addRow = () => {
    setRows((prev) => [...prev, createEmptyRow(standbyPrefillDate ?? undefined)]);
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const runRosterImportFromRows = async (flights: PdfFlightRow[], rawText?: string | null) => {
    if (!crewProfile?.id) {
      setLoading(false);
      setLoadingMessage('');
      return;
    }
    setLoadingMessage(t('common.flightOpImportingFlights'));
    setLoading(true);
    try {
      const { ok: added, failed, skippedNonFlights, skippedWrongAirline } = await importPdfFlightsViaRpc(
        supabase,
        flights,
        {
          rawText,
          crewAirlineIcao: crewProfile.airline_icao ?? null,
          crewAirlineIata: airline?.iata ?? null,
        },
      );
      const skipSnippet =
        skippedNonFlights > 0
          ? `\n\n${t('addFlight.importFlightsSkippedNonFlight', { count: skippedNonFlights })}`
          : '';
      const wrongAirlineSnippet =
        skippedWrongAirline > 0
          ? `\n\n${t('addFlight.importFlightsSkippedWrongAirline', { count: skippedWrongAirline })}`
          : '';
      if (added > 0) {
        Alert.alert(t('addFlight.importFlightsSuccessTitle'), t('addFlight.importFlightsSuccess'), [
          {
            text: t('common.ok'),
            onPress: () =>
              navigation.navigate('Main', {
                screen: 'Roster',
                params: { refresh: Date.now(), forceApiRefresh: true },
              }),
          },
        ]);
      } else if (failed.length > 0) {
        const failSnippet =
          failed.length > 0
            ? `\n\n${failed
                .slice(0, 2)
                .map((e) => `${e.flight_number}: ${e.message}`)
                .join('\n')}${failed.length > 2 ? `\n… +${failed.length - 2}` : ''}`
            : '';
        const errTitle = t('common.error');
        const errMsg = `${t('addFlight.importFlightsSomeFailed')}${failSnippet}${skipSnippet}${wrongAirlineSnippet}`;
        showPdfImportAlert(errTitle, errMsg, {
          ...pdfReportBase(),
          rowCount: flights.length,
          failed,
        });
      } else if (skippedWrongAirline === flights.length && flights.length > 0) {
        showPdfImportAlert(
          t('common.info') || 'Bilgi',
          t('addFlight.importFlightsAllSkippedWrongAirline'),
          { ...pdfReportBase(), rowCount: flights.length },
        );
      } else if (skippedNonFlights > 0 && flights.length > 0) {
        showPdfImportAlert(
          t('common.info') || 'Bilgi',
          `${t('addFlight.importFlightsOnlyNonFlights')}${skipSnippet}${wrongAirlineSnippet}`,
          { ...pdfReportBase(), rowCount: flights.length },
        );
      } else if (flights.length > 0) {
        showPdfImportAlert(t('common.error'), `${t('addFlight.importFlightsError')}${wrongAirlineSnippet}`, {
          ...pdfReportBase(),
          rowCount: flights.length,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (__DEV__) console.error('[PDF import RPC]', e);
      const errTitle = t('addFlight.importFlightsError');
      const errMsg = __DEV__
        ? `${t('addFlight.importFlightsErrorHint')}\n\n${msg}`
        : t('addFlight.importFlightsErrorHint');
      showPdfImportAlert(errTitle, errMsg, {
        ...pdfReportBase(),
        extra: { stack: e instanceof Error ? e.stack?.slice(0, 500) : undefined },
      });
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const runPdfImportPipeline = async (pickUri: string) => {
    if (!crewProfile?.id) return;
    if (!crewProfile.airline_icao?.trim()) {
      Alert.alert(t('common.error'), t('addFlight.importFlightsAirlineRequired'));
      return;
    }
    if (!isRosterPdfImportSupportedForCrewAirline(crewProfile.airline_icao)) {
      showPdfImportNotSupportedAlert();
      return;
    }
    let uri = pickUri;
    try {
      if (pickUri.startsWith('content://')) {
        const cacheDir = fsCacheDirectory;
        if (!cacheDir) throw new Error('cacheDirectory unavailable');
        const dest = `${cacheDir}shared-roster-${Date.now()}.pdf`;
        await copyAsync({ from: pickUri, to: dest });
        uri = dest;
      }
      setLoadingMessage(t('common.flightOpReadingPdf'));
      setLoading(true);
      const { flights, rawText, source, edgeFailureHint } = await parseRosterPdfFromDevice(uri);
      let normalizedFlights = flights;
      let normalizedRawText = rawText ?? null;
      // Cihaz PDF çıkarması (simülatörde yok) Edge metninden farklı SIM satırları bulabilir.
      const canDeviceExtract = isAvailable() && (crewProfile.airline_icao ?? '').toUpperCase() !== 'SXS';
      if (canDeviceExtract) {
        try {
          const deviceText = await extractText(uri);
          if (deviceText && deviceText.trim().length > 0) {
            normalizedFlights = mergePdfRowsFromTextParse(normalizedFlights, deviceText);
            if (!normalizedRawText) normalizedRawText = deviceText;
          }
        } catch {
          // best-effort merge only
        }
      }
      if (__DEV__) {
        console.log('[PDF import]', pdfParseSourceDevLabel(source), '→', flights.length, 'satır');
        if (edgeFailureHint) console.warn('[PDF import] Edge hatası:', edgeFailureHint);
      }
      if (!normalizedFlights.length) {
        setLoading(false);
        setLoadingMessage('');
        if (!isAvailable()) {
          showPdfImportAlert(
            t('common.error'),
            'PDF okunamadı veya uçuş yok. Supabase’te `parse-roster-pdf` edge function deploy edin; alternatif olarak geliştirme derlemesi (yerel metin) gerekir.',
            {
              ...pdfReportBase(),
              parseSource: pdfParseSourceDevLabel(source),
              edgeFailureHint,
              rowCount: 0,
            },
          );
        } else {
          const devHint =
            __DEV__
              ? `\n\n[Dev] Kaynak: ${pdfParseSourceDevLabel(source)}${edgeFailureHint ? `\n[Edge] ${edgeFailureHint}` : ''}`
              : '';
          showPdfImportAlert(t('common.info') || 'Bilgi', `${t('addFlight.importFlightsNoFlights')}${devHint}`, {
            ...pdfReportBase(),
            parseSource: pdfParseSourceDevLabel(source),
            edgeFailureHint,
            rowCount: 0,
          });
        }
        return;
      }
      if (source === 'local_extract') {
        setLoading(false);
        setLoadingMessage('');
        showPdfImportAlert(
          t('common.error'),
          'PDF import için güvenli parse alınamadı (Edge auth hatası). Lütfen çıkış-giriş yapıp tekrar deneyin; local_extract ile import engellendi.',
          {
            ...pdfReportBase(),
            parseSource: pdfParseSourceDevLabel(source),
            edgeFailureHint,
            rowCount: normalizedFlights.length,
          },
        );
        return;
      }
      const doRpcImport = async () => {
        if (!crewProfile?.id) {
          setLoading(false);
          setLoadingMessage('');
          return;
        }
        console.log('[AddFlight] PDF import via add_me_to_flight, rows:', normalizedFlights.length);
        await runRosterImportFromRows(normalizedFlights, normalizedRawText);
      };

      if (__DEV__) console.log('[PDF import] normalized pipeline source:', pdfParseSourceDevLabel(source));
      await doRpcImport();
    } catch (e) {
      setLoading(false);
      setLoadingMessage('');
      const msg = e instanceof Error ? e.message : String(e);
      if (__DEV__) console.error('[PDF import]', e);
      showPdfImportAlert(
        t('addFlight.importFlightsError'),
        __DEV__ ? `${t('addFlight.importFlightsErrorHint')}\n\n${msg}` : t('addFlight.importFlightsErrorHint'),
        {
          ...pdfReportBase(),
          extra: { exception: msg },
        },
      );
    }
  };

  const handleImportPdf = async () => {
    if (!crewProfile?.id) return;
    if (!crewProfile.airline_icao?.trim()) {
      showPdfImportAlert(t('common.error'), t('addFlight.importFlightsAirlineRequired'), pdfReportBase());
      return;
    }
    if (!isRosterPdfImportSupportedForCrewAirline(crewProfile.airline_icao)) {
      showPdfImportNotSupportedAlert();
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const uri = result.assets[0]?.uri;
    if (!uri) return;
    await runPdfImportPipeline(uri);
  };

  useEffect(() => {
    const sharedUri = route.params?.sharedPdfUri;
    if (!sharedUri || !crewProfile?.id) return;
    if (sharedImportStartedRef.current === sharedUri) return;
    sharedImportStartedRef.current = sharedUri;
    void runPdfImportPipeline(sharedUri);
    // runPdfImportPipeline her render’da güncel closure; yalnızca dışarıdan gelen URI / crew değişince çalışsın.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [route.params?.sharedPdfUri, crewProfile?.id]);

  const onChangeFlightNumber = (id: string, text: string) => {
    updateRow(id, { flightNumberInput: text });
  };

  const setDateFromInput = (id: string, display: string) => {
    const iso = fromDisplayDate(display);
    if (!iso) {
      updateRow(id, { dateInput: display });
      return;
    }
    updateRow(id, { dateInput: display, dateIso: iso });
  };

  const lookupFlightForRow = useCallback(
    async (row: FlightRow) => {
      const fullNumber = resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput);
      if (!fullNumber || !row.dateIso) return;

      const lookupKey = `${fullNumber}|${row.dateIso}`;
      updateRow(row.id, { fetching: true, lookupFailed: false, lastLookupKey: lookupKey });
      const info = await fetchFlightByNumber(fullNumber, row.dateIso);
      if (info) {
        const toIata = (code: string) => getAirportDisplay(code)?.iata ?? code;
        updateRow(row.id, {
          flightInfo: info,
          manualOrigin: toIata(info.origin),
          manualDestination: toIata(info.destination),
          manualDepTime: info.depTime,
          manualArrTime: info.arrTime,
          fetching: false,
          lookupFailed: false,
          lastLookupKey: lookupKey,
        });
      } else {
        updateRow(row.id, { flightInfo: null, fetching: false, lookupFailed: true, lastLookupKey: lookupKey });
      }
    },
    [airline?.iata, updateRow],
  );

  useEffect(() => {
    const prefill = route.params?.prefillFlightNumber;
    if (prefill && prefill.trim()) {
      setRows((prev) => {
        if (!prev.length) {
          return [{ ...createEmptyRow(standbyPrefillDate ?? undefined), flightNumberInput: prefill.trim() }];
        }
        const [first, ...rest] = prev;
        return [{ ...first, flightNumberInput: prefill.trim() }, ...rest];
      });
    }
  }, [route.params?.prefillFlightNumber, standbyPrefillDate]);

  useEffect(() => {
    if (!standbyPrefillDate || standbyDateAppliedRef.current) return;
    standbyDateAppliedRef.current = true;
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        dateIso: standbyPrefillDate,
        dateInput: toDisplayDate(standbyPrefillDate),
      })),
    );
  }, [standbyPrefillDate]);

  // Auto-lookup: FR24 (tarihli) sonra AirLabs — seçilen güne göre plan saati (yalnız AirLabs tarih almadığı için eskiden boş kalabiliyordu).
  useEffect(() => {
    const timer = setTimeout(() => {
      rows.forEach((row) => {
        const fullNumber = resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput);
        if (!fullNumber || row.dateIso.length !== 10 || row.fetching) return;
        const key = `${fullNumber}|${row.dateIso}`;
        if (row.lastLookupKey === key) return;
        void lookupFlightForRow(row);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [rows, airline?.iata, lookupFlightForRow]);

  /**
   * Planlı kalkış/varış UTC ISO.
   * 1) API `scheduled_*_utc` (zaten UTC) — tercih
   * 2) API yoksa ama FlightInfo var: `depTime`/`arrTime` = UTC HH:MM (parseTime(iso))
   * 3) Saf manuel: havalimanı yerel HH:MM → UTC; havalimanı yoksa Zulu
   */
  const resolveScheduledUtcIso = (
    dateStr: string,
    timeHHmm: string,
    airportCode: string | null | undefined,
    apiUtc: string | null | undefined,
    fromFlightInfo: boolean,
  ): string | null => {
    if (apiUtc && String(apiUtc).trim()) return String(apiUtc).trim();
    if (!timeHHmm || !/^\d{1,2}:\d{2}$/.test(timeHHmm.trim())) return null;
    const hhmm = timeHHmm.trim();
    if (fromFlightInfo) {
      // depTime/arrTime API yolunda UTC HH:MM olarak set edilir — yerel sanma.
      const [h, m] = hhmm.split(':').map(Number);
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
      return d.toISOString();
    }
    const fromAirport = airportLocalHhmmToUtcIso(dateStr, hhmm, airportCode);
    if (fromAirport) return fromAirport;
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  };

  const toIata = (code: string | null | undefined) => (code ? (getAirportDisplay(code)?.iata ?? code) : '');

  const finishAndGoRoster = async (addedFlightDate: string, allFlightDates?: string[]) => {
    const markFlightDates = new Set<string>();
    if (addedFlightDate && /^\d{4}-\d{2}-\d{2}$/.test(addedFlightDate)) {
      markFlightDates.add(addedFlightDate);
    }
    if (standbyPrefillDate && /^\d{4}-\d{2}-\d{2}$/.test(standbyPrefillDate)) {
      markFlightDates.add(standbyPrefillDate);
    }
    for (const d of allFlightDates ?? []) {
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) markFlightDates.add(d);
    }

    if (replaceStandbyFlightId && crewProfile?.id) {
      const { error: rpcErr } = await supabase.rpc('remove_me_from_flight', {
        p_flight_id: replaceStandbyFlightId,
      });
      if (!rpcErr) {
        await supabase.from('flights').delete().eq('id', replaceStandbyFlightId);
      } else {
        await supabase
          .from('flight_crew')
          .delete()
          .eq('flight_id', replaceStandbyFlightId)
          .eq('crew_id', crewProfile.id);
        await supabase.from('flights').delete().eq('id', replaceStandbyFlightId);
      }
      // Aile: nöbetten uçuş verildi (görev tebliği). Hata kaydı bozmasın.
      void notifyFamilyStandbyAssigned(
        crewProfile.id,
        standbyPrefillDate || addedFlightDate,
      );
    }
    navigation.navigate('Main', {
      screen: 'Roster',
      params: {
        refresh: Date.now(),
        forceApiRefresh: true,
        addedFlightDate,
        /** Nöbet → görev: takvimde bu günleri kırmızı (uçuş) tut. */
        markCalendarFlightDates: [...markFlightDates],
      },
    });
  };

  const handleSave = async () => {
    if (!crewProfile?.id) return;
    const validRows = rows.filter((row) => resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput) !== null && row.dateIso.length === 10);
    if (!validRows.length) {
      Alert.alert(t('common.error'), t('addFlight.errorFullNumber'));
      return;
    }
    setLoadingMessage(t('common.flightOpAddingFlights'));
    setLoading(true);
    const endBusy = () => {
      setLoading(false);
      setLoadingMessage('');
    };
    const payloads: Record<string, unknown>[] = validRows.map((row) => {
      const info = row.flightInfo;
      const origin = (info?.origin || row.manualOrigin.trim()) || null;
      const destination = (info?.destination || row.manualDestination.trim()) || null;
      const originIata = origin ? toIata(origin) : null;
      const destinationIata = destination ? toIata(destination) : null;
      const depTime = info?.depTime || row.manualDepTime.trim();
      const arrTime = info?.arrTime || row.manualArrTime.trim();
      const fullNumber = resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput);
      const isDelayed = info?.delayed === true;
      const p: Record<string, unknown> = {
        crew_id: crewProfile.id,
        flight_number: fullNumber,
        origin_airport: originIata || null,
        destination_airport: destinationIata || null,
        origin_city: info?.originCity ?? null,
        destination_city: info?.destinationCity ?? null,
        flight_date: row.dateIso,
        scheduled_departure: resolveScheduledUtcIso(
          row.dateIso,
          depTime,
          originIata,
          info?.scheduled_departure_utc,
          Boolean(info),
        ),
        scheduled_arrival: resolveScheduledUtcIso(
          row.dateIso,
          arrTime,
          destinationIata,
          info?.scheduled_arrival_utc,
          Boolean(info),
        ),
        actual_departure: info?.actual_departure_utc ?? null,
        actual_arrival: info?.actual_arrival_utc ?? null,
        delay_dep_min: info?.delayDepMin != null ? info.delayDepMin : null,
        delay_arr_min: info?.delayArrMin != null ? info.delayArrMin : null,
        is_delayed: isDelayed,
        source: 'manual',
      };
      if (info?.flightStatus != null) p.flight_status = info.flightStatus;
      return p;
    });

    let useLegacyInsert = false;
    let rpcErrorMessage: string | null = null;
    let firstFlightId: string | undefined;
    const firstRow = validRows[0];
    const firstDate = firstRow?.dateIso;
    const allFlightDates = [
      ...new Set(validRows.map((r) => r.dateIso).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))),
    ];
    if (firstRow) {
      const info = firstRow.flightInfo;
      const origin = (info?.origin || firstRow.manualOrigin.trim()) || null;
      const destination = (info?.destination || firstRow.manualDestination.trim()) || null;
      const originIata = origin ? toIata(origin) : null;
      const destinationIata = destination ? toIata(destination) : null;
      const depTime = info?.depTime || firstRow.manualDepTime.trim();
      const arrTime = info?.arrTime || firstRow.manualArrTime.trim();
      const fullNumber = resolveFlightNumber(airline?.iata ?? null, firstRow.flightNumberInput);
      const scheduledDep = resolveScheduledUtcIso(
        firstRow.dateIso,
        depTime,
        originIata,
        info?.scheduled_departure_utc,
        Boolean(info),
      );
      const scheduledArr = resolveScheduledUtcIso(
        firstRow.dateIso,
        arrTime,
        destinationIata,
        info?.scheduled_arrival_utc,
        Boolean(info),
      );
      const { data: fid, error } = await supabase.rpc('add_me_to_flight', {
        p_flight_number: fullNumber,
        p_flight_date: firstRow.dateIso,
        p_origin_airport: originIata || null,
        p_destination_airport: destinationIata || null,
        p_scheduled_departure: scheduledDep,
        p_scheduled_arrival: scheduledArr,
      });
      if (fid != null && fid !== '') firstFlightId = String(fid);
      const msg = error ? String(error.message || '') : '';
      const rpcNotFound =
        msg.includes('Could not find the function') ||
        (msg.includes('add_me_to_flight') && (msg.includes('schema cache') || msg.includes('not find')));
      if (rpcNotFound) {
        useLegacyInsert = true;
      } else if (error) {
        rpcErrorMessage = msg;
      }
    }

    const patchFlightFromInfo = (info: FlightInfo): Record<string, unknown> => {
      const updatePayload: Record<string, unknown> = {};
      if (info.originCity != null) updatePayload.origin_city = info.originCity;
      if (info.destinationCity != null) updatePayload.destination_city = info.destinationCity;
      if (info.actual_departure_utc != null) updatePayload.actual_departure = info.actual_departure_utc;
      if (info.actual_arrival_utc != null) updatePayload.actual_arrival = info.actual_arrival_utc;
      if (info.delayDepMin != null) updatePayload.delay_dep_min = info.delayDepMin;
      if (info.delayArrMin != null) updatePayload.delay_arr_min = info.delayArrMin;
      if (info.flightStatus != null) updatePayload.flight_status = info.flightStatus;
      if (info.delayed === true) updatePayload.is_delayed = true;
      return updatePayload;
    };

    const addExtraRowRpc = async (row: FlightRow): Promise<string | null> => {
      const info = row.flightInfo;
      const origin = (info?.origin || row.manualOrigin.trim()) || null;
      const destination = (info?.destination || row.manualDestination.trim()) || null;
      const originIata = origin ? toIata(origin) : null;
      const destinationIata = destination ? toIata(destination) : null;
      const depTime = info?.depTime || row.manualDepTime.trim();
      const arrTime = info?.arrTime || row.manualArrTime.trim();
      const fullNumber = resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput);
      const scheduledDep = resolveScheduledUtcIso(
        row.dateIso,
        depTime,
        originIata,
        info?.scheduled_departure_utc,
        Boolean(info),
      );
      const scheduledArr = resolveScheduledUtcIso(
        row.dateIso,
        arrTime,
        destinationIata,
        info?.scheduled_arrival_utc,
        Boolean(info),
      );
      const { data: flightId, error } = await supabase.rpc('add_me_to_flight', {
        p_flight_number: fullNumber,
        p_flight_date: row.dateIso,
        p_origin_airport: originIata || null,
        p_destination_airport: destinationIata || null,
        p_scheduled_departure: scheduledDep,
        p_scheduled_arrival: scheduledArr,
      });
      if (error) return String(error.message || '');
      if (
        flightId &&
        info &&
        (info.originCity != null ||
          info.destinationCity != null ||
          info.actual_departure_utc != null ||
          info.actual_arrival_utc != null ||
          info.delayDepMin != null ||
          info.delayArrMin != null ||
          info.flightStatus != null ||
          info.delayed === true)
      ) {
        const updatePayload = patchFlightFromInfo(info);
        if (Object.keys(updatePayload).length > 0) {
          await supabase.from('flights').update(updatePayload).eq('id', flightId as string);
        }
      }
      return null;
    };

    if (!useLegacyInsert && rpcErrorMessage === null && firstRow) {
      const parallel: Promise<unknown>[] = [];
      if (firstFlightId && firstRow.flightInfo) {
        const updatePayload = patchFlightFromInfo(firstRow.flightInfo);
        if (Object.keys(updatePayload).length > 0) {
          parallel.push(supabase.from('flights').update(updatePayload).eq('id', firstFlightId));
        }
      }
      if (validRows.length > 1) {
        parallel.push(
          (async () => {
            const errs = await Promise.all(validRows.slice(1).map((row) => addExtraRowRpc(row)));
            const hit = errs.find(Boolean);
            if (hit) rpcErrorMessage = hit;
          })(),
        );
      }
      if (parallel.length > 0) await Promise.all(parallel);
    }
    const rpcError = rpcErrorMessage;

    if (rpcError !== null) {
      endBusy();
      const isDuplicate =
        rpcError.includes('flights_crew_number_date_unique') ||
        rpcError.includes('duplicate key') ||
        rpcError.includes('unique constraint');
      if (isDuplicate) {
        await finishAndGoRoster(firstDate, allFlightDates);
        return;
      }
      Alert.alert(t('common.error'), rpcError);
      return;
    }

    if (useLegacyInsert) {
      const insertOnce = async (rowsToInsert: Record<string, unknown>[]) =>
        await supabase.from('flights').insert(rowsToInsert).select('id, crew_id, flight_number, flight_date');
      let { error } = await insertOnce(payloads);
      if (
        error &&
        (String(error.message || '').includes("Could not find the 'delay_dep_min' column") ||
          String(error.message || '').includes("Could not find the 'delay_arr_min' column") ||
          String(error.message || '').includes('delay_dep_min') ||
          String(error.message || '').includes('delay_arr_min'))
      ) {
        const stripped = payloads.map(({ delay_dep_min: _a, delay_arr_min: _b, ...rest }) => rest);
        ({ error } = await insertOnce(stripped as Record<string, unknown>[]));
      }
      if (error) {
        endBusy();
        const msg = String(error.message || '');
        const isDuplicate =
          msg.includes('flights_crew_number_date_unique') ||
          msg.includes('duplicate key') ||
          msg.includes('unique constraint');
        if (isDuplicate) {
          await finishAndGoRoster(firstDate, allFlightDates);
          return;
        }
        Alert.alert(t('common.error'), msg);
        return;
      }
    }

    endBusy();
    await finishAndGoRoster(firstDate, allFlightDates);
  };

  const canSave = rows.some((row) => resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput) !== null && row.dateIso.length === 10);
  const rosterPdfImportSupported = isRosterPdfImportSupportedForCrewAirline(crewProfile?.airline_icao);
  const isIndigoCrew = (crewProfile?.airline_icao ?? '').toUpperCase() === 'IGO';
  return (
    <View style={styles.container}>
      <FlightOperationOverlay visible={loading} message={loadingMessage || t('common.loading')} />
      <KeyboardSafeScroll
        scrollRef={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.content}
        bottomOffset={100}
      >
      {isStandbyAssignMode ? (
        <Text style={styles.standbyHint}>{t('addFlight.standbyHint')}</Text>
      ) : (
        <View style={styles.importPdfBlock}>
          <TouchableOpacity
            style={[styles.importButton, !rosterPdfImportSupported && styles.importButtonDisabled]}
            onPress={handleImportPdf}
          >
            <Text style={styles.importButtonText}>{t('addFlight.importFlights')}</Text>
          </TouchableOpacity>
          {isIndigoCrew && rosterPdfImportSupported ? (
            <Text style={styles.importFlightsIndigoHint}>{t('addFlight.importFlightsIndigoHint')}</Text>
          ) : null}
        </View>
      )}

      {hasAnyRow && rows.map((row, index) => {
        const info = row.flightInfo;
        const origin = (info?.origin || row.manualOrigin.trim()) || null;
        const destination = (info?.destination || row.manualDestination.trim()) || null;
        const originIata = origin ? toIata(origin) : null;
        const destinationIata = destination ? toIata(destination) : null;
        const depTime = info?.depTime || row.manualDepTime.trim();
        const arrTime = info?.arrTime || row.manualArrTime.trim();
        const fullNumber = resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput);
        const displayNumber = fullNumber ?? (row.flightNumberInput.trim() || '—');
        const isFetching = row.fetching;

        return (
          <View key={row.id} style={styles.block}>
            {rows.length > 1 && (
              <View style={styles.blockHeader}>
                <View style={styles.blockTitle} />
                <TouchableOpacity
                  style={styles.blockRemove}
                  onPress={() => removeRow(row.id)}
                  accessibilityLabel={t('common.delete')}
                >
                  <Text style={styles.blockRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.flightAndDateBlock}>
              <View style={styles.flightAndDateLabelsRow}>
                <View style={styles.flightCol}>
                  <Text style={[styles.label, styles.labelCompact]}>{t('addFlight.flightNumber')}</Text>
                </View>
                <View style={styles.dateCol}>
                  <Text style={[styles.label, styles.labelCompact]}>{t('addFlight.dateLabel')}</Text>
                </View>
              </View>
              <View style={styles.flightAndDateInputsRow}>
                <View style={styles.flightCol}>
                  <View style={styles.flightNumberRow}>
                    {airline && !isFullFlightNumber(row.flightNumberInput) && (
                      <View style={styles.flightNumberPrefix}>
                        <Text style={styles.flightNumberPrefixText}>{airline.iata}</Text>
                      </View>
                    )}
                    <TextInput
                      style={[styles.input, airline && !isFullFlightNumber(row.flightNumberInput) && styles.inputWithPrefix]}
                      placeholder=""
                      placeholderTextColor={colors.textMuted}
                      value={row.flightNumberInput}
                      onChangeText={(text) => onChangeFlightNumber(row.id, text)}
                      keyboardType="default"
                      autoCapitalize="characters"
                      onFocus={onFieldFocus}
                    />
                  </View>
                </View>
                <View style={styles.dateCol}>
                  <TextInput
                    style={styles.inputDate}
                    placeholder={t('addFlight.datePlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    value={row.dateInput}
                    onChangeText={(text) => setDateFromInput(row.id, text)}
                    keyboardType="numbers-and-punctuation"
                    onFocus={onFieldFocus}
                  />
                  {(() => {
                    const w =
                      row.dateIso.length === 10 ? formatLocalCalendarWeekdayLong(row.dateIso) : null;
                    return w ? (
                      <Text style={styles.dateWeekdayHint} numberOfLines={1}>
                        {w}
                      </Text>
                    ) : null;
                  })()}
                </View>
              </View>
              {fullNumber && (
                <Text style={styles.derived}>{t('addFlight.savedAs', { number: displayNumber })}</Text>
              )}
              <View style={styles.flightAndDateExtraRow}>
                <View style={styles.flightCol}>
                  <View style={styles.lookupRow}>
                    <TouchableOpacity
                      style={[styles.lookupButton, isFetching && styles.lookupButtonDisabled]}
                      onPress={() => lookupFlightForRow(row)}
                      disabled={isFetching}
                    >
                      {isFetching ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={styles.lookupButtonText}>{t('addFlight.lookUpFlight')}</Text>
                      )}
                    </TouchableOpacity>
                    {row.lookupFailed && !isFetching && (
                      <Text style={styles.lookupErrorText}>{t('addFlight.lookupFailedShort')}</Text>
                    )}
                  </View>
                </View>
                <View style={styles.dateCol}>
                  <View style={styles.dateQuickRow}>
                    <TouchableOpacity
                      style={[styles.dateQuickBtn, styles.dateQuickBtnHalf]}
                      onPress={() => {
                        const iso = todayIso();
                        updateRow(row.id, { dateIso: iso, dateInput: toDisplayDate(iso) });
                      }}
                    >
                      <Text style={styles.dateQuickBtnText} numberOfLines={1}>{t('addFlight.today')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.dateQuickBtn, styles.dateQuickBtnHalf]}
                      onPress={() => {
                        const iso = tomorrowIso();
                        updateRow(row.id, { dateIso: iso, dateInput: toDisplayDate(iso) });
                      }}
                    >
                      <Text style={styles.dateQuickBtnText} numberOfLines={1}>{t('addFlight.tomorrow')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>

            {info && !isFetching && (
              <View style={styles.flightCard}>
                <Text style={styles.flightCardTitle}>{t('addFlight.flightDetails')}</Text>
                <Text style={styles.route}>
                  {(originIata || '—')} → {(destinationIata || '—')}
                </Text>
                <Text style={styles.times}>
                  {info.scheduled_departure_utc || info.scheduled_arrival_utc
                    ? `${formatFlightTimeUTC(info.scheduled_departure_utc)}Z – ${formatFlightTimeUTC(info.scheduled_arrival_utc)}Z`
                    : `${depTime || '—'} – ${arrTime || '—'}`}
                  {info.scheduled_departure_utc || info.scheduled_arrival_utc
                    ? `  (${formatFlightTimeLocal(info.scheduled_departure_utc)}–${formatFlightTimeLocal(info.scheduled_arrival_utc)} local)`
                    : ''}
                </Text>
                {info?.airline && (
                  <Text style={styles.airline}>{info.airline}</Text>
                )}
                {info?.aircraftRegistration && (
                  <Text style={styles.aircraft}>{t('addFlight.aircraft', { reg: info.aircraftRegistration })}</Text>
                )}
              </View>
            )}

          </View>
        );
      })}

      <TouchableOpacity style={styles.addRowButton} onPress={addRow}>
        <Text style={styles.addRowButtonText}>+</Text>
        <Text style={styles.addRowButtonText}>{t('addFlight.addAnotherFlight')}</Text>
      </TouchableOpacity>
      </KeyboardSafeScroll>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.button, (loading || !canSave) && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={loading || !canSave}
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>{t('addFlight.saveFlight')}</Text>
            )}
          </TouchableOpacity>
        </View>
    </View>
  );
}

function createAddFlightStyles() {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 140 },
  importPdfBlock: { marginBottom: 20 },
  standbyHint: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  importButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButtonDisabled: { opacity: 0.4 },
  importButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  importFlightsIndigoHint: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  airlineBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  airlineBoxLabel: { fontSize: 11, marginBottom: 2 },
  airlineBoxName: { fontSize: 17, fontWeight: '600' },
  airlineBoxIcao: { fontSize: 14, marginTop: 4 },
  hint: { color: colors.textSecondary, fontSize: 13, marginBottom: 20 },
  label: { color: colors.textSecondary, fontSize: 14, marginBottom: 8, marginTop: 16 },
  labelCompact: { marginTop: 0 },
  derived: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  dateWeekdayHint: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexBasis: '48%', flexGrow: 1, minWidth: 160 },
  colNarrow: { flexBasis: '40%', minWidth: 130 },
  colWide: { flexBasis: '56%', minWidth: 200 },
  flightAndDateBlock: { gap: 0 },
  flightAndDateLabelsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'flex-start',
    gap: 12,
  },
  flightAndDateInputsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    gap: 12,
    marginTop: 4,
  },
  flightAndDateExtraRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  flightCol: { flex: 1, minWidth: 0 },
  dateCol: { flex: 1, minWidth: 0 },
  dateRow: { gap: 8, marginTop: 4 },
  dateQuickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  inputDate: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 120,
    minHeight: 52,
    flexGrow: 1,
  },
  dateQuickBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateQuickBtnHalf: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dateQuickBtnText: { color: colors.primary, fontWeight: '700', fontSize: 11 },
  flightNumberRow: { flexDirection: 'row', alignItems: 'stretch' },
  flightNumberPrefix: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    minWidth: 52,
  },
  flightNumberPrefixText: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  inputWithPrefix: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
    flexGrow: 1,
  },
  fetchingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  fetchingText: { color: colors.primary, fontSize: 14 },
  flightCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  flightCardTitle: { color: colors.textSecondary, fontSize: 12, marginBottom: 8 },
  route: { color: colors.text, fontSize: 18, fontWeight: '700' },
  times: { color: colors.textSecondary, fontSize: 15, marginTop: 4 },
  airline: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  aircraft: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  manualLabel: { color: colors.textSecondary, fontSize: 14, marginTop: 20, marginBottom: 4 },
  apiHint: { color: colors.textMuted, fontSize: 11, marginTop: 12, marginBottom: 4 },
  retryButton: { marginTop: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  retryButtonText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  block: {
    marginTop: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 2,
    borderTopColor: colors.surfaceAlt,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  blockTitle: {
    flex: 1,
  },
  blockRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B71C1C',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  blockRemoveText: { fontSize: 16, fontWeight: '700', color: '#B71C1C', lineHeight: 18 },
  addRowButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  addRowButtonText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  lookupRow: {
    flex: 1,
    justifyContent: 'center',
  },
  lookupButton: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  lookupButtonDisabled: {
    opacity: 0.7,
  },
  lookupButtonText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  lookupErrorText: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  bottomBar: {
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
});
}