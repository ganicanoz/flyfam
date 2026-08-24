import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { signApplePromotionalOffer } from '../_shared/applePromotionalOfferSign.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SignRequest = {
  productId?: string;
  offerId?: string | null;
};

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
    const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY_P8');
    const keyId = Deno.env.get('APPLE_KEY_ID');
    const bundleId = Deno.env.get('APPLE_BUNDLE_ID');
    const defaultOfferId = Deno.env.get('APPLE_IOS_MONTHLY_PROMO_OFFER_ID');

    if (!supabaseUrl || !anonKey || !authHeader) {
      return new Response(JSON.stringify({ error: 'Missing server configuration or auth header' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!privateKeyPem || !keyId || !bundleId) {
      return new Response(JSON.stringify({ error: 'Missing Apple signing secrets (APPLE_PRIVATE_KEY_P8, APPLE_KEY_ID, APPLE_BUNDLE_ID)' }), {
        status: 500,
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

    const body = (await req.json()) as SignRequest;
    const productId = String(body?.productId ?? '01').trim();
    const offerId = String(body?.offerId ?? defaultOfferId ?? '').trim();

    if (!offerId) {
      return new Response(JSON.stringify({ error: 'Missing promotional offer id (offerId or APPLE_IOS_MONTHLY_PROMO_OFFER_ID)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (productId !== '01' && productId !== '02') {
      return new Response(JSON.stringify({ error: 'Unsupported productId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const signed = await signApplePromotionalOffer({
      privateKeyPem,
      keyIdentifier: keyId,
      bundleId,
      productId,
      offerId,
      applicationUsername: user.id,
    });

    return new Response(JSON.stringify({ ok: true, offer: signed }), {
      status: 200,
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
