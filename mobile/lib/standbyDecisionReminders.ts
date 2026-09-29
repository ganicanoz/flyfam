/**
 * Crew: CFR / rezerv tebliğ saati yerel hatırlatması (cihazda zamanlanır, sunucu yok).
 * CFR → görev gününden bir önceki gün 02:00Z; rezerv → görev başlangıcından 10 saat önce.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { FAMILY_PUSH_SOUND } from './notificationSounds';

const ID_PREFIX = 'standby-decision:';
const DATA_KIND = 'standby_decision';
/** iOS en fazla 64 bekleyen yerel bildirim tutar; diğer özelliklere yer bırak. */
const MAX_SCHEDULED = 30;
const HORIZON_MS = 45 * 24 * 60 * 60 * 1000;

export type StandbyDecisionEntry = {
  id: string;
  flight_number?: string | null;
  flight_date?: string | null;
  scheduled_departure?: string | null;
  roster_entry_kind?: string | null;
};

type Translate = (key: string, opts?: Record<string, unknown>) => string;

function normalizeCode(code: string | null | undefined): string {
  return (code || '').replace(/\s/g, '').toUpperCase();
}

function isReserveCode(u: string): boolean {
  return /^RSV\d*$/.test(u) || u === 'RZV' || u === 'RZVM';
}

function addUtcDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function decisionAtMs(entry: StandbyDecisionEntry): { atMs: number; kind: 'cfr' | 'reserve' } | null {
  if (entry.roster_entry_kind !== 'duty_off') return null;
  const code = normalizeCode(entry.flight_number);
  if (code === 'CFR') {
    const ymd = (entry.flight_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const atMs = Date.parse(`${addUtcDays(ymd, -1)}T02:00:00Z`);
    return Number.isFinite(atMs) ? { atMs, kind: 'cfr' } : null;
  }
  if (isReserveCode(code)) {
    const startMs = Date.parse(entry.scheduled_departure || '');
    if (!Number.isFinite(startMs) || startMs <= 0) return null;
    return { atMs: startMs - 10 * 60 * 60 * 1000, kind: 'reserve' };
  }
  return null;
}

async function listOwnScheduled(): Promise<Notifications.NotificationRequest[]> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.filter((r) => r.identifier.startsWith(ID_PREFIX));
}

export async function cancelStandbyDecisionReminders(): Promise<void> {
  try {
    const own = await listOwnScheduled();
    await Promise.all(own.map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)));
  } catch {
    /* bildirim modülü yoksa sessiz geç */
  }
}

/** İzin istemez; izin yoksa hiçbir şey zamanlamaz. Mevcut hatırlatmaları roster ile eşitler. */
export async function syncStandbyDecisionReminders(
  entries: readonly StandbyDecisionEntry[],
  t: Translate,
): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const nowMs = Date.now();
    const desired = new Map<string, { atMs: number; kind: 'cfr' | 'reserve' }>();
    for (const e of entries) {
      if (!e?.id) continue;
      const d = decisionAtMs(e);
      if (!d) continue;
      if (d.atMs <= nowMs + 60_000 || d.atMs > nowMs + HORIZON_MS) continue;
      desired.set(`${ID_PREFIX}${e.id}`, d);
    }
    const limited = new Map(
      [...desired.entries()].sort((a, b) => a[1].atMs - b[1].atMs).slice(0, MAX_SCHEDULED),
    );

    const textFor = (kind: 'cfr' | 'reserve') => {
      const duty = kind === 'cfr' ? 'CFR' : t('roster.statusReserve');
      return {
        title: t('roster.standbyDecisionReminderTitle', { duty }),
        body: t('roster.standbyDecisionReminderBody', { duty }),
      };
    };

    const own = await listOwnScheduled();
    const keep = new Set<string>();
    for (const r of own) {
      const want = limited.get(r.identifier);
      const data = r.content.data as { atMs?: unknown; kind?: unknown } | undefined;
      if (
        want &&
        data?.atMs === want.atMs &&
        data?.kind === want.kind &&
        r.content.body === textFor(want.kind).body
      ) {
        keep.add(r.identifier);
      } else {
        await Notifications.cancelScheduledNotificationAsync(r.identifier);
      }
    }

    for (const [identifier, d] of limited) {
      if (keep.has(identifier)) continue;
      const { title, body } = textFor(d.kind);
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title,
          body,
          sound: 'default',
          data: { type: DATA_KIND, kind: d.kind, atMs: d.atMs },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: d.atMs,
          ...(Platform.OS === 'android' ? { channelId: FAMILY_PUSH_SOUND.default.channelId } : {}),
        },
      });
    }
  } catch (e) {
    if (__DEV__) console.warn('[StandbyDecisionReminders]', e instanceof Error ? e.message : String(e));
  }
}
