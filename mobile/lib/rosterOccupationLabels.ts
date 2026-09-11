/**
 * Card occupation labels: published remote catalog first, then baked-in occupationLabels.
 */
import {
  rosterOccupationLabelTr as bakedOccupationLabelTr,
  rosterOccupationLabelEn as bakedOccupationLabelEn,
} from './pdfRosterImport';
import { lookupPublishedOccupationLabel } from './rosterOccupationCatalog';

export function rosterOccupationLabelTr(
  code: string | null | undefined,
  airlineIcao?: string | null,
): string | null {
  return (
    lookupPublishedOccupationLabel(code, 'tr', airlineIcao) ?? bakedOccupationLabelTr(code)
  );
}

export function rosterOccupationLabelEn(
  code: string | null | undefined,
  airlineIcao?: string | null,
): string | null {
  return (
    lookupPublishedOccupationLabel(code, 'en', airlineIcao) ?? bakedOccupationLabelEn(code)
  );
}
