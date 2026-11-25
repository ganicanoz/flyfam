/**
 * Redirect operators to the public ops console host.
 * Auth/authorization remain enforced by admin-dashboard APIs.
 */
Deno.serve((req) => {
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
  const inbound = new URL(req.url);
  const ui = inbound.searchParams.get('ui') || '64';
  const target = new URL('https://app.flyfamapp.com/admin/');
  target.searchParams.set('ui', ui);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
});
