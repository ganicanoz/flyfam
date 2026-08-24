/**
 * IndiGo PDF "Training Details" — uçuş numarası + tarih ile eşleşen kurs notu (yalnızca IndiGo).
 */

import type { PdfFlightRow } from '../../types.ts';

export type IndigoTrainingNote = { dateIso: string; digits: string; note: string };

/** Ham PDF metninden Training Details blokunu tarar. */
export function parseIndigoTrainingNotesFromPdf(fullText: string): IndigoTrainingNote[] {
  const i = fullText.search(/\bTraining Details\b/i);
  if (i < 0) return [];
  const endMarkers = ['Hotel Information', 'Transfer Information', 'Pax Transfer Information', 'Descriptions'];
  let cut = fullText.length;
  for (const m of endMarkers) {
    const j = fullText.indexOf(m, i + 20);
    if (j !== -1 && j < cut) cut = j;
  }
  const block = fullText.slice(i, cut);
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const out: IndigoTrainingNote[] = [];
  let pendingDate: string | null = null;

  for (const line of lines) {
    if (/^Training Details$/i.test(line)) continue;
    if (/^DateTimeDuty/i.test(line)) continue;

    const glued = line.match(/^(\d{2})\/(\d{2})\/(\d{4})(\d{4})\s*-\s*(\d{4})$/);
    if (glued) {
      pendingDate = `${glued[3]}-${glued[2]}-${glued[1]}`;
      continue;
    }
    const dateOnly = line.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dateOnly) {
      pendingDate = `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
      continue;
    }

    const fc = line.match(/^(\d{3,4})\s*-\s*(.+)$/);
    if (fc && pendingDate) {
      const digits = fc[1]!;
      let note = fc[2]!.trim();
      if (/^\([A-Z]\)\s*$/.test(note) || note === '(C)') continue;
      note = note.replace(/\s*\([A-Z]\)\s*$/, '').trim();
      if (!note || /^--/.test(line)) continue;
      out.push({ dateIso: pendingDate, digits, note });
    }
  }

  return out;
}

/** `6E` + tarih ile eşleşen satırlara PDF kurs notunu yazar (import / önizleme). */
export function mergeIndigoTrainingNotesIntoRows(rows: PdfFlightRow[], fullText: string): void {
  const notes = parseIndigoTrainingNotesFromPdf(fullText);
  if (notes.length === 0) return;
  const byKey = new Map<string, string>();
  for (const n of notes) {
    byKey.set(`${n.dateIso}|6E${n.digits}`, n.note);
    byKey.set(`${n.dateIso}|6E${n.digits.padStart(4, '0')}`, n.note);
  }
  for (const r of rows) {
    if (r.roster_entry_kind != null && r.roster_entry_kind !== 'flight') continue;
    const fn = (r.flight_number || '').replace(/\s/g, '').toUpperCase();
    if (!/^6E\d{3,4}$/.test(fn)) continue;
    const note = byKey.get(`${r.flight_date}|${fn}`);
    if (note) {
      (r as PdfFlightRow & { indigo_roster_detail_en?: string | null }).indigo_roster_detail_en = note;
    }
  }
}
