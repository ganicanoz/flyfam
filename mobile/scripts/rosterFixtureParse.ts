/**
 * Deterministic roster PDF text parse for fixtures: fixed clock + UTC, because some
 * parsers fall back to "today" for the roster year.
 */
import {
  detectRosterPdfLayout,
  parseFlightsFromPdfText,
  type PdfFlightRow,
} from '../../supabase/functions/_shared/pdfRosterImport';

export const FIXTURE_NOW_ISO = '2026-10-05T12:00:00.000Z';

let pinned = false;

export function pinFixtureClock(): void {
  if (pinned) return;
  pinned = true;
  process.env.TZ = 'UTC';
  const fixedMs = Date.parse(FIXTURE_NOW_ISO);
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixedMs);
      else super(...(args as [string | number | Date]));
    }
    static now(): number {
      return fixedMs;
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
}

export type RosterFixtureResult = {
  layout: ReturnType<typeof detectRosterPdfLayout>;
  rows: PdfFlightRow[];
};

export function parseRosterFixtureText(text: string): RosterFixtureResult {
  pinFixtureClock();
  return { layout: detectRosterPdfLayout(text), rows: parseFlightsFromPdfText(text) };
}
