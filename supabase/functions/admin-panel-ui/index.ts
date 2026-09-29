/**
 * Redirect helper for Ops Console.
 * Primary host: branded GitHub Pages path (text/html). Supabase cannot serve
 * GET text/html on *.supabase.co without a custom domain.
 */
const PRIMARY =
  'https://app.flyfamapp.com/admin/';

Deno.serve((req) => {
  const url = new URL(req.url);
  const dest = new URL(PRIMARY);
  // Preserve cache-bust / ui query params for operators.
  for (const [k, v] of url.searchParams) dest.searchParams.set(k, v);
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      },
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: dest.toString(),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
});
