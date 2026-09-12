/**
 * Card occupation labels: local override → published catalog → baked-in.
 */
import {
  rosterOccupationLabelTr as bakedOccupationLabelTr,
  rosterOccupationLabelEn as bakedOccupationLabelEn,
} from './pdfRosterImport';
import { lookupPublishedOccupationLabel } from './rosterOccupationCatalog';
import { lookupLocalOccupationLabel } from './rosterOccupationLocalOverrides';

export function rosterOccupationLabelTr(
  code: string | null | undefined,
  airlineIcao?: string | null,
): string | null {
  return (
    lookupLocalOccupationLabel(code, 'tr') ??
    lookupPublishedOccupationLabel(code, 'tr', airlineIcao) ??
    bakedOccupationLabelTr(code)
  );
}

export function rosterOccupationLabelEn(
  code: string | null | undefined,
  airlineIcao?: string | null,
): string | null {
  return (
    lookupLocalOccupationLabel(code, 'en') ??
    lookupPublishedOccupationLabel(code, 'en', airlineIcao) ??
    bakedOccupationLabelEn(code)
  );
}

/** True when catalog/baked/local provides a real label (not just raw code). */
export function isOccupationCodeDefined(
  code: string | null | undefined,
  airlineIcao?: string | null,
): boolean {
  const u = String(code || '')
    .replace(/\s/g, '')
    .toUpperCase();
  if (!u) return false;
  const label =
    lookupLocalOccupationLabel(u, 'tr') ??
    lookupPublishedOccupationLabel(u, 'tr', airlineIcao) ??
    bakedOccupationLabelTr(u);
  if (!label) return false;
  return label.replace(/\s/g, '').toUpperCase() !== u;
}
