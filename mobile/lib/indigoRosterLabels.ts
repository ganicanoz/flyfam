/**
 * IndiGo roster kartları — yalnızca UI (IGO profili veya 6E/OFG/SBYP/ASBD sezgisel).
 * Parser/edge ile aynı iş kuralları; diğer havayolları etkilenmez.
 */

export function isLikelyIndigoRosterCode(flightNumber: string | null | undefined): boolean {
  const c = (flightNumber ?? '').replace(/\s/g, '').toUpperCase();
  if (c === 'OFG' || c === 'SBYP' || c === 'ASBD') return true;
  return /^6E\d{3,4}$/.test(c);
}

export function shouldUseIndigoRosterLabels(params: {
  isCrew: boolean;
  crewAirlineIcao: string | null | undefined;
  flightNumber: string;
}): boolean {
  if (params.isCrew && params.crewAirlineIcao?.toUpperCase() === 'IGO') return true;
  if (!params.isCrew && isLikelyIndigoRosterCode(params.flightNumber)) return true;
  return false;
}

export function indigoDutyBlockTitleTr(codeRaw: string): string | null {
  const code = codeRaw.replace(/\s/g, '').toUpperCase();
  if (code === 'OFG') return 'Boş Gün';
  if (code === 'SBYP') return 'Ev nöbeti';
  if (code === 'ASBD') return 'Meydan nöbeti';
  return null;
}

export function indigoDutyBlockTitleEn(codeRaw: string): string | null {
  const code = codeRaw.replace(/\s/g, '').toUpperCase();
  if (code === 'OFG') return 'Golden Day Off';
  if (code === 'SBYP') return 'Home Standby';
  if (code === 'ASBD') return 'Standby at Domestic Airport';
  return null;
}

/** Training Details / PDF İngilizce kurs satırı — bilinen ifadeleri TR’ye çevir. */
export function indigoRosterTrainingDetailDisplay(sourceEn: string, localeTr: boolean): string {
  const s = sourceEn.trim();
  if (!localeTr) return s;
  const low = s.toLowerCase();
  const exact: Record<string, string> = {
    'annual check': 'Yıllık kontrol',
    'recurrent training': 'Tekrar eğitimi',
    'first aid': 'İlk yardım',
  };
  if (exact[low]) return exact[low];
  const table: Array<{ match: RegExp; tr: string }> = [
    { match: /\bannual\s+check\b/i, tr: 'Yıllık kontrol' },
    { match: /\brecurrent\b/i, tr: 'Tekrar eğitimi' },
    { match: /\bfirst\s+aid\b/i, tr: 'İlk yardım' },
    { match: /\bsimulator\b/i, tr: 'Simülatör' },
    { match: /\btraining\b/i, tr: 'Eğitim' },
    { match: /\bseminar\b/i, tr: 'Seminer' },
    { match: /\bexam\b/i, tr: 'Sınav' },
    { match: /\binstructor\b/i, tr: 'Eğitmen' },
    { match: /\btrainee\b/i, tr: 'Kursiyer' },
  ];
  let out = s;
  for (const { match, tr } of table) {
    if (match.test(out)) {
      out = out.replace(match, tr);
    }
  }
  return out;
}
