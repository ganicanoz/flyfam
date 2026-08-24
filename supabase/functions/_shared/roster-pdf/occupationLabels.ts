/**
 * Pegasus roster “Occupation” kodları (PDF duty satırları).
 */

import { isSimulatorOccupationCode } from './simulatorDuty.ts';

/** Nöbet / rezerv occupation kodları (PGT + THY). */
export function isStandbyOccupationCode(code: string | null | undefined): boolean {
  const u = (code || '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  return (
    u.startsWith('STBY') ||
    u.startsWith('STB') ||
    u === 'HSBY' ||
    u === 'HSYB' ||
    u === 'ASYB' ||
    u === 'ASBD' ||
    u === 'SBYP' ||
    u === 'SBY' ||
    u === 'SBX' ||
    u === 'RSV' ||
    u === 'RZV' ||
    u === 'RZVM' ||
    /^SB([1-6X])?$/.test(u)
  );
}

/** Eğitim / training içeren yer görevleri — takvimde kırmızı, kartta görev. */
export function isTrainingOccupationCode(code: string | null | undefined): boolean {
  const u = (code || '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.includes('TRAINING')) return true;
  if (u.includes('YERDR')) return true;
  if (u.startsWith('SIM8')) return true;
  return (
    u === 'REC' ||
    u === 'TRT' ||
    u === 'KDME' ||
    u === 'FAA' ||
    u === 'FAT' ||
    u === 'IKA' ||
    u === 'ISG' ||
    u === 'SMA' ||
    u === 'TRA' ||
    u === 'SEM' ||
    u === 'SNV' ||
    u === 'IPT' ||
    u === 'SDM'
  );
}

/** Pegasus roster “Occupation” kodları (STBY sonrası A2/B/D şirket özeli → hepsi nöbet). */
const ROSTER_OCCUPATION_TR: Record<string, string> = {
  DUTY: 'Uçuş görevi',
  /** TR: tek/çift off aynı kullanıcı ifadesi */
  FSF: 'Boş Gün',
  FOF: 'Boş Gün',
  /** Medical / special off — ürün: boş gün */
  MSF: 'Boş Gün',
  STBY: 'Nöbet',
  CFR: 'Potansiyel Görev (CFR)',
  IBB: 'Boş Gün',
  IBE: 'Boş Gün',
  IBX: 'Boş Gün',
  IOZ: 'Boş Gün',
  IBC: 'Boş Gün',
  IBY: 'Boş Gün',
  HSBY: 'Ev Nöbeti',
  HSYB: 'Ev Nöbeti',
  ASYB: 'Havalimanı Nöbeti',
  III: 'Yıllık İzin',
  OFF: 'Boş Gün',
  SBY: 'Nöbet',
  RSV: 'Rezerve',
  MEET: 'Toplantı',
  /** Safety Department Meeting — eğitim sınıfı / yer görevleri */
  SDM: 'Toplantı',
  AVAC: 'Yıllık İzin',
  VAC: 'Yıllık İzin',
  VAV: 'Yıllık İzin',
  DH: 'Deadhead',
  YERDR: 'Yer Dersi',
  IPT: 'Simulator',
  /** IndiGo roster */
  OFG: 'Altın Boş Gün',
  SBYP: 'Ev Nöbeti',
  ASBD: 'İç Hat Havalimanı Nöbeti',
  GOA: 'Ofis',
  OSA: 'Ofis',
  G3A1: 'Ofis',
  G3A2: 'Ofis',
  G4A1: 'Ofis',
  G4A2: 'Ofis',
};

const ROSTER_OCCUPATION_EN: Record<string, string> = {
  DUTY: 'Flight duty',
  FSF: 'Fixed Single Off',
  FOF: 'Fixed Double Off',
  MSF: 'Off Day',
  STBY: 'Standby',
  CFR: 'Potential Duty (CFR)',
  IBB: 'Off Day',
  IBE: 'Replaceable Off Day',
  IBX: 'Off Day',
  IOZ: 'Off Day',
  IBC: 'Off Day',
  IBY: 'Off Day',
  HSBY: 'Home Standby',
  HSYB: 'Home Standby',
  ASYB: 'Airport Standby',
  III: 'Annual Leave',
  OFF: 'Off Day',
  SBY: 'Standby',
  RSV: 'Reserve',
  MEET: 'Meeting',
  /** Safety Department Meeting — classroom / ground training class */
  SDM: 'Meeting',
  AVAC: 'Annual Leave',
  VAC: 'Annual Leave',
  VAV: 'Annual Leave',
  DH: 'Deadhead',
  YERDR: 'Ground Training',
  IPT: 'Simulator',
  OFG: 'Golden Day Off',
  SBYP: 'Home Standby',
  ASBD: 'Standby at Domestic Airport',
  GOA: 'Office Duty',
  OSA: 'Office Duty',
  G3A1: 'Office Duty',
  G3A2: 'Office Duty',
  G4A1: 'Office Duty',
  G4A2: 'Office Duty',
};

/**
 * Crew Planning Abbreviations.pdf (Pegasus) sözlüğü.
 * Not: Bazı kodlar bire bir görev adıdır (çeviri yerine ürün dilinde kısa/anlaşılır karşılık verilir).
 */
const CREW_PLANNING_ABBR_EN: Record<string, string> = {
  ADB: 'Izmir Office Check',
  AYT: 'Antalya Office Check',
  BRA: 'Briefing',
  CD: 'Cancel Duty',
  CXL_DUTY: 'Cancel Duty',
  DLY: 'Delay',
  DEV: 'Bereavement Leave',
  DOT: 'Duty out of Turkey',
  ECN: 'Ercan Office Check',
  ESB: 'Esenboga Office Check',
  FAA: 'First Aid Training',
  FAT: 'First Aid',
  FOF: 'Fixed Double Off',
  FSF: 'Fixed Single Off',
  MSF: 'Off Day',
  G3A1: 'Office Duty',
  G3A2: 'Office Duty',
  G3M1: 'Meeting',
  G3M2: 'Meeting',
  G4A1: 'Office Duty',
  G4A2: 'Office Duty',
  G4M1: 'Meeting',
  G4M2: 'Meeting',
  GMA: 'Meeting',
  GMO: 'Meeting',
  GOA: 'Office Duty',
  HKA: 'Hospital Check',
  IKA: 'INSS / KKA Training',
  INSTR: 'Instructor',
  INTVW: 'Interview',
  ISG: 'Work Health and Safety Training',
  JSV: 'Job Search Vacation',
  KDME: 'Training',
  LSF: 'Licence Renewal Off',
  MAV: 'Excuse Leave',
  MCH: 'Medical Check (5 years)',
  MUA: 'Health Controlling',
  O1A: 'Saw Office Check-1',
  O2A: 'Saw Office Check-2',
  ODM: 'Special Hospital Check',
  OSA: 'Office Support',
  PAM: 'Paid Part Time Period with MCH',
  PAV: 'Paid Part Time Period',
  POS: 'Positioning',
  PRV: 'Pregnancy Leave',
  REC: 'Recurrent Training',
  ROF: 'Requested Double Off',
  RSF: 'Requested Single Off',
  RUF: 'Request Unrecovered Single Off',
  RSV: 'Reserve',
  RZV: 'Reserve',
  RZVM: 'Mandatory Reserve',
  SB: 'Airport Standby',
  SB1: 'Airport Standby',
  SB2: 'Airport Standby',
  SB3: 'Airport Standby',
  SB4: 'Airport Standby',
  SB5: 'Airport Standby',
  SB6: 'Airport Standby',
  SBX: 'Airport Standby',
  SEM: 'Seminar',
  SDM: 'Safety Department Meeting',
  SIM8A: 'PFTC Simulator-A 737',
  SIM8B: 'PFTC Simulator-B 737',
  SIM8C: 'PFTC Simulator-C 737',
  SIM8D: 'PFTC Simulator-D 737',
  SIM8E: 'PFTC Simulator-E 737',
  SIM8M: 'PFTC Simulator-M 737',
  SMA: 'Simulator Training',
  IPT: 'Simulator',
  SNV: 'Exam',
  SOF: 'Special Day Off',
  SOS: 'Special Time Off',
  SRH: 'Sick Report',
  STBY: 'Home Standby',
  STBY1: 'Home Standby',
  STBY2: 'Home Standby',
  STBYA: 'Home Standby',
  STBYB: 'Home Standby',
  STBYC: 'Home Standby',
  SXH: 'Absence',
  TAV: 'Moving Leave',
  TRA: 'Training Instructor',
  TRT: 'Type Rating Training',
  UPV: 'Unpaid Leave',
  VAC: 'Vaccine',
  VAV: 'Annual Leave',
  WAH: 'Work-related Accident',
  WTA: 'Witness/Court',
};

const CREW_PLANNING_ABBR_TR: Record<string, string> = {
  ADB: 'İzmir kontrol',
  AYT: 'Antalya kontrol',
  BRA: 'Brifing',
  CD: 'Görev iptali',
  CXL_DUTY: 'Görev iptali',
  DLY: 'Gecikme',
  DEV: 'Yas izni',
  DOT: 'Yurt dışı',
  ECN: 'Ercan kontrol',
  ESB: 'Esenboğa kontrol',
  FAA: 'İlk yardım',
  FAT: 'İlk yardım',
  FOF: 'Sabit çift off',
  FSF: 'Sabit tek off',
  MSF: 'Boş Gün',
  G3A1: 'Ofis',
  G3A2: 'Ofis',
  G3M1: 'Toplantı',
  G3M2: 'Toplantı',
  G4A1: 'Ofis',
  G4A2: 'Ofis',
  G4M1: 'Toplantı',
  G4M2: 'Toplantı',
  GMA: 'Toplantı',
  GMO: 'Toplantı',
  GOA: 'Ofis',
  HKA: 'Hastane',
  IKA: 'IKA eğitimi',
  INSTR: 'Eğitmen',
  INTVW: 'Mülakat',
  ISG: 'İSG eğitimi',
  JSV: 'İş arama',
  KDME: 'Eğitim',
  LSF: 'Lisans off',
  MAV: 'Mazeret',
  MCH: 'Medikal kontrol',
  MUA: 'Sağlık',
  O1A: 'SAW kontrol 1',
  O2A: 'SAW kontrol 2',
  ODM: 'Özel hastane',
  OSA: 'Ofis destek',
  PAM: 'Part-time (MCH)',
  PAV: 'Part-time',
  POS: 'Pozisyonlama',
  PRV: 'Hamilelik',
  REC: 'Recurrent',
  ROF: 'Boş Gün',
  RSF: 'Boş Gün',
  RUF: 'Telafisiz off',
  RSV: 'Rezerve',
  MEET: 'Toplantı',
  RZV: 'Rezerve',
  RZVM: 'Zorunlu Rezerve',
  SB: 'Meydan standby',
  SB1: 'Meydan standby',
  SB2: 'Meydan standby',
  SB3: 'Meydan standby',
  SB4: 'Meydan standby',
  SB5: 'Meydan standby',
  SB6: 'Meydan standby',
  SBX: 'Meydan standby',
  SEM: 'Seminer',
  SDM: 'Toplantı',
  SIM8A: 'Sim A (737)',
  SIM8B: 'Sim B (737)',
  SIM8C: 'Sim C (737)',
  SIM8D: 'Sim D (737)',
  SIM8E: 'Sim E (737)',
  SIM8M: 'Sim M (737)',
  SMA: 'Sim eğitimi',
  IPT: 'Simülatör',
  SNV: 'Sınav',
  SOF: 'Özel Boş Gün',
  SOS: 'Özel izin',
  SRH: 'Raporlu',
  STBY: 'Ev standby',
  STBY1: 'Ev standby',
  STBY2: 'Ev standby',
  STBYA: 'Ev standby',
  STBYB: 'Ev standby',
  STBYC: 'Ev standby',
  SXH: 'Yokluk',
  TAV: 'Taşınma',
  TRA: 'Eğitmen',
  TRT: 'Tip eğitimi',
  UPV: 'Ücretsiz İzin',
  VAC: 'Aşı',
  VAV: 'Yıllık İzin',
  WAH: 'İş kazası',
  WTA: 'Mahkeme/Tanıklık',
  YERDR: 'Yer Dersi',
};

export function rosterOccupationLabelTr(code: string | null | undefined): string | null {
  if (!code) return null;
  const u = code.replace(/\s/g, '').toUpperCase();
  if (isSimulatorOccupationCode(u)) return 'Simülatör';
  // SDM = Safety Department Meeting (eğitim sınıfı) — `SB…` nöbet kuralına düşmesin
  if (u === 'SDM' || u.startsWith('SDM')) return ROSTER_OCCUPATION_TR.SDM ?? 'Toplantı';
  if (u === 'SBYP') return ROSTER_OCCUPATION_TR.SBYP ?? 'Ev Nöbeti';
  // Meydan standby: SB, SB1–SB6, SBX (SDM hariç)
  if (/^SB([1-6X])?$/.test(u)) return 'Nöbet';
  if (u.startsWith('STBY')) return ROSTER_OCCUPATION_TR.STBY;
  if (u === 'SBY') return ROSTER_OCCUPATION_TR.SBY;
  if (u === 'FSF' || u === 'FOF' || u === 'MSF') return 'Boş Gün';
  if (u === 'VAV' || u === 'VAC' || u === 'AVAC' || u === 'III') return 'Yıllık İzin';
  if (u.includes('YERDR')) return 'Yer Dersi';
  if (isTrainingOccupationCode(u)) return 'Görev';
  if (isOfficeDutyOccupationCode(u)) return 'Ofis';
  return ROSTER_OCCUPATION_TR[u] ?? CREW_PLANNING_ABBR_TR[u] ?? code;
}

export function rosterOccupationLabelEn(code: string | null | undefined): string | null {
  if (!code) return null;
  const u = code.replace(/\s/g, '').toUpperCase();
  if (isSimulatorOccupationCode(u)) return 'Simulator';
  if (u === 'SDM' || u.startsWith('SDM')) return ROSTER_OCCUPATION_EN.SDM ?? 'Meeting';
  if (u === 'SBYP') return ROSTER_OCCUPATION_EN.SBYP ?? 'Home Standby';
  if (/^SB([1-6X])?$/.test(u)) return 'Standby';
  if (u.startsWith('STBY')) return ROSTER_OCCUPATION_EN.STBY;
  if (u === 'SBY') return ROSTER_OCCUPATION_EN.SBY;
  if (u === 'MSF') return 'Off Day';
  if (u === 'VAV' || u === 'VAC' || u === 'AVAC' || u === 'III') return 'Annual Leave';
  if (u.includes('YERDR')) return 'Ground Training';
  if (isTrainingOccupationCode(u)) return 'Duty';
  if (isOfficeDutyOccupationCode(u)) return 'Office Duty';
  return ROSTER_OCCUPATION_EN[u] ?? CREW_PLANNING_ABBR_EN[u] ?? code;
}

/** Ofis görevi — yer dersi gibi gri kutu + takvimde kırmızı. */
export function isOfficeDutyOccupationCode(code: string | null | undefined): boolean {
  const u = (code || '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  return (
    u === 'GOA' ||
    u === 'OSA' ||
    u === 'G3A1' ||
    u === 'G3A2' ||
    u === 'G4A1' ||
    u === 'G4A2' ||
    u === 'O1A' ||
    u === 'O2A' ||
    u === 'ADB' ||
    u === 'AYT' ||
    u === 'ECN' ||
    u === 'ESB' ||
    u.startsWith('GOA') ||
    u.startsWith('OSA') ||
    /^G[34]A\d$/.test(u)
  );
}

/** Yer dersi / ofis — uçuş görevi görünümü (gri kutu, takvim kırmızı); boş gün değil. */
export function isGroundDutyOccupationCode(code: string | null | undefined): boolean {
  const u = (code || '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (isTrainingOccupationCode(u)) return true;
  // Örn. YERDR, YERDR1, XXX-YERDR — kodun herhangi bir yerinde geçebilir.
  if (u.includes('YERDR')) return true;
  return isOfficeDutyOccupationCode(u);
}

/** Yıllık izin occupation kodları (takvimde off; etiket Boş Gün değil). */
export function isAnnualLeaveOccupationCode(code: string | null | undefined): boolean {
  const u = (code || '').replace(/\s/g, '').toUpperCase();
  return u === 'VAV' || u === 'VAC' || u === 'AVAC' || u === 'III';
}

/** Takvim / kart: boş gün (off) occupation kodları — nöbet değil. */
export function isOffDayOccupationCode(code: string | null | undefined): boolean {
  const u = (code || '').replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  return (
    u === 'MSF' ||
    u === 'FSF' ||
    u === 'FOF' ||
    u === 'FREE' ||
    u === 'OFF' ||
    u === 'DOFF' ||
    u === 'RQST' ||
    u === 'RSF' ||
    u === 'ROF' ||
    u === 'RUF' ||
    u === 'SOF' ||
    u === 'SOS' ||
    u === 'LSF' ||
    u === 'OFG' ||
    u === 'IBB' ||
    u === 'IBE' ||
    u === 'IBX' ||
    u === 'IOZ' ||
    u === 'IBC' ||
    u === 'IBY' ||
    u === 'III' ||
    u === 'VAC' ||
    u === 'AVAC' ||
    u === 'VAV' ||
    u === 'UPV' ||
    u === 'PRV' ||
    u === 'MAV' ||
    u === 'DEV' ||
    u === 'JSV' ||
    u === 'TAV' ||
    u === 'SRH' ||
    u === 'SXH'
  );
}
