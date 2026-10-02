import Constants from 'expo-constants';
import { Platform, type AlertButton } from 'react-native';
import { alertWithCopy } from './alertWithCopy';
import i18n from './i18n';
import { offerRosterPdfReport, trackRosterImportIssue } from './rosterPdfReport';

export type PdfImportReportContext = {
  title: string;
  message: string;
  crewAirlineIcao?: string | null;
  crewAirlineIata?: string | null;
  parseSource?: string | null;
  edgeFailureHint?: string | null;
  rowCount?: number;
  failed?: { flight_number: string; message: string }[];
  extra?: Record<string, string | number | boolean | null | undefined>;
};

function appVersionLine(): string {
  const version = Constants.expoConfig?.version ?? '?';
  const iosBuild = Constants.expoConfig?.ios?.buildNumber;
  const androidCode = Constants.expoConfig?.android?.versionCode;
  const build =
    Platform.OS === 'ios'
      ? (iosBuild ?? Constants.nativeBuildVersion ?? '?')
      : (androidCode != null ? String(androidCode) : (Constants.nativeBuildVersion ?? '?'));
  return `${version} (${build})`;
}

/** Panoya yapıştırılacak tek blok metin (FlyFam destek / AI debug). */
export function buildPdfImportReport(ctx: PdfImportReportContext): string {
  const lines: string[] = [
    'FlyFam — PDF roster import',
    `When: ${new Date().toISOString()}`,
    `App: ${appVersionLine()}`,
    `Platform: ${Platform.OS}`,
  ];
  if (ctx.crewAirlineIcao) lines.push(`Crew airline ICAO: ${ctx.crewAirlineIcao}`);
  if (ctx.crewAirlineIata) lines.push(`Crew airline IATA: ${ctx.crewAirlineIata}`);
  if (ctx.parseSource) lines.push(`Parse source: ${ctx.parseSource}`);
  if (ctx.edgeFailureHint) lines.push(`Edge hint: ${ctx.edgeFailureHint}`);
  if (ctx.rowCount != null) lines.push(`Parsed rows: ${ctx.rowCount}`);
  if (ctx.failed?.length) {
    lines.push('RPC failures:');
    for (const f of ctx.failed.slice(0, 20)) {
      lines.push(`  - ${f.flight_number}: ${f.message}`);
    }
    if (ctx.failed.length > 20) lines.push(`  … +${ctx.failed.length - 20} more`);
  }
  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      if (v != null && v !== '') lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push('---', `Title: ${ctx.title}`, `Message: ${ctx.message}`);
  return lines.join('\n');
}

export function showPdfImportAlert(
  title: string,
  message: string,
  reportContext?: Omit<PdfImportReportContext, 'title' | 'message'> & { pdfUri?: string | null },
): void {
  const { pdfUri, ...ctx } = reportContext ?? {};
  const copyText = buildPdfImportReport({
    title,
    message,
    ...ctx,
  });
  trackRosterImportIssue(title, {
    crewAirlineIcao: ctx.crewAirlineIcao,
    parseSource: ctx.parseSource,
    rowCount: ctx.rowCount,
    failedCount: ctx.failed?.length,
    edgeFailureHint: ctx.edgeFailureHint,
  });
  const extraButtons: AlertButton[] = pdfUri
    ? [
        {
          text: i18n.t('addFlight.pdfReportSend'),
          onPress: () => {
            void offerRosterPdfReport(pdfUri, 'failed', {
              crewAirlineIcao: ctx.crewAirlineIcao,
              parseSource: ctx.parseSource,
              rowCount: ctx.rowCount,
              meta: {
                title: title.slice(0, 80),
                failed: ctx.failed?.length ?? null,
                edge_hint: ctx.edgeFailureHint ? String(ctx.edgeFailureHint).slice(0, 160) : null,
              },
            });
          },
        },
      ]
    : [];
  alertWithCopy(title, message, { copyText, extraButtons });
}
