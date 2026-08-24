import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeRosterListShow, type RosterListShowPrefs } from './rosterListPreferences';

function storageKey(userId: string): string {
  return `flyfam:roster_list_show:${userId}`;
}

export async function loadFamilyRosterListShow(userId: string): Promise<RosterListShowPrefs> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return normalizeRosterListShow(null);
    return normalizeRosterListShow(JSON.parse(raw));
  } catch {
    return normalizeRosterListShow(null);
  }
}

export async function saveFamilyRosterListShow(userId: string, prefs: RosterListShowPrefs): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(prefs));
}
