import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type AdminRosterContextValue = {
  adminRosterMode: boolean;
  setAdminRosterMode: (v: boolean) => void;
  isAdminUser: boolean;
  /** Aile başlığı gizli dokunuşu; 5 seri dokunuşta (3 sn) modu toggle eder, true → Roster’a geç. */
  onAdminSecretTap: () => boolean;
};

const AdminRosterContext = createContext<AdminRosterContextValue | null>(null);

const SECRET_TAP_WINDOW_MS = 3000;
const SECRET_TAPS_REQUIRED = 5;

export function AdminRosterProvider({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail: string | null | undefined;
}) {
  const [adminRosterMode, setAdminRosterMode] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    let active = true;
    setIsAdminUser(false);
    if (!userEmail) return () => { active = false; };
    void supabase.functions
      .invoke('admin-dashboard', { body: { action: 'check_access' } })
      .then(({ data, error }) => {
        if (active) setIsAdminUser(!error && data?.ok === true);
      })
      .catch(() => {
        if (active) setIsAdminUser(false);
      });
    return () => { active = false; };
  }, [userEmail]);

  const tapRef = useRef({ count: 0, timeout: null as ReturnType<typeof setTimeout> | null });

  const onAdminSecretTap = useCallback(() => {
    if (!isAdminUser) return false;
    tapRef.current.count += 1;
    if (tapRef.current.timeout) clearTimeout(tapRef.current.timeout);
    tapRef.current.timeout = setTimeout(() => {
      tapRef.current.count = 0;
      tapRef.current.timeout = null;
    }, SECRET_TAP_WINDOW_MS);
    if (tapRef.current.count >= SECRET_TAPS_REQUIRED) {
      tapRef.current.count = 0;
      if (tapRef.current.timeout) {
        clearTimeout(tapRef.current.timeout);
        tapRef.current.timeout = null;
      }
      setAdminRosterMode((p) => !p);
      return true;
    }
    return false;
  }, [isAdminUser]);

  useEffect(() => {
    if (!isAdminUser) setAdminRosterMode(false);
  }, [isAdminUser]);

  const value = useMemo(
    () => ({
      adminRosterMode,
      setAdminRosterMode,
      isAdminUser,
      onAdminSecretTap,
    }),
    [adminRosterMode, isAdminUser, onAdminSecretTap]
  );

  return <AdminRosterContext.Provider value={value}>{children}</AdminRosterContext.Provider>;
}

export function useAdminRoster(): AdminRosterContextValue {
  const ctx = useContext(AdminRosterContext);
  if (!ctx) {
    throw new Error('useAdminRoster must be used within AdminRosterProvider');
  }
  return ctx;
}
