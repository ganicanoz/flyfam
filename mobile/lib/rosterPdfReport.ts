/**
 * Roster PDF import sonrası: şüpheli satır / PDF'te olmayan uçuş uyarıları, başarısız import kaydı ve
 * kullanıcı onayıyla PDF'in Edge `roster-pdf-report` üzerinden private bucket'a gönderilmesi.
 */
import { Alert, Platform, type AlertButton } from 'react-native';
import Constants from 'expo-constants';
import { readAsStringAsync } from 'expo-file-system/legacy';
import i18n from './i18n';
import { formatAirportCity } from '../constants/airports';
import { supabase } from './supabase';
import { trackActivityEvent } from './userActivity';
import type { PdfImportRpcResult, RosterStaleFlight, RosterSuspectLeg } from './pdfRosterImport';

export type RosterPdfReportReason = 'suspect' | 'failed' | 'manual';

export type RosterPdfReportContext = {
  crewAirlineIcao?: string | null;
  parseSource?: string | null;
  rowCount?: number;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function appVersion(): string {
  const version = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '?';
  const build = Constants.nativeBuildVersion ?? '?';
  return `${version} (${build})`;
}

function alertAsync(title: string, message: string, buttons: Array<AlertButton & { value: string }>): Promise<string> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      buttons.map(({ value, ...b }) => ({ ...b, onPress: () => resolve(value) })),
      { cancelable: true, onDismiss: () => resolve('dismiss') },
    );
  });
}

function listLines<T>(items: T[], line: (x: T) => string, max: number): string {
  const lines = items.slice(0, max).map(line);
  if (items.length > max) lines.push(t('addFlight.importListMore', { n: items.length - max }));
  return lines.join('\n');
}

function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return d && m ? `${d}.${m}` : ymd;
}

/** Başarısız / bilgi popup'larında sessiz kayıt (admin görünürlüğü). Kişisel veri içermez. */
export function trackRosterImportIssue(title: string, ctx: RosterPdfReportContext & { failedCount?: number; edgeFailureHint?: string | null }): void {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) return;
      await trackActivityEvent(uid, 'roster_import_issue', {
        title: title.slice(0, 80),
        airline_icao: ctx.crewAirlineIcao ?? null,
        parse_source: ctx.parseSource ?? null,
        row_count: ctx.rowCount ?? null,
        failed: ctx.failedCount ?? null,
        edge_hint: ctx.edgeFailureHint ? String(ctx.edgeFailureHint).slice(0, 160) : null,
      });
    } catch {
      // ignore
    }
  })();
}

export async function sendRosterPdfReport(
  uri: string,
  reason: RosterPdfReportReason,
  ctx: RosterPdfReportContext,
): Promise<'ok' | 'rate_limited' | 'error'> {
  try {
    const pdfBase64 = await readAsStringAsync(uri, { encoding: 'base64' });
    if (!pdfBase64 || pdfBase64.length < 100) return 'error';
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('roster-pdf-report', {
      body: {
        pdf_base64: pdfBase64,
        reason,
        airline_icao: ctx.crewAirlineIcao ?? null,
        parse_source: ctx.parseSource ?? null,
        app_version: appVersion(),
        platform: Platform.OS,
        meta: { row_count: ctx.rowCount ?? null, ...(ctx.meta ?? {}) },
      },
    });
    if (data?.ok) return 'ok';
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    if (status === 429 || data?.error === 'rate_limited') return 'rate_limited';
    return 'error';
  } catch {
    return 'error';
  }
}

/** Açık onay → gönder → sonuç popup'ı. */
export async function offerRosterPdfReport(
  uri: string,
  reason: RosterPdfReportReason,
  ctx: RosterPdfReportContext,
): Promise<void> {
  const choice = await alertAsync(t('addFlight.pdfReportConsentTitle'), t('addFlight.pdfReportConsentMessage'), [
    { text: t('common.cancel'), style: 'cancel', value: 'cancel' },
    { text: t('addFlight.pdfReportConsentYes'), value: 'send' },
  ]);
  if (choice !== 'send') return;
  const res = await sendRosterPdfReport(uri, reason, ctx);
  const msg =
    res === 'ok'
      ? t('addFlight.pdfReportSent')
      : res === 'rate_limited'
        ? t('addFlight.pdfReportRateLimited')
        : t('addFlight.pdfReportFailed');
  await alertAsync('', msg, [{ text: t('common.ok'), value: 'ok' }]);
}

function suspectReason(r: RosterSuspectLeg['reason']): string {
  if (r === 'overlap') return t('addFlight.importSuspectReasonOverlap');
  if (r === 'route_gap') return t('addFlight.importSuspectReasonRouteGap');
  return t('addFlight.importSuspectReasonDuration');
}

function staleLine(f: RosterStaleFlight): string {
  const route =
    f.origin_airport && f.destination_airport
      ? ` ${formatAirportCity(f.origin_airport)}→${formatAirportCity(f.destination_airport)}`
      : '';
  return `${shortDate(f.flight_date)} ${f.flight_number}${route}`;
}

/**
 * Başarılı import sonrası sırayla: başarı mesajı → şüpheli satırlar (PDF gönderme teklifi) →
 * PDF'te olmayan eski uçuşları kaldırma onayı. Kaldırma yapılırsa `onFlightsChanged` çağrılır.
 */
export async function runPdfImportFollowUps(args: {
  result: Pick<PdfImportRpcResult, 'suspectLegs' | 'staleFlights'>;
  pdfUri: string | null;
  successTitle: string;
  successMessage: string;
  report: RosterPdfReportContext;
  onFlightsChanged?: () => Promise<void> | void;
}): Promise<void> {
  const { result, pdfUri, report } = args;
  await alertAsync(args.successTitle, args.successMessage, [{ text: t('common.ok'), value: 'ok' }]);

  if (result.suspectLegs.length) {
    const list = listLines(
      result.suspectLegs,
      (s) => `${shortDate(s.flight_date)} ${s.flight_number}: ${suspectReason(s.reason)}`,
      5,
    );
    const buttons: Array<AlertButton & { value: string }> = [{ text: t('common.ok'), value: 'ok' }];
    if (pdfUri) buttons.unshift({ text: t('addFlight.pdfReportSend'), value: 'send' });
    const choice = await alertAsync(t('addFlight.importSuspectTitle'), t('addFlight.importSuspectMessage', { list }), buttons);
    if (choice === 'send' && pdfUri) {
      await offerRosterPdfReport(pdfUri, 'suspect', {
        ...report,
        meta: {
          ...(report.meta ?? {}),
          suspect: result.suspectLegs.slice(0, 10).map((s) => `${s.flight_number} ${s.flight_date} ${s.reason}`).join(', '),
        },
      });
    }
  }

  if (result.staleFlights.length) {
    const list = listLines(result.staleFlights, staleLine, 6);
    const choice = await alertAsync(
      t('addFlight.importStaleTitle'),
      t('addFlight.importStaleMessage', { n: result.staleFlights.length, list }),
      [
        { text: t('addFlight.importStaleKeep'), style: 'cancel', value: 'keep' },
        { text: t('addFlight.importStaleRemove'), style: 'destructive', value: 'remove' },
      ],
    );
    if (choice === 'remove') {
      const results = await Promise.all(
        result.staleFlights.map((f) => supabase.rpc('remove_me_from_flight', { p_flight_id: f.id })),
      );
      const removed = results.filter((r) => !r.error).length;
      try {
        await args.onFlightsChanged?.();
      } catch {
        // ignore
      }
      await alertAsync(
        '',
        removed === result.staleFlights.length ? t('addFlight.importStaleRemoved', { n: removed }) : t('common.error'),
        [{ text: t('common.ok'), value: 'ok' }],
      );
    }
  }
}
