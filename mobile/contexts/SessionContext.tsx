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
  needsPasswordUpdate: boolean;
  clearPasswordRecovery: () => void;
  refreshProfile: () => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(true);
  const [needsPasswordUpdate, setNeedsPasswordUpdate] = useState(false);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone, avatar_url, locale, timezone_iana')
      .eq('id', userId)
      .single();

    if (error) {
      setProfile(null);
      setCrewProfile(null);
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
      if (
        full.error &&
        (crewProfileSelectErrorMissingRosterShow(full.error.message) ||
          crewProfileSelectErrorMissingHomeBase(full.error.message))
      ) {
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
        crewRow = null;
      }
      // Set crew + profile together to avoid transient CompleteProfile flicker.
      setCrewProfile(crewRow);
      setProfile(profileData);
    } else {
      setCrewProfile(null);
      setProfile(profileData);
    }
  };

  const refreshProfile = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user?.id) {
      await fetchProfile(s.user.id);
    }
  };

  useEffect(() => {
    return registerPasswordRecoveryHandler(setNeedsPasswordUpdate);
  }, []);

  useEffect(() => {
    return installPushUrlOpenHandler();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setSession(null);
        setProfile(null);
        setCrewProfile(null);
        setIsLoading(false);
        supabase.auth.signOut();
        return;
      }
      setSession(session);
      if (session?.user?.id) {
        fetchProfile(session.user.id).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    }).catch(() => {
      setSession(null);
      setProfile(null);
      setCrewProfile(null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setNeedsPasswordUpdate(true);
      }
      setSession(session);
      if (session?.user?.id) {
        fetchProfile(session.user.id).finally(() => setIsLoading(false));
      } else {
        setProfile(null);
        setCrewProfile(null);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
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
    return () => { cancelled = true; };
  }, [profile?.id, profile?.role, session?.user]);

  const clearPasswordRecovery = () => setNeedsPasswordUpdate(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setCrewProfile(null);
    setNeedsPasswordUpdate(false);
  };

  return (
    <SessionContext.Provider
      value={{
        session,
        profile,
        crewProfile,
        isLoading,
        needsPasswordUpdate,
        clearPasswordRecovery,
        refreshProfile,
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
