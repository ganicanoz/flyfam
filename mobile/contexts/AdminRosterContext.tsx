import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isAdminEmail } from '../lib/isAdminUser';

type AdminRosterContextValue = {
  adminRosterMode: boolean;
  setAdminRosterMode: (v: boolean) => void;
  isAdminUser: boolean;
  /** Profil gizli dokunuşu; 5 seri dokunuşta modu toggle eder, true dönerse Roster sekmesine geç. */
  onProfileSecretTap: () => boolean;
};

const AdminRosterContext = createContext<AdminRosterContextValue | null>(null);

const SECRET_TAP_WINDOW_MS = 2600;
const SECRET_TAPS_REQUIRED = 5;

export function AdminRosterProvider({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail: string | null | undefined;
}) {
  const [adminRosterMode, setAdminRosterMode] = useState(false);
  const isAdminUser = useMemo(() => isAdminEmail(userEmail), [userEmail]);

  const tapRef = useRef({ count: 0, timeout: null as ReturnType<typeof setTimeout> | null });

  const onProfileSecretTap = useCallback(() => {
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
      onProfileSecretTap,
    }),
    [adminRosterMode, isAdminUser, onProfileSecretTap]
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
