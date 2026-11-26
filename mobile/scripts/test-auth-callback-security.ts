/**
 * Auth callback / deep-link güvenlik testleri (statik + parse kuralları).
 * Çalıştır: npx tsx mobile/scripts/test-auth-callback-security.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const htmlPath = path.join(root, 'support/auth-callback.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const handoffFn = fs.readFileSync(
  path.join(root, 'supabase/functions/auth-link-handoff/index.ts'),
  'utf8',
);
const sessionFromUrl = fs.readFileSync(
  path.join(root, 'mobile/lib/authSessionFromUrl.ts'),
  'utf8',
);

function assertNoSecretInCustomScheme(source: string) {
  // Custom-scheme construction must only append handoff id (or bare callback).
  const deepAssignments = [...source.matchAll(/flyfam:\/\/[^'"`\s]*/g)].map((m) => m[0]);
  assert.ok(deepAssignments.length > 0, 'expected flyfam:// references');
  for (const href of deepAssignments) {
    assert.ok(!/access_token=/i.test(href), href);
    assert.ok(!/refresh_token=/i.test(href), href);
    assert.ok(!/token_hash=/i.test(href), href);
    assert.ok(!/[?&#]code=/i.test(href), href);
    assert.ok(!/[?&#]otp=/i.test(href), href);
    assert.ok(!/[?&#]token=/i.test(href), href);
  }
  assert.ok(source.includes('handoff='), 'browser fallback should use handoff id');
  assert.ok(source.includes('auth-link-handoff'), 'must call handoff edge function');
  assert.ok(source.includes('hasHandoffable'), 'must detect handoffable params');
  assert.ok(source.includes('hasLegacySessionTokens'), 'must detect legacy session tokens');
}

function assertNoAccessRefreshHandoffSupport(source: string, label: string) {
  // Must not assign or forward access_token / refresh_token into handoff create body / payload.
  assert.ok(
    !/access_token\s*:/.test(source) && !/access_token\s*=/.test(source.replace(/\/\/[^\n]*/g, '')),
    `${label}: must not set access_token in handoff path`,
  );
  // Comments mentioning access/refresh for rejection are OK; payload fields are not.
  assert.ok(
    !/out\.access_token|payload\.access_token|body\.access_token|params\.access_token\s*\|\|/.test(
      source,
    ),
    `${label}: must not forward access_token into handoff payload`,
  );
  assert.ok(
    !/out\.refresh_token|payload\.refresh_token|body\.refresh_token|params\.refresh_token\s*\|\|/.test(
      source,
    ),
    `${label}: must not forward refresh_token into handoff payload`,
  );
}

function parseAuthParams(url: string) {
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
    handoff: params.get('handoff') ?? undefined,
  };
}

function flowLabel(type: string | undefined): string {
  if (type === 'signup') return 'signup';
  if (type === 'recovery') return 'recovery';
  if (type === 'invite') return 'invite';
  if (type === 'magiclink') return 'magic link';
  if (type === 'email_change') return 'email change';
  if (type === 'email') return 'email otp';
  return 'unknown';
}

function run() {
  assertNoSecretInCustomScheme(html);

  // Callback HTML must not put access/refresh into createHandoff body.
  assert.ok(!/access_token:\s*params\.access_token/.test(html));
  assert.ok(!/refresh_token:\s*params\.refresh_token/.test(html));
  assert.ok(html.includes('token_hash: params.token_hash'));
  assert.ok(html.includes('code: params.code'));
  assert.ok(
    html.includes('Bu bağlantı artık desteklenmiyor') ||
      html.includes('güncel doğrulama bağlantısına'),
    'legacy session-token URLs should show reopen-email message',
  );

  // Edge Function: no access/refresh in HandoffPayload acceptance path.
  assert.ok(handoffFn.includes('token_hash'));
  assert.ok(handoffFn.includes('Explicitly ignore legacy access_token'));
  assert.ok(!/out\.access_token\s*=/.test(handoffFn));
  assert.ok(!/out\.refresh_token\s*=/.test(handoffFn));
  assert.ok(!/access_token\?:/.test(handoffFn), 'HandoffPayload must not declare access_token');
  assert.ok(!/refresh_token\?:/.test(handoffFn), 'HandoffPayload must not declare refresh_token');
  assertNoAccessRefreshHandoffSupport(handoffFn, 'auth-link-handoff');

  // Mobile: handoff redeem must not map access/refresh; custom scheme rejects them.
  assert.ok(sessionFromUrl.includes("errorCode: 'legacy_link'"));
  assert.ok(sessionFromUrl.includes('allowSessionTokens: viaHttpsBridge'));
  assert.ok(sessionFromUrl.includes('Never accept access/refresh from server-side handoff'));
  assert.ok(
    !/access_token:\s*typeof payload\.access_token/.test(sessionFromUrl),
    'redeemHandoff must not return access_token',
  );
  assert.ok(
    !/refresh_token:\s*typeof payload\.refresh_token/.test(sessionFromUrl),
    'redeemHandoff must not return refresh_token',
  );

  const flows: Array<{ type: string; url: string }> = [
    {
      type: 'signup',
      url: 'https://app.flyfamapp.com/auth-callback.html?token_hash=HASH_SIGNUP&type=signup',
    },
    {
      type: 'recovery',
      url: 'https://app.flyfamapp.com/auth-callback.html?token_hash=HASH_RECOVERY&type=recovery',
    },
    {
      type: 'invite',
      url: 'https://app.flyfamapp.com/auth-callback.html?token_hash=HASH_INVITE&type=invite',
    },
    {
      type: 'magiclink',
      url: 'https://app.flyfamapp.com/auth-callback.html?token_hash=HASH_MAGIC&type=magiclink',
    },
    {
      type: 'email_change',
      url: 'https://app.flyfamapp.com/auth-callback.html?token_hash=HASH_CHANGE&type=email_change',
    },
  ];

  for (const f of flows) {
    const p = parseAuthParams(f.url);
    assert.equal(p.type, f.type, flowLabel(f.type));
    assert.ok(p.token_hash, flowLabel(f.type));
    const handoffOnly = `flyfam://auth/callback?handoff=11111111-2222-4333-8444-555555555555`;
    const handoffParams = parseAuthParams(handoffOnly);
    assert.equal(handoffParams.handoff?.length, 36);
    assert.equal(handoffParams.access_token, undefined);
    assert.equal(handoffParams.token_hash, undefined);
    assert.equal(handoffParams.code, undefined);
  }

  assert.ok(!/flyfam:\/\/[^'"`]*access_token=/i.test(html));
  assert.ok(!/flyfam:\/\/[^'"`]*refresh_token=/i.test(html));

  const aasaPath = path.join(root, 'support/.well-known/apple-app-site-association');
  const aasa = JSON.parse(fs.readFileSync(aasaPath, 'utf8')) as {
    applinks?: { details?: Array<{ appID?: string; paths?: string[] }> };
  };
  const detail = aasa.applinks?.details?.[0];
  assert.equal(detail?.appID, 'ZF66PC5AN7.com.flyfamapp.mobile');
  assert.ok(detail?.paths?.some((p) => p.includes('auth-callback')));

  console.log('auth callback security tests: PASS');
}

run();
