import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAirportDisplay } from '../constants/airports';
import type { PdfFlightRow } from './pdfRosterImport';
import type { SupabaseClient } from '@supabase/supabase-js';

function dismissedKey(userId: string): string {
  return `flyfam.homeBasePrompt.dismissed.v1:${userId}`;
}

function normalizeIata(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

function airportCityKey(iata: string | null | undefined): string | null {
  const code = normalizeIata(iata);
  if (!code) return null;
  const city = getAirportDisplay(code)?.city?.trim().toLowerCase();
  return city || code.toLowerCase();
}

/** Most frequent origin IATA among real flight legs in an imported roster. */
export function mostFrequentOriginIata(rows: readonly PdfFlightRow[]): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if ((row.roster_entry_kind ?? 'flight') !== 'flight') continue;
    const origin = normalizeIata(row.origin_iata);
    if (origin.length < 3) continue;
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts.entries()) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

export function isSameHomeBaseCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const cityA = airportCityKey(a);
  const cityB = airportCityKey(b);
  if (!cityA || !cityB) return normalizeIata(a) === normalizeIata(b) && Boolean(normalizeIata(a));
  return cityA === cityB;
}

type PromptCopy = {
  title: string;
  message: (iata: string, city: string | null) => string;
  yes: string;
  no: string;
};

/**
 * After a roster import: if the most-flown origin city differs from stored home base,
 * ask whether to switch. "No" suppresses the same IATA until a different one is detected.
 */
export async function maybePromptHomeBaseAfterRosterImport(params: {
  userId: string;
  crewProfileId: string;
  currentHomeBaseIata: string | null | undefined;
  importedRows: readonly PdfFlightRow[];
  supabase: SupabaseClient;
  refreshProfile: () => Promise<void>;
  copy: PromptCopy;
}): Promise<void> {
  const detected = mostFrequentOriginIata(params.importedRows);
  if (!detected) return;
  if (isSameHomeBaseCity(detected, params.currentHomeBaseIata)) return;

  const dismissed = (await AsyncStorage.getItem(dismissedKey(params.userId)))?.trim().toUpperCase() ?? '';
  if (dismissed && dismissed === detected) return;

  const city = getAirportDisplay(detected)?.city?.trim() || null;

  await new Promise<void>((resolve) => {
    Alert.alert(params.copy.title, params.copy.message(detected, city), [
      {
        text: params.copy.no,
        style: 'cancel',
        onPress: () => {
          void AsyncStorage.setItem(dismissedKey(params.userId), detected).finally(() => resolve());
        },
      },
      {
        text: params.copy.yes,
        onPress: () => {
          void (async () => {
            const { error } = await params.supabase
              .from('crew_profiles')
              .update({
                home_base_iata: detected,
                home_base_city: city,
              })
              .eq('id', params.crewProfileId);
            if (!error) {
              await AsyncStorage.removeItem(dismissedKey(params.userId));
              await params.refreshProfile();
            }
            resolve();
          })();
        },
      },
    ]);
  });
}
