/**
 * IndiGo crew PDF — "Descriptions" blokundaki görev kodları (yalnızca IndiGo parser).
 * Diğer havayolu parser'ları bunu kullanmaz.
 */

import { rosterOccupationLabelEn, rosterOccupationLabelTr } from '../../occupationLabels.ts';

/** PDF "Descriptions" → kod → ham açıklama (İngilizce). */
export function parseIndigoDutyLegendFromPdf(fullText: string): Record<string, string> {
  const i = fullText.search(/\nDescriptions\s*\n/i);
  if (i < 0) return {};
  const rest = fullText.slice(i);
  const end = rest.search(/\nComments\s*\n/i);
  const slice = end > 0 ? rest.slice(0, end) : rest.slice(0, 2500);
  const map: Record<string, string> = {};
  for (const rawLine of slice.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || /^Duty Codes/i.test(line) || /^Indicators$/i.test(line)) continue;
    const m = /^([A-Z]{3,6})\s*-\s*(.+)$/.exec(line);
    if (!m) continue;
    const code = m[1]!.toUpperCase();
    let desc = m[2]!.trim();
    // PDF sütun kayması: "Golden Day Offc - Annual Check (Trainee)"
    if (/^OFG$/i.test(code) && /Golden\s+Day\s+Off/i.test(desc)) {
      desc = 'Golden Day Off';
    } else {
      desc = desc.replace(/\s*c\s*-\s*Annual Check.*$/i, '').trim();
    }
    if (desc) map[code] = desc;
  }
  return map;
}

/**
 * Roster kartı için kısa Türkçe görev adı (IndiGo duty kodları).
 * PDF İngilizce açıklama `legendEn` ile gelir; yedek sabit eşleme kullanılır.
 */
export function indigoDutyShortLabelTr(code: string, legendEn?: string | null): string {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (u === 'OFG') return 'Boş Gün';
  if (u === 'SBYP') return 'Ev nöbeti';
  if (u === 'ASBD') return 'Meydan nöbeti';
  const le = (legendEn ?? '').toLowerCase();
  if (le.includes('golden') && le.includes('off')) return 'Boş Gün';
  if (le.includes('home') && le.includes('standby')) return 'Ev nöbeti';
  if (le.includes('domestic') && le.includes('airport')) return 'Meydan nöbeti';
  return rosterOccupationLabelTr(code) ?? code;
}

export function indigoDutyShortLabelEn(code: string, legendEn?: string | null): string {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (legendEn?.trim()) return legendEn.trim();
  if (u === 'OFG') return 'Golden Day Off';
  if (u === 'SBYP') return 'Home Standby';
  if (u === 'ASBD') return 'Standby at Domestic Airport';
  return rosterOccupationLabelEn(code) ?? code;
}
