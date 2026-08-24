/**
 * Apple promotional offer signature (StoreKit legacy API).
 * @see https://developer.apple.com/documentation/storekit/in-app_purchase/original_api_for_in-app_purchase/generating_a_signature_for_promotional_offers
 */

const SEP = '\u2063';

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export type ApplePromotionalOfferSignature = {
  identifier: string;
  keyIdentifier: string;
  nonce: string;
  signature: string;
  timestamp: number;
};

export async function signApplePromotionalOffer(params: {
  privateKeyPem: string;
  keyIdentifier: string;
  bundleId: string;
  productId: string;
  offerId: string;
  applicationUsername?: string | null;
  nonce?: string;
  timestampMs?: number;
}): Promise<ApplePromotionalOfferSignature> {
  const keyIdentifier = params.keyIdentifier.trim();
  const bundleId = params.bundleId.trim();
  const productId = params.productId.trim();
  const offerId = params.offerId.trim();
  const applicationUsername = (params.applicationUsername ?? '').trim();
  const nonce = (params.nonce ?? crypto.randomUUID()).toLowerCase();
  const timestamp = params.timestampMs ?? Date.now();

  if (!keyIdentifier || !bundleId || !productId || !offerId) {
    throw new Error('Missing Apple promotional offer signing fields');
  }

  const payload = [
    bundleId,
    keyIdentifier,
    productId,
    offerId,
    applicationUsername,
    nonce,
    String(timestamp),
  ].join(SEP);

  const keyData = pemToPkcs8Bytes(params.privateKeyPem);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(payload),
    ),
  );

  return {
    identifier: offerId,
    keyIdentifier,
    nonce,
    signature: bytesToBase64(signatureBytes),
    timestamp,
  };
}
