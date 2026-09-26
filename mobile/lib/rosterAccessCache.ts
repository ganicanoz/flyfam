/**
 * Last known roster entitlement for offline peer/family views.
 * Keyed by viewer userId + subject (peer crew / family self).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CrewRosterAccess, SubscriptionAccess } from './subscriptionAccess';

const PREFIX = 'flyfam.rosterAccessCache.v1:';
const INDEX_KEY = 'flyfam.rosterAccessCache.v1.index';

export type RosterAccessCachePayload = {
  userId: string;
  subjectKey: string;
  savedAt: number;
  kind: 'crew_roster' | 'my_subscription';
  crewRoster?: CrewRosterAccess;
  mySubscription?: SubscriptionAccess;
};

function storageKey(userId: string, subjectKey: string): string {
  return `${PREFIX}${userId}:${subjectKey}`;
}

async function rememberKey(userId: string, subjectKey: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const list = Array.isArray(map[userId]) ? map[userId]! : [];
    if (!list.includes(subjectKey)) {
      map[userId] = [...list, subjectKey];
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(map));
    }
  } catch {
    /* ignore */
  }
}

export async function saveCrewRosterAccessCache(params: {
  userId: string;
  peerCrewId: string;
  access: CrewRosterAccess;
}): Promise<void> {
  const subjectKey = `peer:${params.peerCrewId}`;
  const payload: RosterAccessCachePayload = {
    userId: params.userId,
    subjectKey,
    savedAt: Date.now(),
    kind: 'crew_roster',
    crewRoster: params.access,
  };
  try {
    await AsyncStorage.setItem(storageKey(params.userId, subjectKey), JSON.stringify(payload));
    await rememberKey(params.userId, subjectKey);
  } catch {
    /* ignore */
  }
}

export async function loadCrewRosterAccessCache(
  userId: string,
  peerCrewId: string,
): Promise<CrewRosterAccess | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, `peer:${peerCrewId}`));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RosterAccessCachePayload;
    if (!parsed?.crewRoster || parsed.userId !== userId) return null;
    return parsed.crewRoster;
  } catch {
    return null;
  }
}

export async function saveMySubscriptionAccessCache(params: {
  userId: string;
  access: SubscriptionAccess;
}): Promise<void> {
  const subjectKey = 'family:self';
  const payload: RosterAccessCachePayload = {
    userId: params.userId,
    subjectKey,
    savedAt: Date.now(),
    kind: 'my_subscription',
    mySubscription: params.access,
  };
  try {
    await AsyncStorage.setItem(storageKey(params.userId, subjectKey), JSON.stringify(payload));
    await rememberKey(params.userId, subjectKey);
  } catch {
    /* ignore */
  }
}

export async function loadMySubscriptionAccessCache(
  userId: string,
): Promise<SubscriptionAccess | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, 'family:self'));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RosterAccessCachePayload;
    if (!parsed?.mySubscription || parsed.userId !== userId) return null;
    return parsed.mySubscription;
  } catch {
    return null;
  }
}

export async function clearRosterAccessCacheForUser(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const list = Array.isArray(map[userId]) ? map[userId]! : [];
    const keys = list.map((s) => storageKey(userId, s));
    if (keys.length) await AsyncStorage.multiRemove(keys);
    delete map[userId];
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
