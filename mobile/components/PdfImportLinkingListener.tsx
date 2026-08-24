import { useEffect, useRef, useCallback } from 'react';
import * as Linking from 'expo-linking';
import { useSession } from '../contexts/SessionContext';
import { navigationRef } from '../navigationRef';
import {
  extractPdfUriFromFlyFamImportUrl,
  isLikelyPdfIncomingUrl,
  savePendingSharedPdfUri,
  takePendingSharedPdfUri,
} from '../lib/sharedPdfImport';

type Props = { navigationReady: boolean };

/**
 * Dosyalar / “FlyFam’da Aç” ve Android PDF VIEW → Linking URL.
 * Oturum yok veya profil tamamlanmamışsa URI kuyrukta kalır; mürettebat hazır olunca AddFlight’a düşer.
 */
export function PdfImportLinkingListener({ navigationReady }: Props) {
  const { session, profile, crewProfile, isLoading } = useSession();
  const initialUrlHandledRef = useRef(false);

  const crewImportReady = !!session && profile?.role === 'crew' && !!crewProfile;

  const openAddFlightImport = useCallback((uri: string) => {
    if (!navigationRef.isReady()) return false;
    navigationRef.navigate('AddFlight', { sharedPdfUri: uri });
    return true;
  }, []);

  useEffect(() => {
    if (isLoading || !navigationReady) return;

    let mounted = true;

    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const sharedFile = extractPdfUriFromFlyFamImportUrl(url);
      const target = sharedFile ?? (isLikelyPdfIncomingUrl(url) ? url : null);
      if (!target) return;
      if (profile?.role === 'family') return;

      if (!crewImportReady) {
        await savePendingSharedPdfUri(target);
        return;
      }
      if (!openAddFlightImport(target)) {
        await savePendingSharedPdfUri(target);
      }
    };

    const flushPending = async () => {
      if (!mounted || !crewImportReady || !navigationRef.isReady()) return;
      if (profile?.role === 'family') return;
      const pending = await takePendingSharedPdfUri();
      if (pending) {
        const resolved =
          extractPdfUriFromFlyFamImportUrl(pending) ?? (isLikelyPdfIncomingUrl(pending) ? pending : null);
        if (resolved) openAddFlightImport(resolved);
      }
    };

    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });

    void (async () => {
      if (!initialUrlHandledRef.current) {
        const initial = await Linking.getInitialURL();
        if (!mounted) return;
        await handleUrl(initial);
        initialUrlHandledRef.current = true;
      }
      if (!mounted) return;
      await flushPending();
    })();

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [isLoading, navigationReady, crewImportReady, profile?.role, openAddFlightImport]);

  return null;
}
