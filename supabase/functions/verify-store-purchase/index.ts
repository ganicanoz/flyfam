import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAppleTransactionInfo } from '../_shared/appStoreServerApi.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type VerifyRequest = {
  platform: 'ios' | 'android';
  productId: string;
  transactionId: string;
  originalTransactionId?: string | null;
  purchaseAtMs?: number | null;
  // TODO(step-4b): replace this with real store proof validation payloads.
  receiptData?: string | null;
};

type AppleVerifyReceiptResponse = {
  status: number;
  environment?: 'Sandbox' | 'Production';
  latest_receipt_info?: Array<Record<string, unknown>>;
  receipt?: {
    in_app?: Array<Record<string, unknown>>;
  };
};

const APPLE_VERIFY_PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_STATUS = 21007;

async function verifyAppleReceiptOrThrow(params: {
  receiptData: string;
  expectedProductId: string;
  expectedTransactionId: string;
  sharedSecret: string;
}): Promise<{ environment: 'Sandbox' | 'Production'; matchedTx: Record<string, unknown> }> {
  const callVerify = async (url: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': params.receiptData,
        password: params.sharedSecret,
        'exclude-old-transactions': false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Apple verifyReceipt HTTP ${res.status}`);
    }
    return (await res.json()) as AppleVerifyReceiptResponse;
  };

  let payload = await callVerify(APPLE_VERIFY_PROD_URL);
  if (payload.status === APPLE_SANDBOX_STATUS) {
    payload = await callVerify(APPLE_VERIFY_SANDBOX_URL);
  }
  if (payload.status !== 0) {
    throw new Error(`Apple receipt verification failed (status: ${payload.status})`);
  }

  const txs = [
    ...(payload.latest_receipt_info ?? []),
    ...((payload.receipt?.in_app ?? []) as Array<Record<string, unknown>>),
  ];
  const matchedTx = txs.find((tx) => {
    const productId = String(tx.product_id ?? '').trim();
    const transactionId = String(tx.transaction_id ?? '').trim();
    const originalTxId = String(tx.original_transaction_id ?? '').trim();
    return (
      productId === params.expectedProductId &&
      (transactionId === params.expectedTransactionId || originalTxId === params.expectedTransactionId)
    );
  });

  if (!matchedTx) {
    throw new Error('Apple receipt does not contain the expected transaction/product');
  }

  return {
    environment: payload.environment === 'Sandbox' ? 'Sandbox' : 'Production',
    matchedTx,
  };
}

type VerifiedAppleTransaction = {
  method: 'app_store_server_api' | 'verify_receipt';
  environment: 'Sandbox' | 'Production';
  purchaseDateMs: number | null;
  periodEndsAt: string | null;
  isTrial: boolean;
  originalTransactionId: string | null;
  promotionalOfferId: unknown;
};

function receiptMatchToVerified(r: {
  environment: 'Sandbox' | 'Production';
  matchedTx: Record<string, unknown>;
}): VerifiedAppleTransaction {
  const purchaseMs = Number(r.matchedTx.purchase_date_ms);
  const expiresMs = Number(r.matchedTx.expires_date_ms);
  return {
    method: 'verify_receipt',
    environment: r.environment,
    purchaseDateMs: Number.isFinite(purchaseMs) ? purchaseMs : null,
    periodEndsAt: Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null,
    isTrial:
      String(r.matchedTx.is_trial_period ?? '').toLowerCase() === 'true' ||
      String(r.matchedTx.is_in_intro_offer_period ?? '').toLowerCase() === 'true',
    originalTransactionId: String(r.matchedTx.original_transaction_id ?? '').trim() || null,
    promotionalOfferId: r.matchedTx.promotional_offer_id ?? null,
  };
}

async function verifyAppleTransactionViaServerApiOrThrow(params: {
  transactionId: string;
  expectedProductId: string;
  privateKeyPem: string;
  keyId: string;
  issuerId: string;
  bundleId: string;
}): Promise<VerifiedAppleTransaction> {
  const tx = await getAppleTransactionInfo(params);
  if (String(tx.bundleId ?? '').trim() !== params.bundleId.trim()) {
    throw new Error('Apple transaction belongs to a different app');
  }
  if (String(tx.productId ?? '').trim() !== params.expectedProductId) {
    throw new Error('Apple transaction does not match the expected product');
  }
  const txId = String(tx.transactionId ?? '').trim();
  const originalTxId = String(tx.originalTransactionId ?? '').trim();
  if (txId !== params.transactionId && originalTxId !== params.transactionId) {
    throw new Error('Apple transaction id mismatch');
  }
  if (tx.revocationDate) {
    throw new Error('Apple transaction was revoked or refunded');
  }
  return {
    method: 'app_store_server_api',
    environment: tx.environment === 'Sandbox' ? 'Sandbox' : 'Production',
    purchaseDateMs: Number.isFinite(tx.purchaseDate) ? Number(tx.purchaseDate) : null,
    periodEndsAt: Number.isFinite(tx.expiresDate) ? new Date(Number(tx.expiresDate)).toISOString() : null,
    // offerType 1 = introductory offer (free trial / pay-as-you-go / pay-up-front)
    isTrial: tx.offerType === 1,
    originalTransactionId: originalTxId || null,
    promotionalOfferId: tx.offerType === 2 ? (tx.offerIdentifier ?? null) : null,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authHeader) {
      return new Response(JSON.stringify({ error: 'Missing server configuration or auth header' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: userError?.message || 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as VerifyRequest;
    const platform = body?.platform;
    const productId = String(body?.productId ?? '').trim();
    const transactionId = String(body?.transactionId ?? '').trim();
    const originalTransactionId = String(body?.originalTransactionId ?? '').trim() || null;
    const purchaseAt = Number.isFinite(body?.purchaseAtMs) ? new Date(Number(body.purchaseAtMs)).toISOString() : null;

    if (platform !== 'ios' && platform !== 'android') {
      return new Response(JSON.stringify({ error: 'Invalid platform' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!productId || !transactionId) {
      return new Response(JSON.stringify({ error: 'productId and transactionId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (platform === 'ios') {
      const sharedSecret = Deno.env.get('APPLE_IAP_SHARED_SECRET');
      const serverApiKeyPem = Deno.env.get('APPLE_PRIVATE_KEY_P8');
      const serverApiKeyId = Deno.env.get('APPLE_KEY_ID');
      const serverApiIssuerId = Deno.env.get('APPLE_ISSUER_ID');
      const appleBundleId = Deno.env.get('APPLE_BUNDLE_ID');
      const serverApiConfigured = !!(serverApiKeyPem && serverApiKeyId && serverApiIssuerId && appleBundleId);
      const receiptData = body?.receiptData ? String(body.receiptData) : null;

      if (!serverApiConfigured && !(receiptData && sharedSecret)) {
        return new Response(
          JSON.stringify({
            error: receiptData
              ? 'Missing APPLE_IAP_SHARED_SECRET'
              : 'receiptData is required for iOS verification',
          }),
          {
            status: receiptData ? 500 : 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      // App Store Server API (works without a receipt, e.g. RevenueCat / StoreKit 2);
      // legacy verifyReceipt stays as fallback when a receipt is supplied.
      let verified: VerifiedAppleTransaction | null = null;
      const failures: string[] = [];
      if (serverApiConfigured) {
        try {
          verified = await verifyAppleTransactionViaServerApiOrThrow({
            transactionId,
            expectedProductId: productId,
            privateKeyPem: serverApiKeyPem!,
            keyId: serverApiKeyId!,
            issuerId: serverApiIssuerId!,
            bundleId: appleBundleId!,
          });
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (!verified && receiptData && sharedSecret) {
        try {
          verified = receiptMatchToVerified(
            await verifyAppleReceiptOrThrow({
              receiptData,
              expectedProductId: productId,
              expectedTransactionId: transactionId,
              sharedSecret,
            }),
          );
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (!verified) {
        return new Response(JSON.stringify({ error: failures.join(' | ') || 'Apple purchase verification failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const purchaseDateMs = verified.purchaseDateMs ?? Number(body?.purchaseAtMs ?? Date.now());
      body.purchaseAtMs = Number.isFinite(purchaseDateMs) ? purchaseDateMs : Date.now();
      const periodEndsAt = verified.periodEndsAt;
      const isTrial = verified.isTrial;

      const { data, error } = await adminClient.rpc('apply_verified_store_purchase_for_user', {
        p_user_id: user.id,
        p_platform: platform,
        p_product_id: productId,
        p_transaction_id: transactionId,
        p_original_transaction_id: originalTransactionId ?? verified.originalTransactionId,
        p_purchase_at: verified.purchaseDateMs != null ? new Date(verified.purchaseDateMs).toISOString() : purchaseAt,
        p_raw_payload: {
          platform,
          productId,
          transactionId,
          originalTransactionId: originalTransactionId ?? verified.originalTransactionId,
          purchaseAtMs: body?.purchaseAtMs ?? null,
          receiptDataPresent: !!body?.receiptData,
          appleEnvironment: verified.environment,
          verificationMethod: verified.method,
          isTrial,
          periodEndsAt,
          promotionalOfferId: verified.promotionalOfferId,
        },
        p_period_ends_at: periodEndsAt,
        p_is_trial: isTrial,
      });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          result: data,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Android store proof validation is not implemented yet. Never grant an
    // entitlement from client-supplied product/transaction identifiers alone.
    return new Response(JSON.stringify({ error: 'Android purchase verification is not available yet' }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
