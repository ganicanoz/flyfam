import type { AuthError, EmailOtpType } from '@supabase/supabase-js';
import { supabase } from './supabase';

const NETWORK_RETRY_DELAYS_MS = [0, 500, 1500] as const;
const SESSION_SETTLE_MS = 1600;
const SESSION_POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(message?: string): boolean {
  const lower = (message ?? '').toLowerCase();
  return (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network connection was lost') ||
    lower.includes('could not connect') ||
    lower.includes('internet connection appears to be offline') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound')
  );
}

async function hasAuthSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session?.access_token);
}

async function waitForAuthSession(timeoutMs = SESSION_SETTLE_MS): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await hasAuthSession()) return true;
    await sleep(SESSION_POLL_MS);
  }
  return false;
}

async function runAuthStepWithRetry(
  step: () => Promise<{ error: AuthError | null }>
): Promise<{ error: AuthError | null; sessionEstablished: boolean }> {
  let lastError: AuthError | null = null;

  for (const delayMs of NETWORK_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    const { error } = await step();
    if (!error) return { error: null, sessionEstablished: true };
    lastError = error;
    if (!isNetworkError(error.message)) break;
    if (await hasAuthSession()) return { error: null, sessionEstablished: true };
  }

  if (lastError && isNetworkError(lastError.message)) {
    if (await waitForAuthSession()) {
      return { error: null, sessionEstablished: true };
    }
  }

  return { error: lastError, sessionEstablished: false };
}

function parseAuthParams(url: string): {
  access_token?: string;
  refresh_token?: string;
  code?: string;
  type?: string;
  token_hash?: string;
  error?: string;
  error_code?: string;
} {
  const hashIdx = url.indexOf('#');
  const queryIdx = url.indexOf('?');
  const paramStr =
    hashIdx >= 0
      ? url.slice(hashIdx + 1)
      : queryIdx >= 0
        ? url.slice(queryIdx + 1).split('#')[0]
        : '';
  if (!paramStr) return {};
  const params = new URLSearchParams(paramStr);
  return {
    access_token: params.get('access_token') ?? undefined,
    refresh_token: params.get('refresh_token') ?? undefined,
    code: params.get('code') ?? undefined,
    type: params.get('type') ?? undefined,
    token_hash: params.get('token_hash') ?? undefined,
    error: params.get('error_description') ?? params.get('error') ?? undefined,
    error_code: params.get('error_code') ?? undefined,
  };
}

export function isRecoveryAuthUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes('type=recovery')) return true;
  const { type } = parseAuthParams(url);
  return type === 'recovery';
}

function isSignupOrEmailVerificationUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (
    lower.includes('type=signup') ||
    lower.includes('type=email') ||
    lower.includes('type=magiclink')
  ) {
    return true;
  }
  const { type } = parseAuthParams(url);
  return type === 'signup' || type === 'email' || type === 'magiclink';
}

function isFlyFamAuthCallbackUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const okScheme =
    lower.startsWith('flyfam://') || lower.startsWith('com.flyfam.app://');
  if (!okScheme) return false;
  return (
    lower.includes('auth/callback') ||
    lower.includes('access_token') ||
    lower.includes('code=') ||
    lower.includes('token_hash') ||
    lower.includes('type=recovery') ||
    lower.includes('type=signup') ||
    lower.includes('type=email')
  );
}

function classifyAuthError(error?: string, errorCode?: string): string | undefined {
  const blob = `${errorCode ?? ''} ${error ?? ''}`.toLowerCase();
  if (
    blob.includes('pkce') ||
    blob.includes('code verifier') ||
    blob.includes('code_verifier')
  ) {
    return 'pkce';
  }
  if (
    blob.includes('expired') ||
    blob.includes('otp_expired') ||
    blob.includes('invalid') ||
    blob.includes('flow_state')
  ) {
    return 'expired';
  }
  if (error || errorCode) return 'provider_error';
  return undefined;
}

export type ApplyAuthSessionResult = {
  applied: boolean;
  recovery: boolean;
  hadAuthParams: boolean;
  errorCode?: 'expired' | 'provider_error' | 'network' | 'pkce';
  errorMessage?: string;
};

function authStepFailure(
  error: AuthError,
  recovery: boolean,
  hadAuthParams: boolean
): ApplyAuthSessionResult {
  if (isNetworkError(error.message)) {
    return {
      applied: false,
      recovery,
      hadAuthParams,
      errorCode: 'network',
      errorMessage: error.message,
    };
  }
  return {
    applied: false,
    recovery,
    hadAuthParams,
    errorCode: classifyAuthError(error.message),
    errorMessage: error.message,
  };
}

/** E-posta doğrulama / şifre sıfırlama linki uygulamayı açınca oturumu kurar. */
export async function applySupabaseSessionFromUrl(url: string): Promise<ApplyAuthSessionResult> {
  const recovery = isRecoveryAuthUrl(url);
  const signupVerify = isSignupOrEmailVerificationUrl(url);
  if (!isFlyFamAuthCallbackUrl(url)) {
    return { applied: false, recovery, hadAuthParams: false };
  }

  const params = parseAuthParams(url);
  const hadAuthParams = Boolean(
    params.code || params.token_hash || params.access_token || params.error
  );

  if (params.error || params.error_code) {
    return {
      applied: false,
      recovery,
      hadAuthParams: true,
      errorCode: classifyAuthError(params.error, params.error_code),
      errorMessage: params.error,
    };
  }

  if (params.token_hash && params.type) {
    const stepRecovery = recovery || params.type === 'recovery';
    const { error, sessionEstablished } = await runAuthStepWithRetry(() =>
      supabase.auth.verifyOtp({
        token_hash: params.token_hash!,
        type: params.type as EmailOtpType,
      })
    );
    if (sessionEstablished) {
      return { applied: true, recovery: stepRecovery, hadAuthParams: true };
    }
    if (error) {
      return authStepFailure(error, stepRecovery, true);
    }
  }

  if (params.code) {
    const { error, sessionEstablished } = await runAuthStepWithRetry(() =>
      supabase.auth.exchangeCodeForSession(params.code!)
    );
    if (sessionEstablished) {
      return { applied: true, recovery, hadAuthParams: true };
    }
    if (error) {
      // PKCE verifier sadece kayıt yapılan cihazda/uygulamada var; yoksa kullanıcıya ham İngilizce hata gösterme.
      const fail = authStepFailure(error, recovery, true);
      if (
        /pkce|code verifier|code_verifier/i.test(error.message) &&
        (await hasAuthSession())
      ) {
        return { applied: true, recovery, hadAuthParams: true };
      }
      return fail;
    }
  }

  if (params.access_token && params.refresh_token) {
    const { error, sessionEstablished } = await runAuthStepWithRetry(() =>
      supabase.auth.setSession({
        access_token: params.access_token!,
        refresh_token: params.refresh_token!,
      })
    );
    if (sessionEstablished) {
      return { applied: true, recovery: recovery || signupVerify, hadAuthParams: true };
    }
    if (error) {
      return authStepFailure(error, recovery, true);
    }
  }

  return { applied: false, recovery, hadAuthParams };
}

/** Alert öncesi: ağ hatası dönse bile oturum kurulmuşsa başarı say. */
export async function reconcileAuthLinkResult(
  result: ApplyAuthSessionResult
): Promise<ApplyAuthSessionResult> {
  if (result.applied || result.errorCode !== 'network') return result;
  if (await hasAuthSession()) {
    return {
      ...result,
      applied: true,
      errorCode: undefined,
      errorMessage: undefined,
    };
  }
  return result;
}
