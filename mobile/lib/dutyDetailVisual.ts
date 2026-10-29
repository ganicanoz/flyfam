/**
 * EditDuty header visual by occupation code / roster kind.
 * SIM / IPT → simulator family; SNV/RTC → exam; STBY → standby; else generic duty.
 */
import type { ImageSourcePropType } from 'react-native';
import {
  isSimulatorOccupationCode,
  isStandbyOccupationCode,
} from './pdfRosterImport';
import {
  rosterOccupationLabelEn,
  rosterOccupationLabelTr,
} from './rosterOccupationLabels';

export type DutyDetailKind = 'standby' | 'simulator' | 'ipt' | 'exam' | 'duty';

/** Exterior full-motion sim (v2). IPT fixed-base trainer (v2). */
const IMG_SIM = require('../assets/duty/duty-simulator-exterior.jpg');
const IMG_IPT = require('../assets/duty/duty-ipt-trainer.jpg');
const IMG_EXAM = require('../assets/duty/duty-exam.jpg');

function normCode(code: string | null | undefined): string {
  return (code ?? '').replace(/\s/g, '').toUpperCase();
}

function mergedCodes(
  code: string | null | undefined,
  occupationCode?: string | null,
): string {
  return `${normCode(code)} ${normCode(occupationCode)}`.trim();
}

export function isExamOccupationCode(code: string | null | undefined): boolean {
  const u = normCode(code);
  if (!u) return false;
  if (u === 'SNV' || u.startsWith('SNV')) return true;
  if (u === 'RTC' || /^RTC\d+$/.test(u)) return true;
  if (u.includes('EXAM') || u.includes('SINAV')) return true;
  return false;
}

export function resolveDutyDetailKind(
  code: string | null | undefined,
  rosterEntryKind?: string | null,
  occupationCode?: string | null,
): DutyDetailKind {
  const u = mergedCodes(code, occupationCode);
  // IPT / CPI before generic SIM (isSimulatorOccupationCode IPT’yi de true sayar).
  if (u.includes('IPT') || /\bCPI\w*/.test(u) || u.startsWith('CPI')) return 'ipt';
  if (u.includes('SIM') || rosterEntryKind === 'sim' || isSimulatorOccupationCode(code)) {
    return 'simulator';
  }
  if (isExamOccupationCode(code) || isExamOccupationCode(occupationCode)) return 'exam';
  if (
    isStandbyOccupationCode(code) ||
    isStandbyOccupationCode(occupationCode) ||
    /\bRSV\d*\b/.test(u) ||
    u.includes('RZV') ||
    u.includes('CFR')
  ) {
    return 'standby';
  }
  return 'duty';
}

export function dutyDetailHeroSource(kind: DutyDetailKind): ImageSourcePropType | null {
  if (kind === 'ipt') return IMG_IPT;
  if (kind === 'simulator') return IMG_SIM;
  if (kind === 'exam') return IMG_EXAM;
  return null;
}

/** cardAccent key for left stripe / spinner. */
export function dutyDetailAccentKey(
  kind: DutyDetailKind,
): 'standby' | 'simulator' | 'training' | 'duty_off' {
  if (kind === 'standby') return 'standby';
  if (kind === 'simulator' || kind === 'ipt') return 'simulator';
  if (kind === 'exam') return 'training';
  return 'duty_off';
}

/**
 * Page header: human duty name (katalog) + optional code subtitle.
 * Avoids generic «Görev» when a real label exists.
 */
export function resolveDutyPageTitle(opts: {
  code: string | null | undefined;
  kind: DutyDetailKind;
  isTr: boolean;
  airlineIcao?: string | null;
  fallbackDuty: string;
  fallbackSimulator: string;
  fallbackIpt: string;
  fallbackExam: string;
  fallbackStandby: string;
}): { title: string; subtitle: string | null } {
  const u = normCode(opts.code);
  const catalog = opts.isTr
    ? rosterOccupationLabelTr(opts.code, opts.airlineIcao)
    : rosterOccupationLabelEn(opts.code, opts.airlineIcao);
  const catalogUseful =
    !!catalog &&
    catalog.replace(/\s/g, '').toUpperCase() !== u;

  if (opts.kind === 'ipt') {
    const title = catalogUseful ? catalog! : opts.fallbackIpt;
    const subtitle = u && title.replace(/\s/g, '').toUpperCase() !== u ? u : null;
    return { title, subtitle };
  }
  if (opts.kind === 'simulator') {
    const title = catalogUseful ? catalog! : opts.fallbackSimulator;
    // SIM8A vb. kodu alt satırda; düz «SIM» tekrarı yok.
    const subtitle =
      u && u !== 'SIM' && title.replace(/\s/g, '').toUpperCase() !== u ? u : null;
    return { title, subtitle };
  }
  if (opts.kind === 'exam') {
    const title = catalogUseful ? catalog! : opts.fallbackExam;
    const subtitle = u && title.replace(/\s/g, '').toUpperCase() !== u ? u : null;
    return { title, subtitle };
  }
  if (opts.kind === 'standby') {
    const title = catalogUseful ? catalog! : opts.fallbackStandby;
    const subtitle = u && title.replace(/\s/g, '').toUpperCase() !== u ? u : null;
    return { title, subtitle };
  }

  if (catalogUseful) {
    return {
      title: catalog!,
      subtitle: u && catalog!.replace(/\s/g, '').toUpperCase() !== u ? u : null,
    };
  }
  if (u) return { title: u, subtitle: null };
  return { title: opts.fallbackDuty, subtitle: null };
}
