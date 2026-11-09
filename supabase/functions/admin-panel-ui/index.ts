/**
 * Ops console is no longer hosted on the public app.flyfamapp.com site.
 * Operators open docs/ADMIN_STATUS_DASHBOARD.html locally (or a private host).
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
  return new Response(
    JSON.stringify({
      ok: false,
      code: 'admin_ui_not_public',
      message: 'Ops console is not published on the public support host.',
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    },
  );
});
