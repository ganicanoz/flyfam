/**
 * Roster PDF dış API — modül yolu: `roster-pdf/*`.
 * Pegasus = şu an tek desteklenen PDF; diğer şirketler `airlines/<kod>/`.
 */

export type { PdfFlightRow, RowScheduleZones } from './types.ts';

export { isLikelyFlightNumber, extractTimesOnLine, extractRouteOnLine } from './textUtils.ts';

export {
  trLocalDateTimeToUtcIso,
  dutyClockToUtcIso,
  ROSTER_FALLBACK_TIMEZONE,
  addCalendarDays,
  restEndOperatingYmd,
  localDateTimeInTimezoneToUtcIso,
  rowToScheduleIso,
  pegasusUtcSchedulePairFromFlightDate,
} from './timeAndSchedule.ts';

export {
  rosterOccupationLabelTr,
  rosterOccupationLabelEn,
  isOffDayOccupationCode,
  isAnnualLeaveOccupationCode,
  isUnpaidLeaveOccupationCode,
  isGroundDutyOccupationCode,
  isOfficeDutyOccupationCode,
  isStandbyOccupationCode,
  isTrainingOccupationCode,
} from './occupationLabels.ts';

export { isSimulatorOccupationCode, simulatorFlightNumberLabel, PEGASUS_SIM_OR_IPT_OCC } from './simulatorDuty.ts';

export {
  normalizePdfTextForRosterParse,
  looksLikePegasusDutyStylePdf,
  looksLikeSunExpressSchedulePdf,
  looksLikeFreebirdRosterPdf,
  looksLikeIndigoCrewSchedulePdf,
  looksLikeThyCrewRosterPdf,
  detectPegasusPlanTimeBasis,
} from './normalize.ts';

export { parseFlightsFromPdfText } from './parseFlightsFromPdfText.ts';
export {
  ROSTER_PDF_IMPORT_SUPPORTED_AIRLINE_ICAOS,
  normalizeCrewAirlineIcaoTypo,
  isRosterPdfImportSupportedForCrewAirline,
  filterPdfRowsForCrewAirline,
  detectRosterPdfLayout,
  type DetectedRosterLayout,
} from './crewAirlineFilter.ts';

export { tryPegasusLineAnchorDate, parseFlightsFromPdfText_Pegasus } from './airlines/pegasus/lineScan.ts';
export {
  parseFlightsFromPdfText_DutyLocalTableCore,
  parseFlightsFromPdfText_DutyLocalTable,
  parseFlightsFromPdfText_DutySingleLineSameRow,
} from './airlines/pegasus/dutyTable.ts';

export { tryThyLineAnchorDate, parseFlightsFromPdfText_THY } from './airlines/thy/lineScan.ts';
export { parseFlightsFromPdfText_SunExpress } from './airlines/sunexpress/lineScan.ts';
export { parseFlightsFromPdfText_Freebird } from './airlines/freebird/lineScan.ts';
export { parseFlightsFromPdfText_Indigo } from './airlines/indigo/lineScan.ts';

export { rowFlightRestEndUtc, rowRosterBlockDutyTimesUtc, rowDutyOffTimesUtc } from './rowUtcHelpers.ts';
