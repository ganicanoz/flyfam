import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/** Approved crew-to-crew roster links hydrated from the server. */

export type DemoCrewPeer = {
  id: string;
  peerCrewId: string;
  name: string;
  airline: string;
  icao: string;
};

const DISMISSED_PEERS_KEY = 'flyfam.dismissed_crew_peers.v1';

let dismissedPeerIds = new Set<string>();
const dismissedListeners = new Set<() => void>();
/** userId → approved peers from DB */
let dbPeersByUserId = new Map<string, DemoCrewPeer[]>();
const peersListeners = new Set<() => void>();

function notifyDismissedPeersChanged() {
  dismissedListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore subscriber errors
    }
  });
}

function notifyPeersChanged() {
  peersListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
  notifyDismissedPeersChanged();
}

export function subscribeDismissedPeers(listener: () => void): () => void {
  dismissedListeners.add(listener);
  return () => {
    dismissedListeners.delete(listener);
  };
}

export function subscribeCrewPeers(listener: () => void): () => void {
  peersListeners.add(listener);
  return () => {
    peersListeners.delete(listener);
  };
}

export async function hydrateDismissedPeers(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_PEERS_KEY);
    if (!raw) {
      dismissedPeerIds = new Set();
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    dismissedPeerIds = new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    );
  } catch {
    dismissedPeerIds = new Set();
  }
}

export async function hydrateCrewPeersFromServer(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const { data, error } = await supabase.rpc('get_my_approved_crew_peers');
  if (error) {
    console.warn('[crewPeers] hydrate failed', error.message);
    return;
  }
  const rows = (data ?? []) as Array<{
    link_id: string;
    peer_crew_id: string;
    peer_user_id: string | null;
    peer_full_name: string | null;
    company_name: string | null;
    airline_icao: string | null;
  }>;
  const mapped: DemoCrewPeer[] = rows.map((r) => ({
    id: `db-peer-${r.link_id}`,
    peerCrewId: r.peer_crew_id,
    name: (r.peer_full_name || r.company_name || r.airline_icao || 'Crew').trim(),
    airline: (r.company_name || r.airline_icao || '').trim() || '—',
    icao: (r.airline_icao || '').trim().toUpperCase(),
  }));
  dbPeersByUserId.set(userId, mapped);
  notifyPeersChanged();
}

export async function dismissDemoPeer(peerId: string): Promise<void> {
  if (!peerId || dismissedPeerIds.has(peerId)) return;
  dismissedPeerIds = new Set(dismissedPeerIds);
  dismissedPeerIds.add(peerId);
  notifyDismissedPeersChanged();
  try {
    await AsyncStorage.setItem(DISMISSED_PEERS_KEY, JSON.stringify([...dismissedPeerIds]));
  } catch {
    // ignore persist errors; in-memory dismiss still applies this session
  }
}

export function demoPeersForUser(userId: string | null | undefined): DemoCrewPeer[] {
  if (!userId) return [];
  const fromDb = dbPeersByUserId.get(userId) ?? [];
  return fromDb.filter((p) => !dismissedPeerIds.has(p.id));
}

/** Avatar/chip initials derived from the approved peer display name. */
export function peerInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
}

/** Compact tab label derived from the approved peer display name. */
export function peerTabShortLabel(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const one = parts[0]!;
    return one.length > 8 ? `${one.slice(0, 7)}.` : one;
  }
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

/** Tab badge: tek kelime kısaysa isim, değilse baş harf. */
export function peerTabBadgeLabel(fullName: string): { initial: string; shortName: string } {
  return {
    initial: peerInitials(fullName),
    shortName: peerTabShortLabel(fullName),
  };
}
