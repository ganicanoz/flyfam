import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !authHeader) {
      return new Response(JSON.stringify({ error: 'Missing server configuration or auth header' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
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
      if (!sharedSecret) {
        return new Response(JSON.stringify({ error: 'Missing APPLE_IAP_SHARED_SECRET' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!body?.receiptData) {
        return new Response(JSON.stringify({ error: 'receiptData is required for iOS verification' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const verified = await verifyAppleReceiptOrThrow({
        receiptData: body.receiptData,
        expectedProductId: productId,
        expectedTransactionId: transactionId,
        sharedSecret,
      });

      const purchaseDateMs = Number(verified.matchedTx.purchase_date_ms ?? body?.purchaseAtMs ?? Date.now());
      body.purchaseAtMs = Number.isFinite(purchaseDateMs) ? purchaseDateMs : Date.now();

      const expiresMs = Number(verified.matchedTx.expires_date_ms);
      const periodEndsAt = Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null;
      const isTrial =
        String(verified.matchedTx.is_trial_period ?? '').toLowerCase() === 'true' ||
        String(verified.matchedTx.is_in_intro_offer_period ?? '').toLowerCase() === 'true';

      const { data, error } = await userClient.rpc('apply_verified_store_purchase', {
        p_platform: platform,
        p_product_id: productId,
        p_transaction_id: transactionId,
        p_original_transaction_id: originalTransactionId,
        p_purchase_at: purchaseAt,
        p_raw_payload: {
          platform,
          productId,
          transactionId,
          originalTransactionId,
          purchaseAtMs: body?.purchaseAtMs ?? null,
          receiptDataPresent: !!body?.receiptData,
          appleEnvironment: verified.environment,
          isTrial,
          periodEndsAt,
          promotionalOfferId: verified.matchedTx.promotional_offer_id ?? null,
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

    const { data, error } = await userClient.rpc('apply_verified_store_purchase', {
      p_platform: platform,
      p_product_id: productId,
      p_transaction_id: transactionId,
      p_original_transaction_id: originalTransactionId,
      p_purchase_at: purchaseAt,
      p_raw_payload: {
        platform,
        productId,
        transactionId,
        originalTransactionId,
        purchaseAtMs: body?.purchaseAtMs ?? null,
        receiptDataPresent: !!body?.receiptData,
      },
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
