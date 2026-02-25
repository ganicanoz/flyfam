import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { registerPushTokenForFamilyUser } from '@/lib/pushNotifications';

export type Profile = {
  id: string;
  role: 'crew' | 'family';
  full_name: string | null;
  phone: string | null;
};

export type CrewProfile = {
  id: string;
  user_id: string;
  company_name: string | null;
  airline_icao: string | null;
  time_preference: string;
};

type SessionContextType = {
  session: Session | null;
  profile: Profile | null;
  crewProfile: CrewProfile | null;
  isLoading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [crewProfile, setCrewProfile] = useState<CrewProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone')
      .eq('id', userId)
      .single();

    if (error) {
      setProfile(null);
      setCrewProfile(null);
      return;
    }
    setProfile(data as Profile);

    if ((data as Profile).role === 'crew') {
      const { data: crew } = await supabase
        .from('crew_profiles')
        .select('id, user_id, company_name, airline_icao, time_preference')
        .eq('user_id', userId)
        .maybeSingle();
      setCrewProfile(crew as CrewProfile | null);
    } else {
      setCrewProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (session?.user?.id) {
      await fetchProfile(session.user.id);
    }
  };

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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user?.id) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setCrewProfile(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Register push token for family users so they receive flight notifications
  const pushRegisteredRef = useRef(false);
  useEffect(() => {
    if (profile?.role !== 'family' || !profile?.id || !session?.user) return;
    let cancelled = false;
    pushRegisteredRef.current = false;
    registerPushTokenForFamilyUser(profile.id).then(() => {
      if (!cancelled) pushRegisteredRef.current = true;
    });
    return () => { cancelled = true; };
  }, [profile?.id, profile?.role, session?.user]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setCrewProfile(null);
  };

  return (
    <SessionContext.Provider
      value={{ session, profile, crewProfile, isLoading, refreshProfile, signOut }}
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
