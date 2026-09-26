/**
 * Offline cold start: last successful profiles + crew_profiles snapshot.
 * Cleared on sign-out / user change.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'flyfam.sessionProfileCache.v1';

export type SessionProfileCache = {
  userId: string;
  profile: Record<string, unknown> & { id: string; role?: string };
  crewProfile: (Record<string, unknown> & { id: string; user_id: string }) | null;
  cachedAt: number;
};

export async function loadSessionProfileCache(userId: string): Promise<SessionProfileCache | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionProfileCache;
    if (!parsed?.userId || parsed.userId !== userId || !parsed.profile?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSessionProfileCache(params: {
  userId: string;
  profile: SessionProfileCache['profile'];
  crewProfile: SessionProfileCache['crewProfile'];
}): Promise<void> {
  const payload: SessionProfileCache = {
    userId: params.userId,
    profile: params.profile,
    crewProfile: params.crewProfile,
    cachedAt: Date.now(),
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export async function clearSessionProfileCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
