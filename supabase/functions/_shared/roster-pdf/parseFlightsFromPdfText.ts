/**
 * Ana giriş: ham metin / normalize → şirket parser’ları birleştir.
 *
 * IndiGo (`looksLikeIndigoCrewSchedulePdf`) → yerel istasyon saatleri (InterGlobe PDF).
 * THY ekip PDF (`looksLikeThyCrewRosterPdf`) → yalnız GMT tablo parser’ı.
 * Aksi halde Pegasus / SunExpress / Freebird ve diğerleri.
 */

import { parseFlightsFromPdfText_DutyLocalTable } from './airlines/pegasus/dutyTable.ts';
import { parseFlightsFromPdfText_Freebird } from './airlines/freebird/lineScan.ts';
import { parseFlightsFromPdfText_Indigo } from './airlines/indigo/lineScan.ts';
import { parseFlightsFromPdfText_Pegasus } from './airlines/pegasus/lineScan.ts';
import { parseFlightsFromPdfText_SunExpress } from './airlines/sunexpress/lineScan.ts';
import { parseDutyFromPdfText_THY, parseFlightsFromPdfText_THY } from './airlines/thy/lineScan.ts';
import {
  dropSingleLineFlightDateGhosts,
  mergePdfRow,
  pdfRowDedupeKey,
  rosterEntrySortRank,
} from './merge.ts';
import {
  looksLikePegasusDutyStylePdf,
  looksLikeFreebirdRosterPdf,
  looksLikeIndigoCrewSchedulePdf,
  looksLikeSunExpressSchedulePdf,
  looksLikeThyCrewRosterPdf,
  normalizePdfTextForRosterParse,
} from './normalize.ts';
import type { PdfFlightRow } from './types.ts';

export function parseFlightsFromPdfText(text: string): PdfFlightRow[] {
  const raw = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  /** IndiGo: ham metin; genel normalize Pegasus desenleriyle satırı bozabilir. */
  if (looksLikeIndigoCrewSchedulePdf(raw)) {
    const out = parseFlightsFromPdfText_Indigo(raw);
    out.sort(
      (a, b) =>
        a.flight_date.localeCompare(b.flight_date) ||
        rosterEntrySortRank(a) - rosterEntrySortRank(b) ||
        a.flight_number.localeCompare(b.flight_number),
    );
    return out;
  }

  const normalized = normalizePdfTextForRosterParse(text);

  /** THY ekip PDF: yalnız GMT tablo tarayıcısı (Pegasus ile karışmasın). */
  if (looksLikeThyCrewRosterPdf(normalized)) {
    const map = new Map<string, PdfFlightRow>();
    for (const f of [
      ...parseFlightsFromPdfText_THY(normalized),
      ...parseDutyFromPdfText_THY(normalized),
    ]) {
      const k = pdfRowDedupeKey(f);
      const prev = map.get(k);
      map.set(k, prev ? mergePdfRow(prev, f) : { ...f });
    }
    const out = dropSingleLineFlightDateGhosts([...map.values()]);
    out.sort(
      (a, b) =>
        a.flight_date.localeCompare(b.flight_date) ||
        rosterEntrySortRank(a) - rosterEntrySortRank(b) ||
        a.flight_number.localeCompare(b.flight_number),
    );
    return out;
  }

  /** SunExpress schedule PDF (XQ + OFF/Report/Release). */
  if (looksLikeSunExpressSchedulePdf(normalized)) {
    const out = parseFlightsFromPdfText_SunExpress(normalized);
    out.sort(
      (a, b) =>
        a.flight_date.localeCompare(b.flight_date) ||
        rosterEntrySortRank(a) - rosterEntrySortRank(b) ||
        a.flight_number.localeCompare(b.flight_number),
    );
    return out;
  }

  /** Freebird crew roster (UTC + LT bracket). */
  if (looksLikeFreebirdRosterPdf(normalized)) {
    const out = parseFlightsFromPdfText_Freebird(normalized);
    out.sort(
      (a, b) =>
        a.flight_date.localeCompare(b.flight_date) ||
        rosterEntrySortRank(a) - rosterEntrySortRank(b) ||
        a.flight_number.localeCompare(b.flight_number),
    );
    return out;
  }

  /** Pegasus: tarih + uçuşlar `DutyLocalTable` (çekirdek + tek-satır fallback) ile gelir; bunu kesmeyin. */
  const dutyRows = parseFlightsFromPdfText_DutyLocalTable(normalized);
  const pegasusDutyStyle = looksLikePegasusDutyStylePdf(normalized);
  /** Pegasus duty PDF: en az bir duty satırı varsa satır-taran Pegasus kapalı (lastDate hayaletleri). */
  const skipLinePegasus = pegasusDutyStyle && dutyRows.length > 0;

  const map = new Map<string, PdfFlightRow>();
  for (const f of [
    ...(skipLinePegasus ? [] : parseFlightsFromPdfText_Pegasus(normalized)),
    ...dutyRows,
  ]) {
    const k = pdfRowDedupeKey(f);
    const prev = map.get(k);
    map.set(k, prev ? mergePdfRow(prev, f) : { ...f });
  }
  const out = dropSingleLineFlightDateGhosts([...map.values()]);
  out.sort(
    (a, b) =>
      a.flight_date.localeCompare(b.flight_date) ||
      rosterEntrySortRank(a) - rosterEntrySortRank(b) ||
      a.flight_number.localeCompare(b.flight_number),
  );
  return out;
}
