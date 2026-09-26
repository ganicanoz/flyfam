import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { registerPushTokenForUser, installPushUrlOpenHandler } from '@/lib/pushNotifications';
import { triggerAirportBoardCacheRefreshIfDue } from '@/lib/airportBoardCache';
import { applyStoredOrProfileLocale, getStoredLocale, type Locale } from '@/lib/i18n';
import { registerPasswordRecoveryHandler } from '@/lib/passwordRecoveryBridge';
import type { RosterListShowPrefs } from '@/lib/rosterListPreferences';
import { trackAppOpenThrottled } from '@/lib/userActivity';
import { clearConsentOkCache } from '@/lib/consents';
import {
  clearSessionProfileCache,
  loadSessionProfileCache,
  saveSessionProfileCache,
} from '@/lib/sessionProfileCache';
import { clearRosterLocalCacheForUser } from '@/lib/rosterLocalCache';
import { clearRosterAccessCacheForUser } from '@/lib/rosterAccessCache';

export type Profile = {
  id: string;
  role: 'crew' | 'family';
  full_name: string | null;
  phone: string | null;
  avatar_url?: string | null;
  locale?: Locale | null;
  /** Aile: uçuş saatlerini bu IANA bölgede göster (yoksa cihaz TZ). */
  timezone_iana?: string | null;
};

export type CrewProfile = {
  id: string;
  user_id: string;
  company_name: string | null;
  airline_icao: string | null;
  home_base_iata: string | null;
  home_base_city: string | null;
  time_preference: string;
  roster_list_show?: RosterListShowPrefs | null;
};

type SessionContextType = {
  session: Session | null;
  profile: Profile | null;
  crewProfile: CrewProfile | null;
  isLoading: boolean;
  /** True when profile came from disk because network profile fetch failed/pending. */
  profileFromCache: boolean;
  needsPasswordUpdate: boolean;
  clearPasswordRecovery: () => void;
  refreshProfile: () => Promise<void>;
  /** Optimistic local patch (e.g. roster_list_show) — avoids full profile refetch jank. */
  patchCrewProfile: (partial: Partial<CrewProfile>) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

function crewProfileSelectErrorMissingRosterShow(msg: string | undefined): boolean {
  return (msg || '').toLowerCase().includes('roster_list_show');
}

function crewProfileSelectErrorMissingHomeBase(msg: string | undefined): boolean {
  const m = (msg || '').toLowerCase();
  return m.includes('home_base_iata') || m.includes('home_base_city');
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [crewProfile, setCrewProfile] = useState<CrewProfile | null>(null);
  const [profileFromCache, setProfileFromCache] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [needsPasswordUpdate, setNeedsPasswordUpdate] = useState(false);
  const profileRef = useRef<Profile | null>(null);
  const crewProfileRef = useRef<CrewProfile | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    crewProfileRef.current = crewProfile;
  }, [crewProfile]);

  const applyCachedProfile = async (userId: string): Promise<boolean> => {
    const cached = await loadSessionProfileCache(userId);
    if (!cached) return false;
    setProfile(cached.profile as Profile);
    setCrewProfile(cached.crewProfile as CrewProfile | null);
    setProfileFromCache(true);
    applyStoredOrProfileLocale((cached.profile as Profile).locale).catch(() => {});
    return true;
  };

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone, avatar_url, locale, timezone_iana')
      .eq('id', userId)
      .single();

    if (error) {
      // Offline / transient: keep in-memory or disk cache — do not wipe to null.
      if (profileRef.current?.id === userId) return;
      const hadCache = await applyCachedProfile(userId);
      if (!hadCache && !profileRef.current) {
        // No cache at all — leave null (CompleteProfile / splash timeout handles).
      }
      return;
    }
    const profileData = data as Profile;
    applyStoredOrProfileLocale(profileData.locale).catch(() => {});
    if (!profileData.locale) {
      getStoredLocale().then(async (stored) => {
        if (stored) {
          await supabase.from('profiles').update({ locale: stored }).eq('id', userId);
          setProfile((prev) => (prev ? { ...prev, locale: stored } : null));
        }
      });
    }

    if ((data as Profile).role === 'crew') {
      let crewRow: CrewProfile | null = null;
      const full = await supabase
        .from('crew_profiles')
        .select('id, user_id, company_name, airline_icao, home_base_iata, home_base_city, time_preference, roster_list_show')
        .eq('user_id', userId)
        .maybeSingle();
      if (full.error && crewProfileSelectErrorMissingRosterShow(full.error.message)) {
        // roster_list_show yoksa home_base’i null’lama — aksi halde SAW üs yatıları şişer.
        const withHome = await supabase
          .from('crew_profiles')
          .select('id, user_id, company_name, airline_icao, home_base_iata, home_base_city, time_preference')
          .eq('user_id', userId)
          .maybeSingle();
        crewRow = withHome.data
          ? ({ ...withHome.data, roster_list_show: null } as CrewProfile)
          : null;
      } else if (full.error && crewProfileSelectErrorMissingHomeBase(full.error.message)) {
        const basic = await supabase
          .from('crew_profiles')
          .select('id, user_id, company_name, airline_icao, time_preference')
          .eq('user_id', userId)
          .maybeSingle();
        crewRow = basic.data
          ? ({ ...basic.data, home_base_iata: null, home_base_city: null, roster_list_show: null } as CrewProfile)
          : null;
      } else if (!full.error) {
        crewRow = full.data as CrewProfile | null;
      } else {
        // Crew fetch failed (offline): keep cached crew if same user.
        if (crewProfileRef.current?.user_id === userId) {
          crewRow = crewProfileRef.current;
        } else {
          const cached = await loadSessionProfileCache(userId);
          crewRow = (cached?.crewProfile as CrewProfile | null) ?? null;
        }
      }
      // Set crew + profile together to avoid transient CompleteProfile flicker.
      setCrewProfile(crewRow);
      setProfile(profileData);
      setProfileFromCache(false);
      void saveSessionProfileCache({ userId, profile: profileData, crewProfile: crewRow });
    } else {
      setCrewProfile(null);
      setProfile(profileData);
      setProfileFromCache(false);
      void saveSessionProfileCache({ userId, profile: profileData, crewProfile: null });
    }
  };

  const refreshProfile = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user?.id) {
      await fetchProfile(s.user.id);
    }
  };

  const patchCrewProfile = (partial: Partial<CrewProfile>) => {
    setCrewProfile((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      const uid = session?.user?.id ?? prev.user_id;
      const p = profileRef.current;
      if (uid && p) void saveSessionProfileCache({ userId: uid, profile: p, crewProfile: next });
      return next;
    });
  };

  useEffect(() => {
    return registerPasswordRecoveryHandler(setNeedsPasswordUpdate);
  }, []);

  useEffect(() => {
    return installPushUrlOpenHandler();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: { session: s }, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          // Transient storage/network glitch: do not signOut (that clears JWT and forces login).
          // If AsyncStorage still has a session, getSession usually succeeds offline.
          setIsLoading(false);
          return;
        }

        setSession(s);
        if (s?.user?.id) {
          // Hydrate disk profile first so MainTabs can open offline.
          await applyCachedProfile(s.user.id);
          if (cancelled) return;
          setIsLoading(false);
          void fetchProfile(s.user.id);
        } else {
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setNeedsPasswordUpdate(true);
      }
      if (nextSession?.user?.id) {
        setSession(nextSession);
        void (async () => {
          await applyCachedProfile(nextSession.user!.id);
          setIsLoading(false);
          await fetchProfile(nextSession.user!.id);
        })();
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setProfile(null);
        setCrewProfile(null);
        setProfileFromCache(false);
        setIsLoading(false);
        void clearSessionProfileCache();
        void clearConsentOkCache();
      } else {
        // e.g. failed token refresh offline — keep existing session/profile.
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Safety net: if something goes wrong fetching session/profile (ör. ağ çok yavaş),
  // uygulama splash ekranda takılı kalmasın. Birkaç saniye sonra yine de ilerlesin.
  useEffect(() => {
    if (!isLoading) return;
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [isLoading]);

  // Hub Dep+Arr tahtaları → AsyncStorage: girişte + ön plana dönünce (≥12 saat veya slot/gün değişince yenilenir).
  useEffect(() => {
    if (!session?.user?.id || !profile) return;
    triggerAirportBoardCacheRefreshIfDue();
    void trackAppOpenThrottled(profile.id);
  }, [session?.user?.id, profile?.id]);

  useEffect(() => {
    if (!session?.user?.id || !profile) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        triggerAirportBoardCacheRefreshIfDue();
        void trackAppOpenThrottled(profile.id);
      }
    });
    return () => sub.remove();
  }, [session?.user?.id, profile?.id]);

  // Register push token for signed-in users (crew + family) for admin device/version visibility.
  const pushRegisteredRef = useRef(false);
  useEffect(() => {
    if (!profile?.id || !session?.user) return;
    let cancelled = false;
    pushRegisteredRef.current = false;
    registerPushTokenForUser(profile.id).then(() => {
      if (!cancelled) pushRegisteredRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.role, session?.user]);

  const clearPasswordRecovery = () => setNeedsPasswordUpdate(false);

  const signOut = async () => {
    const uid = session?.user?.id ?? profile?.id ?? null;
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setCrewProfile(null);
    setProfileFromCache(false);
    setNeedsPasswordUpdate(false);
    void clearSessionProfileCache();
    void clearConsentOkCache();
    if (uid) {
      void clearRosterLocalCacheForUser(uid);
      void clearRosterAccessCacheForUser(uid);
    }
  };

  return (
    <SessionContext.Provider
      value={{
        session,
        profile,
        crewProfile,
        isLoading,
        profileFromCache,
        needsPasswordUpdate,
        clearPasswordRecovery,
        refreshProfile,
        patchCrewProfile,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
