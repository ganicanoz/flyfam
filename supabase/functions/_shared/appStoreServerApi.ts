/**
 * App Store Server API — Get Transaction Info.
 * Makbuz (verifyReceipt) gerektirmeden işlem kimliğiyle doğrulama (RevenueCat / StoreKit 2 akışı).
 * Yanıt Apple'dan bizim JWT'mizle kimliği doğrulanmış TLS üzerinden gelir; JWS imzası ayrıca doğrulanmaz.
 * @see https://developer.apple.com/documentation/appstoreserverapi/get_transaction_info
 */

const PROD_BASE = 'https://api.storekit.itunes.apple.com';
const SANDBOX_BASE = 'https://api.storekit-sandbox.itunes.apple.com';

export type AppleServerTransaction = {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  offerType?: number;
  offerDiscountType?: string;
  offerIdentifier?: string;
  environment?: 'Sandbox' | 'Production' | string;
};

function pemToPkcs8Bytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToString(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function makeAppStoreServerJwt(params: {
  privateKeyPem: string;
  keyId: string;
  issuerId: string;
  bundleId: string;
}): Promise<string> {
  const enc = new TextEncoder();
  const header = { alg: 'ES256', kid: params.keyId.trim(), typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const payload = { iss: params.issuerId.trim(), iat, exp: iat + 300, aud: 'appstoreconnect-v1', bid: params.bundleId.trim() };
  const signingInput = `${base64UrlEncode(enc.encode(JSON.stringify(header)))}.${base64UrlEncode(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8Bytes(params.privateKeyPem).buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)));
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

export function decodeJwsPayload<T>(jws: string): T {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS');
  return JSON.parse(base64UrlDecodeToString(parts[1]!)) as T;
}

/** Önce production; işlem bulunamaz (404) veya production yetkisi yoksa (401) sandbox (TestFlight / review). */
export async function getAppleTransactionInfo(params: {
  transactionId: string;
  privateKeyPem: string;
  keyId: string;
  issuerId: string;
  bundleId: string;
}): Promise<AppleServerTransaction> {
  const jwt = await makeAppStoreServerJwt(params);
  const statuses: string[] = [];
  for (const base of [PROD_BASE, SANDBOX_BASE]) {
    const res = await fetch(`${base}/inApps/v1/transactions/${encodeURIComponent(params.transactionId)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { signedTransactionInfo?: string };
      if (!body.signedTransactionInfo) throw new Error('App Store Server API: empty transaction info');
      return decodeJwsPayload<AppleServerTransaction>(body.signedTransactionInfo);
    }
    const errBody = (await res.json().catch(() => null)) as { errorCode?: number } | null;
    statuses.push(`${base === PROD_BASE ? 'prod' : 'sandbox'} ${res.status}${errBody?.errorCode ? `/${errBody.errorCode}` : ''}`);
    // Production answers 401 until the app has live App Store sales; sandbox still serves TestFlight / review.
    if (res.status !== 404 && res.status !== 401) break;
  }
  throw new Error(`App Store Server API transaction lookup failed (${statuses.join(', ')})`);
}
