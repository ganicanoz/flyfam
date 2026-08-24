import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  KeyboardAvoidingView,
  Platform,
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
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { extractText, isAvailable } from 'expo-pdf-text-extract';
import { useSession } from '@/contexts/SessionContext';
import { formatLocalCalendarWeekdayLong, getLocalDateString } from '@/lib/dateUtils';
import { supabase } from '@/lib/supabase';
import { importPdfFlightsViaRpc, isRosterPdfImportSupportedForCrewAirline } from '@/lib/pdfRosterImport';
import { mergePdfRowsFromTextParse } from '@/lib/pdfRowMerge';
import { parseRosterPdfFromDevice, pdfParseSourceDevLabel } from '@/lib/rosterPdfParse';
import type { PdfFlightRow } from '@/lib/pdfRosterImport';
import { airportLocalHhmmToUtcIso } from '@/lib/flightApi';
import { AIRLINES } from '@/constants/airlines';
import { colors } from '@/theme/colors';
import { triggerAirportBoardCacheRefreshIfDue } from '@/lib/airportBoardCache';
import { alertWithCopy } from '@/lib/alertWithCopy';
import { buildPdfImportReport, showPdfImportAlert } from '@/lib/pdfImportAlert';
import FlightOperationOverlay from '@/components/FlightOperationOverlay';
import TimeRollerField from '@/components/TimeRollerField';

export default function AddFlight() {
  const { t } = useTranslation();
  const { crewProfile } = useSession();
  const [flightNumber, setFlightNumber] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState(() => getLocalDateString());
  const [depTime, setDepTime] = useState('');
  const [arrTime, setArrTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      triggerAirportBoardCacheRefreshIfDue();
    }, []),
  );

  const airline = crewProfile?.airline_icao
    ? AIRLINES.find((a) => a.icao === crewProfile.airline_icao) ?? null
    : null;

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

  function isFullFlightNumber(input: string): boolean {
    const t = input.replace(/\s/g, '').trim();
    return /^[A-Z]{2,3}\d{2,4}$/i.test(t) && t.length >= 5;
  }

  function resolveFlightNumber(airlineIata: string | null, input: string): string | null {
    const trimmed = input.replace(/\s/g, '').trim().toUpperCase();
    if (!trimmed) return null;
    if (/^[A-Z]{2,3}\d{2,4}$/.test(trimmed) && trimmed.length >= 5) return trimmed;
    if (airlineIata && /^\d+$/.test(trimmed) && trimmed.length >= 2) return airlineIata + trimmed;
    if (trimmed.length >= 5) return trimmed;
    return null;
  }

  /** HH:MM: havalimanı varsa yerel→UTC; yoksa Zulu. Cihaz TZ setHours kullanılmaz. */
  const buildDateTime = (dateStr: string, timeStr: string, airportCode?: string) => {
    if (!timeStr) return null;
    const fromAirport = airportLocalHhmmToUtcIso(dateStr, timeStr.trim(), airportCode || null);
    if (fromAirport) return fromAirport;
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  };

  const handleSave = async () => {
    const finalFlightNumber = resolveFlightNumber(airline?.iata ?? null, flightNumber);
    if (!finalFlightNumber) {
      Alert.alert(t('common.error'), t('addFlight.errorFullNumber'));
      return;
    }
    if (!crewProfile?.id) return;

    setLoading(true);
    const { data: flightId, error } = await supabase.rpc('add_me_to_flight', {
      p_flight_number: finalFlightNumber,
      p_flight_date: date,
      p_origin_airport: origin.trim() || null,
      p_destination_airport: destination.trim() || null,
      p_scheduled_departure: buildDateTime(date, depTime, origin.trim()),
      p_scheduled_arrival: buildDateTime(date, arrTime, destination.trim()),
    });

    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    if (!flightId) {
      Alert.alert('Error', 'Crew profile not found');
      return;
    }
    router.back();
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
          { text: t('common.ok'), onPress: () => router.back() },
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
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (!uri) return;
      setLoadingMessage(t('common.flightOpReadingPdf'));
      setLoading(true);
      const { flights, rawText, source, edgeFailureHint } = await parseRosterPdfFromDevice(uri);
      let normalizedFlights = flights;
      let normalizedRawText = rawText ?? null;
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
            'PDF okunamadı veya uçuş yok. Supabase’te `parse-roster-pdf` edge function deploy edin; alternatif olarak geliştirme derlemesi gerekir.',
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

  const rosterPdfImportSupported = isRosterPdfImportSupportedForCrewAirline(crewProfile?.airline_icao);
  const isIndigoCrew = (crewProfile?.airline_icao ?? '').toUpperCase() === 'IGO';

  return (
    <View style={styles.container}>
      <FlightOperationOverlay visible={loading} message={loadingMessage || t('common.loading')} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
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

          <View style={styles.grid2}>
            <View style={[styles.col, styles.colNarrow]}>
              <Text style={[styles.label, styles.labelCompact]}>Flight number</Text>
              <View style={styles.flightNumberRow}>
                {airline && !isFullFlightNumber(flightNumber) && (
                  <View style={styles.flightNumberPrefix}>
                    <Text style={styles.flightNumberPrefixText}>{airline.iata}</Text>
                  </View>
                )}
                <TextInput
                  style={[styles.input, airline && !isFullFlightNumber(flightNumber) && styles.inputWithPrefix]}
                  placeholder=""
                  placeholderTextColor={colors.textMuted}
                  value={flightNumber}
                  onChangeText={setFlightNumber}
                  keyboardType="default"
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <View style={[styles.col, styles.colWide]}>
              <Text style={[styles.label, styles.labelCompact]}>Date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={date}
                onChangeText={setDate}
              />
              {(() => {
                const w = date.length === 10 ? formatLocalCalendarWeekdayLong(date) : null;
                return w ? (
                  <Text style={styles.dateWeekdayHint} numberOfLines={1}>
                    {w}
                  </Text>
                ) : null;
              })()}
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Origin (IATA)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. IST"
                placeholderTextColor={colors.textMuted}
                value={origin}
                onChangeText={setOrigin}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Destination (IATA)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. SAW"
                placeholderTextColor={colors.textMuted}
                value={destination}
                onChangeText={setDestination}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Departure time (optional)</Text>
              <TimeRollerField
                value={depTime}
                onChange={setDepTime}
                allowClear
                placeholder="--:--"
              />
            </View>

            <View style={styles.col}>
              <Text style={[styles.label, styles.labelCompact]}>Arrival time (optional)</Text>
              <TimeRollerField
                value={arrTime}
                onChange={setArrTime}
                allowClear
                placeholder="--:--"
              />
            </View>
          </View>
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Save flight</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 140,
  },
  importPdfBlock: { marginBottom: 20 },
  importButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButtonDisabled: { opacity: 0.4 },
  importButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  importFlightsIndigoHint: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 8,
    marginTop: 16,
  },
  labelCompact: { marginTop: 0 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexBasis: '48%', flexGrow: 1, minWidth: 160 },
  colNarrow: { flexBasis: '40%', minWidth: 130 },
  colWide: { flexBasis: '56%', minWidth: 200 },
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
    flexGrow: 1,
  },
  dateWeekdayHint: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  airlineBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  airlineBoxLabel: { fontSize: 11, marginBottom: 2, color: colors.textSecondary },
  airlineBoxName: { fontSize: 17, fontWeight: '600', color: colors.text },
  airlineBoxIcao: { fontSize: 14, marginTop: 4, color: colors.primary },
  bottomBar: {
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  button: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
