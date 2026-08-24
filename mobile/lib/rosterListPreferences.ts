/**
 * Profil: uçuş listesinde hangi görev satırlarının gösterileceği.
 * Yeni kodlar: ROSTER_TRAINING_FLIGHT_PREFIXES ve categorizeRosterListRow güncellenir.
 */

export type RosterListShowPrefs = {
  off_days: boolean;
  training: boolean;
  simulator: boolean;
  other: boolean;
  /** Crew roster: yerel (istasyon/TR) + Z; `utc` = yalnızca UTC takvim günü ve Z saatleri. */
  time_display: 'local' | 'utc';
};

export const DEFAULT_ROSTER_LIST_SHOW: RosterListShowPrefs = {
  off_days: true,
  training: true,
  simulator: true,
  other: true,
  time_display: 'local',
};

/** PDF/DB’den gelen eğitim benzeri flight_number önekleri (genişletilebilir). SIM/IPT ayrı simulator dalında. */
export const ROSTER_TRAINING_FLIGHT_PREFIXES: string[] = [
  'TRAINING',
  'TRN',
  'EGT',
  'CRM',
  'REC',
  'LND',
  'GND',
  'YERDR',
  'OPC', // OPC3-SIM → ayrıca SIM içerdiği için simulator sayılır
  'SDM', // Safety Department Meeting — eğitim sınıfı / toplantı
  'MEET',
  'SEM',
  /** Ofis görevleri — yer dersi ile aynı görünüm sınıfı */
  'GOA',
  'OSA',
  'G3A',
  'G4A',
  'O1A',
  'O2A',
  'ADB',
  'AYT',
  'ECN',
  'ESB',
];

export function normalizeRosterListShow(raw: unknown): RosterListShowPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ROSTER_LIST_SHOW };
  const o = raw as Record<string, unknown>;
  const td = o.time_display;
  const time_display =
    td === 'utc' || td === 'local' ? td : DEFAULT_ROSTER_LIST_SHOW.time_display;
  return {
    off_days: typeof o.off_days === 'boolean' ? o.off_days : DEFAULT_ROSTER_LIST_SHOW.off_days,
    training: typeof o.training === 'boolean' ? o.training : DEFAULT_ROSTER_LIST_SHOW.training,
    simulator: typeof o.simulator === 'boolean' ? o.simulator : DEFAULT_ROSTER_LIST_SHOW.simulator,
    other: typeof o.other === 'boolean' ? o.other : DEFAULT_ROSTER_LIST_SHOW.other,
    time_display,
  };
}

export type RosterListRowCategory = 'flight' | 'off_days' | 'training' | 'simulator' | 'other';

type FlightLike = {
  roster_entry_kind?: string | null;
  flight_number: string;
};

export function flightNumberLooksLikeTraining(flightNumber: string): boolean {
  const u = flightNumber.replace(/\s/g, '').toUpperCase();
  if (u.includes('SIM') || u === 'IPT' || /^IPT[A-Z0-9_-]*$/.test(u)) return false;
  if (u.includes('YERDR')) return true;
  return ROSTER_TRAINING_FLIGHT_PREFIXES.some((p) => u === p || u.startsWith(p));
}

/** Uçuş segmenti her zaman flight; filtre dışı. Off-day kodları (MSF vb.) kind flight yazılmış olsa bile off. */
export function categorizeRosterListRow(f: FlightLike): RosterListRowCategory {
  const fn = (f.flight_number || '').replace(/\s/g, '').toUpperCase();
  if (fn.includes('SIM') || fn === 'IPT' || /^IPT[A-Z0-9_-]*$/.test(fn)) return 'simulator';
  if (flightNumberLooksLikeTraining(f.flight_number)) return 'training';
  if (
    fn === 'FSF' ||
    fn === 'FOF' ||
    fn === 'MSF' ||
    fn === 'FREE' ||
    fn === 'OFF' ||
    fn === 'DOFF' ||
    fn === 'RQST' ||
    fn === 'VAC' ||
    fn === 'VAV' ||
    fn === 'AVAC' ||
    fn === 'III'
  ) {
    return 'off_days';
  }
  const kind = f.roster_entry_kind ?? 'flight';
  if (kind === 'flight' || kind === '' || kind == null) return 'flight';
  if (kind === 'sim') return 'simulator';
  if (kind === 'duty_off') return 'other';
  return 'other';
}

export function rosterListRowVisible(f: FlightLike, prefs: RosterListShowPrefs): boolean {
  const cat = categorizeRosterListRow(f);
  if (cat === 'flight') return true;
  if (cat === 'off_days') return prefs.off_days;
  if (cat === 'training') return prefs.training;
  if (cat === 'simulator') return prefs.simulator;
  return prefs.other;
}
