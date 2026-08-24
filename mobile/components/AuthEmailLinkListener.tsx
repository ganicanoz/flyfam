import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { showAuthLinkResultAlert } from '../lib/authEmailLinkAlerts';
import {
  applySupabaseSessionFromUrl,
  isRecoveryAuthUrl,
  reconcileAuthLinkResult,
} from '../lib/authSessionFromUrl';
import { requestPasswordRecoveryScreen } from '../lib/passwordRecoveryBridge';

const HANDLED_URL_TTL_MS = 12_000;

const handledUrls = new Map<string, number>();
let inFlightUrl: string | null = null;

async function handleAuthDeepLink(url: string | null): Promise<void> {
  if (!url) return;

  const now = Date.now();
  for (const [seenUrl, seenAt] of handledUrls) {
    if (now - seenAt > HANDLED_URL_TTL_MS) handledUrls.delete(seenUrl);
  }
  if (handledUrls.has(url) || inFlightUrl === url) return;

  inFlightUrl = url;
  try {
    if (isRecoveryAuthUrl(url)) requestPasswordRecoveryScreen();
    const result = await reconcileAuthLinkResult(await applySupabaseSessionFromUrl(url));
    if (result.applied && result.recovery) requestPasswordRecoveryScreen();
    handledUrls.set(url, Date.now());
    showAuthLinkResultAlert(result);
  } catch {
    // Sessiz: kullanıcı Giriş ekranından devam edebilir.
  } finally {
    if (inFlightUrl === url) inFlightUrl = null;
  }
}

/** Production: Supabase e-posta doğrulama linki (flyfam://auth/callback) ile oturum. */
export function AuthEmailLinkListener() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    void Linking.getInitialURL().then(handleAuthDeepLink);
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleAuthDeepLink(url);
    });
    return () => sub.remove();
  }, []);

  return null;
}
