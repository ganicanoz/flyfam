/**
 * Profil: roster liste / takvim görünüm tercihleri.
 * Yeni kodlar: ROSTER_TRAINING_FLIGHT_PREFIXES ve categorizeRosterListRow güncellenir.
 */

export type RosterListShowPrefs = {
  /** true → yalnızca uçuş görevleri (liste + takvim). */
  flights_only: boolean;
  /** Crew roster: yerel (istasyon/TR) + Z; `utc` = yalnızca UTC takvim günü ve Z saatleri. */
  time_display: 'local' | 'utc';
};

export const DEFAULT_ROSTER_LIST_SHOW: RosterListShowPrefs = {
  flights_only: false,
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
  let flights_only = DEFAULT_ROSTER_LIST_SHOW.flights_only;
  if (typeof o.flights_only === 'boolean') {
    flights_only = o.flights_only;
  } else if (
    // Eski çoklu toggle şeması: hepsi kapalıysa “sadece uçuş”a yakın davranış.
    typeof o.off_days === 'boolean' &&
    typeof o.training === 'boolean' &&
    typeof o.simulator === 'boolean' &&
    typeof o.other === 'boolean' &&
    !o.off_days &&
    !o.training &&
    !o.simulator &&
    !o.other
  ) {
    flights_only = true;
  }
  return { flights_only, time_display };
}

export type RosterListRowCategory = 'flight' | 'off_days' | 'training' | 'simulator' | 'other';

type FlightLike = {
  roster_entry_kind?: string | null;
  flight_number: string;
};

export function flightNumberLooksLikeTraining(flightNumber: string): boolean {
  const u = flightNumber.replace(/\s/g, '').toUpperCase();
  if (u.includes('SIM') || u.includes('IPT')) return false;
  if (u.includes('YERDR')) return true;
  return ROSTER_TRAINING_FLIGHT_PREFIXES.some((p) => u === p || u.startsWith(p));
}

/** Uçuş segmenti her zaman flight; filtre dışı. Off-day kodları (MSF vb.) kind flight yazılmış olsa bile off. */
export function categorizeRosterListRow(f: FlightLike): RosterListRowCategory {
  const fn = (f.flight_number || '').replace(/\s/g, '').toUpperCase();
  if (fn.includes('SIM') || fn.includes('IPT')) return 'simulator';
  if (flightNumberLooksLikeTraining(f.flight_number)) return 'training';
  if (
    fn === 'FSF' ||
    fn === 'FOF' ||
    fn === 'MSF' ||
    fn === 'FREE' ||
    fn === 'OFF' ||
    fn === 'OFFB' ||
    fn === 'TOF' ||
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
  if (!prefs.flights_only) return true;
  return categorizeRosterListRow(f) === 'flight';
}
