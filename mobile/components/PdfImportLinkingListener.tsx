import { useEffect, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { useSession } from '../contexts/SessionContext';
import { navigationRef } from '../navigationRef';
import {
  extractPdfUriFromFlyFamImportUrl,
  isLikelyPdfIncomingUrl,
  materializeSharedPdfToCache,
  savePendingSharedPdfUri,
  takePendingSharedPdfUri,
} from '../lib/sharedPdfImport';

type Props = { navigationReady: boolean };

/**
 * Dosyalar / “FlyFam’da Aç” ve Android PDF VIEW → Linking URL.
 * Oturum yok veya profil tamamlanmamışsa URI kuyrukta kalır; mürettebat hazır olunca AddFlight’a düşer.
 *
 * Deeplink URI’leri (Share Extension / Inbox / content://) hemen app cache’e
 * kopyalanır — geçici dosya silinmeden önce kalıcı kopya alınır.
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

    const resolveDurableUri = async (rawUri: string): Promise<string | null> => {
      try {
        return await materializeSharedPdfToCache(rawUri);
      } catch (e) {
        if (__DEV__) console.warn('[PDF deeplink] materialize failed', e);
        Alert.alert(
          'PDF aktarılamadı',
          'Paylaşılan dosya okunamadı. Lütfen uygulamadan “PDF’den içe aktar” ile tekrar deneyin.',
        );
        return null;
      }
    };

    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const sharedFile = extractPdfUriFromFlyFamImportUrl(url);
      const target = sharedFile ?? (isLikelyPdfIncomingUrl(url) ? url : null);
      if (!target) return;
      if (profile?.role === 'family') return;

      const durable = await resolveDurableUri(target);
      if (!durable || !mounted) return;

      if (!crewImportReady) {
        await savePendingSharedPdfUri(durable);
        return;
      }
      if (!openAddFlightImport(durable)) {
        await savePendingSharedPdfUri(durable);
      }
    };

    const flushPending = async () => {
      if (!mounted || !crewImportReady || !navigationRef.isReady()) return;
      if (profile?.role === 'family') return;
      const pending = await takePendingSharedPdfUri();
      if (!pending) return;
      // Pending çoğu zaman zaten cache URI; yine de doğrula / gerekirse kopyala.
      const durable = await resolveDurableUri(pending);
      if (durable) openAddFlightImport(durable);
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
