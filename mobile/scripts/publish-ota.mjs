#!/usr/bin/env node
/**
 * Publish a production EAS Update that existing store binaries can load
 * without a new native build.
 *
 * FlyFam uses a fixed string runtimeVersion (app.config.js → "1.3.0").
 * Do NOT switch to policy: "fingerprint" — that forces a new build whenever
 * native inputs drift and is why earlier OTAs silently failed to apply.
 *
 * Usage (from mobile/):
 *   node scripts/publish-ota.mjs "fix: short message"
 *   npm run ota:production -- "fix: short message"
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const message = (process.argv.slice(2).join(' ') || '').trim();
if (!message) {
  console.error('Usage: node scripts/publish-ota.mjs "message"');
  process.exit(1);
}

function loadRuntimeVersion() {
  // app.config.js is ESM export default — evaluate via dynamic import after path.
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
    cwd: mobileRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  if (r.status !== 0) {
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
  }
  return (r.stdout || '') + (r.stderr || '');
}

const runtimeVersion = loadRuntimeVersion();
console.log(`runtimeVersion: ${runtimeVersion} (fixed string — good)`);

// Guard: publishing from a wildly divergent local main has crashed devices before
// (2026-10-27). Prefer a worktree checked out at the latest production build commit.
try {
  const st = run('git', ['status', '-sb']);
  const behind = /behind\s+(\d+)/i.exec(st);
  if (behind && Number(behind[1]) >= 20) {
    console.error(
      `\nREFUSING: local branch is behind remote by ${behind[1]} commits.\n` +
        `Publishing from this tree previously shipped a crashing OTA.\n` +
        `Use a worktree at the latest production build commit (eas build:list), ` +
        `copy only the JS fix files, then publish from there.\n`,
    );
    process.exit(2);
  }
} catch (e) {
  console.warn('git status check skipped:', e.message || e);
}

// Informational: latest production iOS build fingerprint vs local (does not block publish).
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
    const fp =
      typeof latest.fingerprint === 'object' && latest.fingerprint
        ? latest.fingerprint.hash || latest.fingerprint.id
        : latest.fingerprint;
    console.log(
      `latest iOS build: #${latest.appBuildVersion || latest.buildNumber || '?'} ` +
        `runtime=${latest.runtimeVersion} fingerprint=${fp || 'n/a'}`,
    );
    if (latest.runtimeVersion && latest.runtimeVersion !== runtimeVersion) {
      console.warn(
        `WARNING: latest build runtimeVersion (${latest.runtimeVersion}) != app.config (${runtimeVersion}). ` +
          `This OTA will NOT reach that binary until runtimeVersion matches.`,
      );
    }
  }
} catch (e) {
  console.warn('Could not list latest build (continuing):', e.message || e);
}

console.log('Publishing EAS Update to branch/channel production…');
const publishOut = run(
  'npx',
  [
    'eas-cli',
    'update',
    '--branch',
    'production',
    '--message',
    message,
    '--non-interactive',
  ],
  { stdio: 'inherit' },
);

// Verify iOS manifest serves *some* update for this runtime (best-effort).
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
console.log('App JS also calls applyOtaUpdateIfAvailable (fetch + reload) — no second store build needed for JS fixes.');
void publishOut;
void require;
