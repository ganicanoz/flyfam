/**
 * Re-export paylaşılan parser (`supabase/functions/_shared/roster-pdf/`, barrel: `pdfRosterImport.ts`).
 * Şu an PDF: Pegasus roster (`airlines/pegasus/`). RPC içe aktarma bu dosyada kalır (SupabaseClient).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PdfFlightRow } from '../../supabase/functions/_shared/pdfRosterImport';
import {
  buildRosterImportPlan,
  findSuspectRosterLegs,
  normalizeRosterCode,
  type ChainLeg,
  type RosterImportPlanItem,
  type RosterStaleFlight,
  type RosterSuspectLeg,
} from '../../supabase/functions/_shared/roster-import/plan';

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

export type PdfImportRpcResult = {
  ok: number;
  failed: Array<{ flight_number: string; flight_date: string; message: string }>;
  /** Geçersiz satır (kod/tarih yok) nedeniyle atlananlar */
  skippedNonFlights: number;
  skippedIncompleteFlights: number;
  importedFlights: number;
  importedNonFlights: number;
  /** THY’de TK dışı satırlar; desteklenmeyen havayolunda tüm satırlar (PGT’de 0) */
  skippedWrongAirline: number;
  /** Bu import’un uçuşlarında rota/saat tutarsızlığı (parser şüphesi). */
  suspectLegs: RosterSuspectLeg[];
  /** Import tarih aralığında olup bu PDF’te bulunmayan mevcut uçuşlar (kaldırma kullanıcı onayıyla). */
  staleFlights: RosterStaleFlight[];
};

/**
 * Uçuş satırları + SIM / duty_off (FSF/FOF/DUTY/STBY…).
 * Uçuş UTC: kalkış = origin istasyon lokal, iniş = destination istasyon lokal (`airports.timezone_iana`).
 * Görev UTC: home base lokal (`crewHomeBaseIata`); yoksa Europe/Istanbul.
 */
export async function importPdfFlightsViaRpc(
  supabase: SupabaseClient,
  rows: PdfFlightRow[],
  options?: {
    rawText?: string | null;
    /** Zorunlu: profil `airline_icao`. PGT/THY/SXS/FHY/IGO desteklenir; aksi veya boşsa içe aktarılmaz. */
    crewAirlineIcao?: string | null;
    crewAirlineIata?: string | null;
    /** Duty/nöbet/off saatleri için home base IATA (istasyon lokal → UTC). */
    crewHomeBaseIata?: string | null;
    /** Yalnız aktivite kaydı için (`edge_server_flights` vb.). */
    parseSource?: string | null;
  }
): Promise<PdfImportRpcResult> {
  await flushPendingRosterClear();
  const failed: PdfImportRpcResult['failed'] = [];
  const plan = await buildRosterImportPlan(supabase, rows, options);
  const icaoOpt = plan.icao;
  const { skippedWrongAirline, skippedInvalid } = plan;

  let ok = 0;
  let importedFlights = 0;
  let importedNonFlights = 0;
  let skippedIncompleteFlights = 0;

  type RowOutcome =
    | { kind: 'success'; rosterKind: 'flight' | 'duty_off' | 'sim'; flightId: string }
    | {
        kind: 'skip_incomplete';
        entry: { flight_number: string; flight_date: string; message: string };
      }
    | { kind: 'fail'; entry: { flight_number: string; flight_date: string; message: string } };

  const importOnePlannedRow = async (it: RosterImportPlanItem): Promise<RowOutcome> => {
    if (it.kind === 'incomplete') return { kind: 'skip_incomplete', entry: it.entry };
    const { data: flightId, error } = await supabase.rpc('add_me_to_flight', it.args);
    if (error) {
      return {
        kind: 'fail',
        entry: { flight_number: it.code, flight_date: it.effectiveDate, message: error.message },
      };
    }
    if (!flightId) {
      return {
        kind: 'fail',
        entry: {
          flight_number: it.code,
          flight_date: it.effectiveDate,
          message: 'Crew profile not found',
        },
      };
    }
    return { kind: 'success', rosterKind: it.rosterKind, flightId: String(flightId) };
  };

  const outcomes = await Promise.all(plan.items.map((it) => importOnePlannedRow(it)));
  const importedIds = new Set<string>();
  const importedFlightIds: string[] = [];
  for (const o of outcomes) {
    if (o.kind === 'success') {
      ok += 1;
      importedIds.add(o.flightId);
      if (o.rosterKind === 'flight') {
        importedFlights += 1;
        importedFlightIds.push(o.flightId);
      } else importedNonFlights += 1;
    } else if (o.kind === 'skip_incomplete') {
      skippedIncompleteFlights += 1;
      failed.push(o.entry);
    } else {
      failed.push(o.entry);
    }
  }

  // Drop memberships older than this import’s earliest date — not “yesterday”.
  // Yesterday floor wiped in-plan past duties (ör. PC398 20 Eyl when today is 24 Eyl).
  let importFloor: string | null = null;
  let importCeil: string | null = null;
  for (const p of plan.items) {
    const d = (p.effectiveDate || '').trim();
    if (d && (!importFloor || d < importFloor)) importFloor = d;
    if (d && (!importCeil || d > importCeil)) importCeil = d;
  }
  let myFlightIds: string[] = [];
  try {
    if (ok > 0 && importFloor) {
      const { data: me } = await supabase.from('crew_profiles').select('id').single();
      const crewId = (me as { id?: string } | null)?.id ?? null;
      if (crewId) {
        const { data: fcRows } = await supabase.from('flight_crew').select('flight_id').eq('crew_id', crewId);
        if (fcRows?.length) {
          myFlightIds = fcRows.map((r: { flight_id: string }) => r.flight_id);
          const { data: oldFlights } = await supabase
            .from('flights')
            .select('id')
            .in('id', myFlightIds)
            .lt('flight_date', importFloor);
          const removed = new Set((oldFlights ?? []).map((f) => (f as { id: string }).id));
          await Promise.all(
            [...removed].map((id) => supabase.rpc('remove_me_from_flight', { p_flight_id: id })),
          );
          myFlightIds = myFlightIds.filter((id) => !removed.has(id));
        }
      }
    }
  } catch {
    // Non-fatal cleanup best-effort.
  }

  let suspectLegs: RosterSuspectLeg[] = [];
  if (importedFlightIds.length > 1) {
    try {
      const { data } = await supabase
        .from('flights')
        .select('flight_number, flight_date, origin_airport, destination_airport, scheduled_departure, scheduled_arrival')
        .in('id', [...new Set(importedFlightIds)]);
      suspectLegs = findSuspectRosterLegs((data ?? []) as ChainLeg[]);
    } catch {
      // Non-fatal check.
    }
  }

  // Aynı uçuş numarası ±3 gün içinde import edilemediyse (başarısız/eksik) o eski satır «PDF’te yok» sayılmaz.
  let staleFlights: RosterStaleFlight[] = [];
  if (ok > 0 && importFloor && importCeil && myFlightIds.length) {
    try {
      const candidateIds = myFlightIds.filter((id) => !importedIds.has(id));
      if (candidateIds.length) {
        const { data } = await supabase
          .from('flights')
          .select('id, flight_number, flight_date, origin_airport, destination_airport, roster_entry_kind')
          .in('id', candidateIds)
          .gte('flight_date', importFloor)
          .lte('flight_date', importCeil);
        const dayDiff = (a: string, b: string) =>
          Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
        const notImported = failed.map((e) => ({ fn: normalizeRosterCode(e.flight_number), d: e.flight_date }));
        staleFlights = ((data ?? []) as Array<RosterStaleFlight & { roster_entry_kind: string | null }>)
          .filter((f) => (f.roster_entry_kind ?? 'flight') === 'flight')
          .filter((f) => !notImported.some((n) => n.fn === normalizeRosterCode(f.flight_number) && dayDiff(n.d, f.flight_date) <= 3))
          .map(({ id, flight_number, flight_date, origin_airport, destination_airport }) => ({
            id,
            flight_number,
            flight_date,
            origin_airport,
            destination_airport,
          }))
          .sort((a, b) => a.flight_date.localeCompare(b.flight_date));
      }
    } catch {
      // Non-fatal check.
    }
  }

  if (ok > 0) {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (uid) {
        await trackActivityEvent(uid, 'roster_import', {
          ok,
          imported_flights: importedFlights,
          imported_non_flights: importedNonFlights,
          failed: failed.length,
          airline_icao: icaoOpt || null,
          parse_source: options?.parseSource ?? null,
          suspect_n: suspectLegs.length,
          suspect: suspectLegs.slice(0, 10).map((s) => `${s.flight_number} ${s.flight_date} ${s.reason}`),
          stale_n: staleFlights.length,
        });
      }
    } catch {
      // ignore
    }
  }

  return {
    ok,
    failed,
    skippedNonFlights: skippedInvalid,
    skippedIncompleteFlights,
    importedFlights,
    importedNonFlights,
    skippedWrongAirline,
    suspectLegs,
    staleFlights,
  };
}
