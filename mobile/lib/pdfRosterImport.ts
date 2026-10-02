/**
 * Re-export paylaşılan parser (`supabase/functions/_shared/roster-pdf/`, barrel: `pdfRosterImport.ts`).
 * RPC içe aktarma: paylaşılan `roster-import/run.ts` (Edge `import-roster` ile aynı kod).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PdfFlightRow } from '../../supabase/functions/_shared/pdfRosterImport';
import {
  runRosterImport,
  type RosterImportOptions,
  type RosterImportResult,
} from '../../supabase/functions/_shared/roster-import/run';

export * from '../../supabase/functions/_shared/pdfRosterImport';
export {
  buildRosterImportPlan,
  fetchAirportTimezonesByIata,
  findSuspectRosterLegs,
  type ChainLeg,
  type RosterImportPlan,
  type RosterImportPlanItem,
  type RosterImportRpcArgs,
  type RosterStaleFlight,
  type RosterSuspectLeg,
} from '../../supabase/functions/_shared/roster-import/plan';

import { trackActivityEvent } from './userActivity';
import { flushPendingRosterClear } from './rosterFlightClear';

/**
 * Roster PDF içe aktarma — ürün kilidi (filtre/ICAO listesi paylaşılan `crewAirlineFilter` modülünde).
 * Destek: PGT / THY / SXS / FHY / IGO.
 */

export type PdfImportRpcResult = RosterImportResult;

/**
 * Uçuş satırları + SIM / duty_off (FSF/FOF/DUTY/STBY…).
 * Uçuş UTC: kalkış = origin istasyon lokal, iniş = destination istasyon lokal (`airports.timezone_iana`).
 * Görev UTC: home base lokal (`crewHomeBaseIata`); yoksa Europe/Istanbul.
 */
export async function importPdfFlightsViaRpc(
  supabase: SupabaseClient,
  rows: PdfFlightRow[],
  options?: RosterImportOptions
): Promise<PdfImportRpcResult> {
  return runRosterImport(supabase, rows, options, {
    beforeImport: flushPendingRosterClear,
    trackImport: async (meta) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (uid) await trackActivityEvent(uid, 'roster_import', meta);
    },
  });
}
