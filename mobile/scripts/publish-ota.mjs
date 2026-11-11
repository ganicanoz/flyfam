#!/usr/bin/env node
/**
 * Publish a production EAS Update that existing store binaries can load
 * without a new native build.
 *
 * FlyFam uses a fixed string runtimeVersion (app.config.js → "1.3.0").
 * Do NOT switch to policy: "fingerprint".
 *
 * Consistency rule (required):
 *   OTA is published only from a clean tree at origin/main.
 *   The next store build must be cut from a commit that already contains
 *   that OTA source (enforced by verify-ota-build-sync.mjs).
 *
 * Usage (from mobile/):
 *   node scripts/publish-ota.mjs "fix: short message"
 *   npm run ota:production -- "fix: short message"
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(__dirname, '..');
const repoRoot = resolve(mobileRoot, '..');

const message = (process.argv.slice(2).join(' ') || '').trim();
if (!message) {
  console.error('Usage: node scripts/publish-ota.mjs "message"');
  process.exit(1);
}

function loadRuntimeVersion() {
  const raw = readFileSync(resolve(mobileRoot, 'app.config.js'), 'utf8');
  const m = raw.match(/runtimeVersion:\s*'([^']+)'/) || raw.match(/runtimeVersion:\s*"([^"]+)"/);
  if (!m) {
    throw new Error('Could not parse runtimeVersion string from app.config.js');
  }
  if (/policy\s*:/.test(raw) && /fingerprint/.test(raw)) {
    throw new Error(
      'runtimeVersion uses fingerprint policy — OTAs will mismatch builds. Keep a fixed string (e.g. "1.3.0").',
    );
  }
  return m[1];
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || mobileRoot,
    encoding: 'utf8',
    stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    if (opts.stdio !== 'inherit') {
      console.error(r.stdout || '');
      console.error(r.stderr || '');
    }
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
  }
  return (r.stdout || '') + (r.stderr || '');
}

const runtimeVersion = loadRuntimeVersion();
console.log(`runtimeVersion: ${runtimeVersion} (fixed string — good)`);

// Hard gate: clean mobile/ + HEAD === origin/main (no dirty worktree OTA).
console.log('\n[ota] Verifying publish tree is origin/main (clean)…');
run('node', [resolve(__dirname, 'verify-ota-build-sync.mjs'), '--require-clean-main'], {
  stdio: 'inherit',
  cwd: mobileRoot,
});

const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).trim();
const publishMessage = `${message} [git:${headSha.slice(0, 10)}]`;
console.log(`Publishing from ${headSha.slice(0, 10)} — next store build must include this commit.`);

// Informational: latest production iOS build runtime
try {
  const listOut = run('npx', [
    'eas-cli',
    'build:list',
    '--platform',
    'ios',
    '--status',
    'finished',
    '--limit',
    '1',
    '--non-interactive',
    '--json',
  ]);
  const jsonStart = listOut.indexOf('[');
  const builds = jsonStart >= 0 ? JSON.parse(listOut.slice(jsonStart)) : [];
  const latest = builds[0];
  if (latest) {
    console.log(
      `latest iOS build: #${latest.appBuildVersion || latest.buildNumber || '?'} ` +
        `runtime=${latest.runtimeVersion}`,
    );
    if (latest.runtimeVersion && latest.runtimeVersion !== runtimeVersion) {
      console.warn(
        `WARNING: latest build runtimeVersion (${latest.runtimeVersion}) != app.config (${runtimeVersion}).`,
      );
    }
  }
} catch (e) {
  console.warn('Could not list latest build (continuing):', e.message || e);
}

console.log('Publishing EAS Update to branch/channel production…');
run(
  'npx',
  [
    'eas-cli',
    'update',
    '--branch',
    'production',
    '--message',
    publishMessage,
    '--non-interactive',
  ],
  { stdio: 'inherit' },
);

try {
  const curl = spawnSync(
    'curl',
    [
      '-sS',
      'https://u.expo.dev/5c9f4f99-9766-4d38-bfe0-6b1cd6a7e83f',
      '-H',
      'expo-protocol-version: 1',
      '-H',
      'expo-platform: ios',
      '-H',
      `expo-runtime-version: ${runtimeVersion}`,
      '-H',
      'expo-channel-name: production',
      '-H',
      'expo-api-version: 1',
      '-H',
      'accept: multipart/mixed',
    ],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  );
  const body = curl.stdout || '';
  const idMatch = body.match(/"id"\s*:\s*"(01[a-z0-9-]+)"/i);
  if (idMatch) {
    console.log(`Manifest OK — production/ios@${runtimeVersion} → update ${idMatch[1]}`);
  } else {
    console.warn('Manifest check: could not parse update id from channel response.');
  }
} catch (e) {
  console.warn('Manifest verify skipped:', e.message || e);
}

console.log('\nDone. Devices on runtime', runtimeVersion, 'pick this up on next cold start.');
console.log(
  `Next store build MUST be from ${headSha.slice(0, 10)} or a descendant (npm run verify:ota-sync).`,
);
