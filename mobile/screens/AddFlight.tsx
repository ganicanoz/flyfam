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
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { FlightInfo, fetchFlightByNumber, airportLocalHhmmToUtcIso } from '../lib/flightApi';
import { AIRLINES } from '../constants/airlines';
import {
  formatLocalCalendarWeekdayLong,
  getLocalDateString,
  getLocalDateStringTomorrow,
  flightTimeToUtcHHMM,
} from '../lib/dateUtils';
import { getAirportDisplay, getAirportTimezone } from '../constants/airports';
import { colors, useThemeMode } from '../theme/colors';
import { radius, shadow } from '../theme/tokens';
import * as DocumentPicker from 'expo-document-picker';
import { cacheDirectory as fsCacheDirectory, copyAsync } from 'expo-file-system/legacy';
import { extractText, isAvailable } from 'expo-pdf-text-extract';
import { importPdfFlightsViaRpc, isRosterPdfImportSupportedForCrewAirline } from '../lib/pdfRosterImport';
import { mergePdfRowsFromTextParse } from '../lib/pdfRowMerge';
import { parseRosterPdfFromDevice, pdfParseSourceDevLabel } from '../lib/rosterPdfParse';
import type { PdfFlightRow } from '../lib/pdfRosterImport';
import { maybePromptHomeBaseAfterRosterImport } from '../lib/homeBaseFromRoster';
import { triggerAirportBoardCacheRefreshIfDue } from '../lib/airportBoardCache';
import { alertWithCopy } from '../lib/alertWithCopy';
import { buildPdfImportReport, showPdfImportAlert } from '../lib/pdfImportAlert';
import { notifyFamilyStandbyAssigned } from '../lib/notifyFamily';
import FlightOperationOverlay from '../components/FlightOperationOverlay';
import KeyboardSafeScroll, { scrollInputIntoView } from '../components/KeyboardSafeScroll';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { FormCard } from '../components/FormCard';
import { PrimaryButton } from '../components/PrimaryButton';
import TimeRollerField from '../components/TimeRollerField';
import DateRollerField from '../components/DateRollerField';

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

function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** UTC ISO → havalimanı yerel HH:MM (TimeRoller / önizleme). */
function utcToAirportLocalHHmm(isoUtc: string | null | undefined, airportCode: string): string | null {
  if (!isoUtc) return null;
  const tz = getAirportTimezone(airportCode);
  if (!tz) return null;
  const d = new Date(isoUtc);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(d);
    const h = parts.find((p) => p.type === 'hour')?.value;
    const m = parts.find((p) => p.type === 'minute')?.value;
    if (h == null || m == null) return null;
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function flightDurationLabel(
  info: FlightInfo | null,
  depLocal: string,
  arrLocal: string,
  dateIso: string,
  origin: string | null,
  destination: string | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const depIso =
    airportLocalHhmmToUtcIso(dateIso, depLocal, origin) ||
    info?.scheduled_departure_utc ||
    null;
  const arrIso =
    airportLocalHhmmToUtcIso(dateIso, arrLocal, destination) ||
    info?.scheduled_arrival_utc ||
    null;
  if (depIso && arrIso) {
    const ms = Date.parse(arrIso) - Date.parse(depIso);
    if (Number.isFinite(ms) && ms > 0) {
      const mins = Math.round(ms / 60000);
      const hours = Math.floor(mins / 60);
      const rem = mins % 60;
      if (hours > 0) return t('roster.durationShort', { hours, mins: rem });
      return t('roster.durationMinsOnly', { mins: rem });
    }
  }
  const dep = hhmmToMinutes(depLocal || info?.depTime);
  const arr = hhmmToMinutes(arrLocal || info?.arrTime);
  if (dep == null || arr == null) return null;
  let mins = arr - dep;
  if (mins < 0) mins += 24 * 60;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours > 0) return t('roster.durationShort', { hours, mins: rem });
  return t('roster.durationMinsOnly', { mins: rem });
}

function formatLocalAndZuluLine(localHHmm: string, zuluHHmm: string | null): string {
  if (localHHmm && zuluHHmm) return `${localHHmm} · (Z) ${zuluHHmm}`;
  if (localHHmm) return localHHmm;
  if (zuluHHmm) return `(Z) ${zuluHHmm}`;
  return '—';
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
  const { crewProfile, refreshProfile } = useSession();
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
          openImportPicker?: boolean;
          prefillFlightDate?: string;
          replaceStandbyFlightId?: string;
        };
      },
      'params'
    >
  >();
  const insets = useSafeAreaInsets();
  const sharedImportStartedRef = useRef<string | null>(null);
  const openImportStartedRef = useRef(false);
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

  /** Move a queued preview row to the end so it becomes the editable form. */
  const activateRow = (id: string) => {
    setRows((prev) => {
      const row = prev.find((r) => r.id === id);
      if (!row) return prev;
      return [...prev.filter((r) => r.id !== id), row];
    });
  };

  const runRosterImportFromRows = async (
    flights: PdfFlightRow[],
    rawText?: string | null,
  ) => {
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
        if (crewProfile.id && crewProfile.user_id) {
          await maybePromptHomeBaseAfterRosterImport({
            userId: crewProfile.user_id,
            crewProfileId: crewProfile.id,
            currentHomeBaseIata: crewProfile.home_base_iata,
            importedRows: flights,
            supabase,
            refreshProfile,
            copy: {
              title: t('addFlight.homeBaseChangeTitle'),
              message: (iata, city) =>
                city
                  ? t('addFlight.homeBaseChangeMessageCity', { iata, city })
                  : t('addFlight.homeBaseChangeMessage', { iata }),
              yes: t('addFlight.homeBaseChangeYes'),
              no: t('addFlight.homeBaseChangeNo'),
            },
          });
        }
        Alert.alert(t('addFlight.importFlightsSuccessTitle'), t('addFlight.importFlightsSuccess'), [
          {
            text: t('common.ok'),
            onPress: () =>
              navigation.navigate('Main', {
                screen: 'Roster',
                params: {
                  refresh: Date.now(),
                  forceApiRefresh: true,
                },
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
      const { flights, rawText, source, edgeFailureHint } = await parseRosterPdfFromDevice(uri, {
        crewAirlineIcao: crewProfile.airline_icao,
      });
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

      // Doğrudan ekle — mükerrer uçuşlar add_me_to_flight ile tek kayıt kalır; sil/birleştir sheet yok.
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

  useEffect(() => {
    if (!route.params?.openImportPicker || !crewProfile?.id) return;
    if (openImportStartedRef.current) return;
    openImportStartedRef.current = true;
    void handleImportPdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot import from roster sheet
  }, [route.params?.openImportPicker, crewProfile?.id]);

  const onChangeFlightNumber = (id: string, text: string) => {
    let next = text.toUpperCase().replace(/\s/g, '');
    const iata = airline?.iata?.toUpperCase();
    // Kullanıcı PC1922 yazarsa profil kodunu soy, sadece numara kalsın.
    if (iata && next.startsWith(iata) && /^\d/.test(next.slice(iata.length))) {
      next = next.slice(iata.length);
    }
    updateRow(id, { flightNumberInput: next });
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
        const originIata = toIata(info.origin);
        const destIata = toIata(info.destination);
        // Önizleme / düzenleme: havalimanı yerel saati. Kayıtta yerel→UTC.
        const depLocal =
          utcToAirportLocalHHmm(info.scheduled_departure_utc, originIata) ||
          (info.depTime ? utcToAirportLocalHHmm(`${row.dateIso}T${info.depTime}:00.000Z`, originIata) : null) ||
          info.depTime ||
          '';
        const arrLocal =
          utcToAirportLocalHHmm(info.scheduled_arrival_utc, destIata) ||
          (info.arrTime ? utcToAirportLocalHHmm(`${row.dateIso}T${info.arrTime}:00.000Z`, destIata) : null) ||
          info.arrTime ||
          '';
        updateRow(row.id, {
          flightInfo: info,
          manualOrigin: originIata,
          manualDestination: destIata,
          manualDepTime: depLocal,
          manualArrTime: arrLocal,
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
   * manuelDep/ArrTime = havalimanı yerel HH:MM (önizlemede düzenlenir).
   * API scheduled_*_utc yalnızca yerel saat boşsa yedek.
   */
  const resolveScheduledUtcIso = (
    dateStr: string,
    timeHHmm: string,
    airportCode: string | null | undefined,
    apiUtc: string | null | undefined,
  ): string | null => {
    if (timeHHmm && /^\d{1,2}:\d{2}$/.test(timeHHmm.trim())) {
      const fromAirport = airportLocalHhmmToUtcIso(dateStr, timeHHmm.trim(), airportCode);
      if (fromAirport) return fromAirport;
      // Havalimanı tz yoksa (Z) kabul et
      const [h, m] = timeHHmm.trim().split(':').map(Number);
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
      return d.toISOString();
    }
    if (apiUtc && String(apiUtc).trim()) return String(apiUtc).trim();
    return null;
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
      const depTime = row.manualDepTime.trim();
      const arrTime = row.manualArrTime.trim();
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
        ),
        scheduled_arrival: resolveScheduledUtcIso(
          row.dateIso,
          arrTime,
          destinationIata,
          info?.scheduled_arrival_utc,
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
      const depTime = firstRow.manualDepTime.trim();
      const arrTime = firstRow.manualArrTime.trim();
      const fullNumber = resolveFlightNumber(airline?.iata ?? null, firstRow.flightNumberInput);
      const scheduledDep = resolveScheduledUtcIso(
        firstRow.dateIso,
        depTime,
        originIata,
        info?.scheduled_departure_utc,
      );
      const scheduledArr = resolveScheduledUtcIso(
        firstRow.dateIso,
        arrTime,
        destinationIata,
        info?.scheduled_arrival_utc,
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
      const depTime = row.manualDepTime.trim();
      const arrTime = row.manualArrTime.trim();
      const fullNumber = resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput);
      const scheduledDep = resolveScheduledUtcIso(
        row.dateIso,
        depTime,
        originIata,
        info?.scheduled_departure_utc,
      );
      const scheduledArr = resolveScheduledUtcIso(
        row.dateIso,
        arrTime,
        destinationIata,
        info?.scheduled_arrival_utc,
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
  const saveCount = rows.filter(
    (row) => resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput) !== null && row.dateIso.length === 10,
  ).length;
  const hasFetchedFlight = rows.some((row) => !!row.flightInfo);
  const pageTitle = isStandbyAssignMode ? t('roster.assignFlightsTitle') : t('nav.addFlight');
  const fieldFill = themeMode === 'dark' ? '#1A2740' : '#F0F1F5';
  const footerPad = Math.max(insets.bottom, 10);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlightOperationOverlay visible={loading} message={loadingMessage || t('common.loading')} />
      <ScreenPageHeader title={pageTitle} />
      <KeyboardSafeScroll
        scrollRef={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 120 + footerPad }]}
        bottomOffset={100}
      >
        {isStandbyAssignMode ? (
          <Text style={styles.standbyHint}>{t('addFlight.standbyHint')}</Text>
        ) : null}

        {hasAnyRow &&
          rows.map((row, index) => {
            const info = row.flightInfo;
            const origin = (info?.origin || row.manualOrigin.trim()) || null;
            const destination = (info?.destination || row.manualDestination.trim()) || null;
            const originIata = origin ? toIata(origin) : null;
            const destinationIata = destination ? toIata(destination) : null;
            const depLocal = row.manualDepTime.trim();
            const arrLocal = row.manualArrTime.trim();
            const depUtcIso = resolveScheduledUtcIso(
              row.dateIso,
              depLocal,
              originIata,
              info?.scheduled_departure_utc,
            );
            const arrUtcIso = resolveScheduledUtcIso(
              row.dateIso,
              arrLocal,
              destinationIata,
              info?.scheduled_arrival_utc,
            );
            const depZulu = flightTimeToUtcHHMM(depUtcIso);
            const arrZulu = flightTimeToUtcHHMM(arrUtcIso);
            const fullNumber = resolveFlightNumber(airline?.iata ?? null, row.flightNumberInput);
            const displayNumber = fullNumber ?? (row.flightNumberInput.trim() || '—');
            const isFetching = row.fetching;
            const canLookup = !!fullNumber && row.dateIso.length === 10;
            const isTodaySelected = row.dateIso === todayIso();
            const isTomorrowSelected = row.dateIso === tomorrowIso();
            const weekday = row.dateIso.length === 10 ? formatLocalCalendarWeekdayLong(row.dateIso) : null;
            const dateDisplay = row.dateIso
              ? weekday
                ? `${toDisplayDate(row.dateIso)} · ${weekday}`
                : toDisplayDate(row.dateIso)
              : t('addFlight.datePlaceholder');
            const isCompact = !!info && !isFetching && index < rows.length - 1;
            const durationText = flightDurationLabel(
              info,
              depLocal,
              arrLocal,
              row.dateIso,
              originIata,
              destinationIata,
              t,
            );
            const timeSummary =
              depLocal || arrLocal || depZulu || arrZulu
                ? `${formatLocalAndZuluLine(depLocal, depZulu)} → ${formatLocalAndZuluLine(arrLocal, arrZulu)}`
                : null;

            if (isCompact) {
              return (
                <View key={row.id} style={[styles.previewCard, shadow.card]}>
                  <View style={styles.previewBody}>
                    <Text style={styles.previewLine} numberOfLines={2}>
                      <Text style={styles.previewNumber}>{displayNumber}</Text>
                      <Text style={styles.previewSep}> · </Text>
                      <Text style={styles.previewRoute}>
                        {originIata || '—'} → {destinationIata || '—'}
                      </Text>
                    </Text>
                    {timeSummary ? (
                      <Text style={styles.previewMeta} numberOfLines={2}>
                        {timeSummary}
                      </Text>
                    ) : null}
                    {durationText ? <Text style={styles.previewDate}>{durationText}</Text> : null}
                    <Text style={styles.previewDate}>{toDisplayDate(row.dateIso)}</Text>
                  </View>
                  <View style={styles.previewActions}>
                    <TouchableOpacity
                      style={styles.previewIconBtn}
                      onPress={() => activateRow(row.id)}
                      accessibilityLabel={t('common.edit')}
                    >
                      <Ionicons name="create-outline" size={18} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.previewIconBtn}
                      onPress={() => removeRow(row.id)}
                      accessibilityLabel={t('common.delete')}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            return (
              <View key={row.id} style={styles.formBlock}>
                {rows.length > 1 ? (
                  <View style={styles.blockHeader}>
                    <Text style={styles.blockHeaderLabel}>
                      {t('addFlight.flightNumber')} {index + 1}
                    </Text>
                    <TouchableOpacity
                      style={styles.blockRemove}
                      onPress={() => removeRow(row.id)}
                      accessibilityLabel={t('common.delete')}
                    >
                      <Ionicons name="close" size={16} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ) : null}

                <FormCard>
                  <View style={styles.cardPad}>
                    <View style={styles.twoColRow}>
                      <View style={styles.col}>
                        <Text style={styles.fieldLabel}>
                          {airline?.iata ? t('addFlight.flightNumberDigits') : t('addFlight.flightNumber')}
                        </Text>
                        {airline?.iata ? (
                          <View style={[styles.flightNumberRow, { backgroundColor: fieldFill }]}>
                            <View style={styles.airlinePrefixBadge}>
                              <Text style={styles.airlinePrefixText}>{airline.iata}</Text>
                            </View>
                            <TextInput
                              style={styles.flightNumberInput}
                              placeholder={t('addFlight.placeholderNumber')}
                              placeholderTextColor={colors.textMuted}
                              value={row.flightNumberInput}
                              onChangeText={(text) => onChangeFlightNumber(row.id, text)}
                              keyboardType="number-pad"
                              autoCapitalize="characters"
                              autoCorrect={false}
                              onFocus={onFieldFocus}
                            />
                          </View>
                        ) : (
                          <TextInput
                            style={[styles.fieldInput, { backgroundColor: fieldFill }]}
                            placeholder={t('addFlight.placeholderFull')}
                            placeholderTextColor={colors.textMuted}
                            value={row.flightNumberInput}
                            onChangeText={(text) => onChangeFlightNumber(row.id, text)}
                            keyboardType="default"
                            autoCapitalize="characters"
                            autoCorrect={false}
                            onFocus={onFieldFocus}
                          />
                        )}
                        {airline?.iata ? (
                          <Text style={styles.airlinePrefixHint} numberOfLines={2}>
                            {t('addFlight.airlinePrefixHint', {
                              code: airline.iata,
                              airline: airline.name,
                            })}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.col}>
                        <Text style={styles.fieldLabel}>{t('addFlight.dateLabel')}</Text>
                        <DateRollerField
                          value={row.dateIso}
                          onChange={(iso) =>
                            updateRow(row.id, { dateIso: iso, dateInput: toDisplayDate(iso) })
                          }
                          displayLabel={dateDisplay}
                          placeholder={t('addFlight.dateLabel')}
                          accessibilityLabel={t('addFlight.dateLabel')}
                        />
                      </View>
                    </View>

                    {fullNumber ? (
                      <Text style={styles.derived}>{t('addFlight.savedAs', { number: displayNumber })}</Text>
                    ) : airline?.iata ? (
                      <Text style={styles.derived}>{t('addFlight.enterDigitsOnly')}</Text>
                    ) : null}

                    <View style={styles.dateQuickRow}>
                      <TouchableOpacity
                        style={[
                          styles.dateQuickBtn,
                          { backgroundColor: fieldFill },
                          isTodaySelected && styles.dateQuickBtnSelected,
                        ]}
                        onPress={() => {
                          const iso = todayIso();
                          updateRow(row.id, { dateIso: iso, dateInput: toDisplayDate(iso) });
                        }}
                      >
                        <Text
                          style={[
                            styles.dateQuickBtnText,
                            isTodaySelected && styles.dateQuickBtnTextSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {isTodaySelected ? `✓ ${t('addFlight.today')}` : t('addFlight.today')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.dateQuickBtn,
                          { backgroundColor: fieldFill },
                          isTomorrowSelected && styles.dateQuickBtnSelected,
                        ]}
                        onPress={() => {
                          const iso = tomorrowIso();
                          updateRow(row.id, { dateIso: iso, dateInput: toDisplayDate(iso) });
                        }}
                      >
                        <Text
                          style={[
                            styles.dateQuickBtnText,
                            isTomorrowSelected && styles.dateQuickBtnTextSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {isTomorrowSelected ? `✓ ${t('addFlight.tomorrow')}` : t('addFlight.tomorrow')}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      style={[styles.lookupButton, (!canLookup || isFetching) && styles.lookupButtonDisabled]}
                      onPress={() => lookupFlightForRow(row)}
                      disabled={!canLookup || isFetching}
                    >
                      {isFetching ? (
                        <ActivityIndicator size="small" color={colors.onPrimary} />
                      ) : (
                        <Text style={styles.lookupButtonText}>{t('addFlight.lookUpFlight')}</Text>
                      )}
                    </TouchableOpacity>
                    {row.lookupFailed && !isFetching ? (
                      <Text style={styles.lookupErrorText}>{t('addFlight.lookupFailedShort')}</Text>
                    ) : null}
                  </View>
                </FormCard>

                {info && !isFetching ? (
                  <View style={[styles.previewEditCard, shadow.card]}>
                    <View style={styles.previewEditHeader}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.previewLine} numberOfLines={2}>
                          <Text style={styles.previewNumber}>{displayNumber}</Text>
                          <Text style={styles.previewSep}> · </Text>
                          <Text style={styles.previewRoute}>
                            {originIata || '—'} → {destinationIata || '—'}
                          </Text>
                        </Text>
                        {durationText ? (
                          <Text style={styles.previewDate}>{durationText}</Text>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        style={styles.previewIconBtn}
                        onPress={() => removeRow(row.id)}
                        accessibilityLabel={t('common.delete')}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.twoColRow}>
                      <View style={styles.col}>
                        <Text style={styles.fieldLabel}>
                          {t('addFlight.previewDepLocal')}
                          {originIata ? ` · ${originIata}` : ''}
                        </Text>
                        <TimeRollerField
                          value={depLocal}
                          onChange={(next) => updateRow(row.id, { manualDepTime: next })}
                          allowClear
                          placeholder="--:--"
                          subtitle={depZulu ? `(Z) ${depZulu}` : null}
                          onOpen={() => onFieldFocus({})}
                        />
                      </View>
                      <View style={styles.col}>
                        <Text style={styles.fieldLabel}>
                          {t('addFlight.previewArrLocal')}
                          {destinationIata ? ` · ${destinationIata}` : ''}
                        </Text>
                        <TimeRollerField
                          value={arrLocal}
                          onChange={(next) => updateRow(row.id, { manualArrTime: next })}
                          allowClear
                          placeholder="--:--"
                          subtitle={arrZulu ? `(Z) ${arrZulu}` : null}
                          onOpen={() => onFieldFocus({})}
                        />
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}

        {hasFetchedFlight ? (
          <TouchableOpacity style={styles.addRowDashed} onPress={addRow} activeOpacity={0.75}>
            <Text style={styles.addRowDashedText}>+ {t('addFlight.addAnotherFlight')}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.emptyHint}>{t('addFlight.formEmptyHint')}</Text>
        )}
      </KeyboardSafeScroll>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={[styles.bottomBar, { paddingBottom: footerPad, backgroundColor: colors.background }]}>
          <PrimaryButton
            title={
              saveCount > 1
                ? t('addFlight.saveFlightsCount', { count: saveCount })
                : t('addFlight.saveFlight')
            }
            onPress={handleSave}
            loading={loading}
            disabled={!canSave}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function createAddFlightStyles() {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 4 },
    standbyHint: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 12,
    },
    formBlock: { marginBottom: 4 },
    blockHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
      paddingHorizontal: 2,
    },
    blockHeaderLabel: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
    blockRemove: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    cardPad: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
    twoColRow: { flexDirection: 'row', gap: 10 },
    col: { flex: 1, minWidth: 0 },
    fieldLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 6,
    },
    fieldInput: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      minHeight: 48,
      borderWidth: 0,
    },
    flightNumberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 12,
      minHeight: 48,
      overflow: 'hidden',
    },
    airlinePrefixBadge: {
      paddingHorizontal: 12,
      alignSelf: 'stretch',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      minWidth: 48,
    },
    airlinePrefixText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    flightNumberInput: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      minHeight: 48,
    },
    airlinePrefixHint: {
      marginTop: 6,
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '500',
      lineHeight: 15,
    },
    dateTrigger: { justifyContent: 'center' },
    dateTriggerText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    dateTriggerPlaceholder: { color: colors.textMuted, fontWeight: '500' },
    dateDone: { alignSelf: 'flex-end', paddingVertical: 6 },
    dateDoneText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
    derived: { color: colors.textMuted, fontSize: 12, marginTop: -2 },
    dateQuickRow: { flexDirection: 'row', gap: 8 },
    dateQuickBtn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateQuickBtnSelected: {
      backgroundColor: colors.primary,
    },
    dateQuickBtnText: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
    dateQuickBtnTextSelected: { color: colors.onPrimary },
    lookupButton: {
      marginTop: 2,
      paddingVertical: 13,
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    lookupButtonDisabled: { opacity: 0.4 },
    lookupButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
    lookupErrorText: { color: colors.textMuted, fontSize: 12 },
    previewCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 10,
      minHeight: 64,
    },
    previewEditCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginBottom: 10,
      gap: 10,
    },
    previewEditHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 4,
    },
    previewBody: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, minWidth: 0 },
    previewLine: { color: colors.text },
    previewNumber: { fontWeight: '800', fontSize: 15, color: colors.text },
    previewRoute: { fontWeight: '700', fontSize: 14, color: colors.text },
    previewMeta: { fontWeight: '600', fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    previewSep: { color: colors.textMuted, fontWeight: '600' },
    previewDate: { marginTop: 4, color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    previewActions: { flexDirection: 'row', alignItems: 'center', paddingRight: 8, gap: 2 },
    previewIconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addRowDashed: {
      marginTop: 4,
      marginBottom: 8,
      paddingVertical: 14,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    addRowDashedText: {
      color: colors.textMuted,
      fontWeight: '600',
      fontSize: 14,
    },
    emptyHint: {
      marginTop: 28,
      textAlign: 'center',
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: 20,
    },
    bottomBar: {
      paddingHorizontal: 16,
      paddingTop: 10,
    },
  });
}