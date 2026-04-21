/**
 * Roster PDF dış API — modül yolu: `roster-pdf/*`.
 * Pegasus = şu an tek desteklenen PDF; diğer şirketler `airlines/<kod>/`.
 */

export type { PdfFlightRow, RowScheduleZones } from './types.ts';

export { isLikelyFlightNumber, extractTimesOnLine, extractRouteOnLine } from './textUtils.ts';

export {
  trLocalDateTimeToUtcIso,
  ROSTER_FALLBACK_TIMEZONE,
  addCalendarDays,
  localDateTimeInTimezoneToUtcIso,
  rowToScheduleIso,
  pegasusUtcSchedulePairFromFlightDate,
} from './timeAndSchedule.ts';

export { rosterOccupationLabelTr, rosterOccupationLabelEn } from './occupationLabels.ts';

export {
  normalizePdfTextForRosterParse,
  looksLikePegasusDutyStylePdf,
  looksLikeSunExpressSchedulePdf,
  looksLikeThyCrewRosterPdf,
} from './normalize.ts';

export { parseFlightsFromPdfText } from './parseFlightsFromPdfText.ts';

export { tryPegasusLineAnchorDate, parseFlightsFromPdfText_Pegasus } from './airlines/pegasus/lineScan.ts';
export {
  parseFlightsFromPdfText_DutyLocalTableCore,
  parseFlightsFromPdfText_DutyLocalTable,
  parseFlightsFromPdfText_DutySingleLineSameRow,
} from './airlines/pegasus/dutyTable.ts';

export { tryThyLineAnchorDate, parseFlightsFromPdfText_THY } from './airlines/thy/lineScan.ts';
export { parseFlightsFromPdfText_SunExpress } from './airlines/sunexpress/lineScan.ts';

export { rowFlightRestEndUtc, rowRosterBlockDutyTimesUtc, rowDutyOffTimesUtc } from './rowUtcHelpers.ts';
