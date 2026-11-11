#!/usr/bin/env node
/**
 * Keep production OTA and the next store build on the same git line.
 *
 * Policy:
 * - Publish OTA only from a clean tree exactly at origin/main.
 * - Before a production build, HEAD must contain the latest production OTA
 *   git commit (ancestor or equal) so that JS is already embedded in the binary.
 *
 * Invoked by:
 * - npm run verify:ota-sync / ota:production / build:*:store
 * - app.config.js when eas.json production sets APP_ENV=production
 *   (any `eas build --profile production`, npm gerekmez)
 * - package.json eas-build-pre-install on the EAS worker
 *
 * Usage (from mobile/):
 *   node scripts/verify-ota-build-sync.mjs
 *   node scripts/verify-ota-build-sync.mjs --require-clean-main
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(__dirname, '..');
const repoRoot = resolve(mobileRoot, '..');
const requireCleanMain = process.argv.includes('--require-clean-main');
const isEasWorker = process.env.EAS_BUILD === 'true';

function run(cmd, args, cwd = repoRoot) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed: ${err || r.status}`);
  }
  return (r.stdout || '').trim();
}

function runAllowFail(cmd, args, cwd = repoRoot) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

function normalizeSha(raw) {
  if (!raw) return null;
  return String(raw).replace(/\*+$/g, '').trim().toLowerCase();
}

function short(sha) {
  return sha ? sha.slice(0, 10) : '(none)';
}

/** Extract first JSON array or object from noisy CLI stdout (banners, etc.). */
function parseJsonPayload(text) {
  const t = String(text || '');
  const iArr = t.indexOf('[');
  const iObj = t.indexOf('{');
  let start = -1;
  if (iArr >= 0 && (iObj < 0 || iArr <= iObj)) start = iArr;
  else if (iObj >= 0) start = iObj;
  if (start < 0) throw new Error('no JSON in command output');

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return JSON.parse(t.slice(start, i + 1));
      }
    }
  }
  return JSON.parse(t.slice(start));
}

function hasGitRepo() {
  const r = runAllowFail('git', ['rev-parse', '--git-dir'], repoRoot);
  return r.status === 0;
}

function resolveHeadSha() {
  const fromEas = normalizeSha(process.env.EAS_BUILD_GIT_COMMIT_HASH);
  if (fromEas) return fromEas;
  return normalizeSha(run('git', ['rev-parse', 'HEAD']));
}

function fetchOriginMain() {
  if (!hasGitRepo()) return;
  try {
    run('git', ['fetch', 'origin', 'main', '--quiet']);
  } catch (e) {
    console.warn('[ota-sync] git fetch warning:', e.message || e);
  }
}

function assertCleanMainAligned() {
  const porcelain = run('git', ['status', '--porcelain', '--', 'mobile']);
  if (porcelain) {
    console.error(
      '\nREFUSING: mobile/ has uncommitted changes.\n' +
        'OTA must be published from committed origin/main only.\n' +
        porcelain.split('\n').slice(0, 25).join('\n') +
        '\n',
    );
    process.exit(2);
  }

  const head = run('git', ['rev-parse', 'HEAD']).toLowerCase();
  let originMain;
  try {
    originMain = run('git', ['rev-parse', 'origin/main']).toLowerCase();
  } catch {
    console.error('\nREFUSING: origin/main missing. Run: git fetch origin\n');
    process.exit(2);
  }

  if (head !== originMain) {
    const behind = run('git', ['rev-list', '--count', 'HEAD..origin/main']);
    const ahead = run('git', ['rev-list', '--count', 'origin/main..HEAD']);
    console.error(
      `\nREFUSING: HEAD (${short(head)}) != origin/main (${short(originMain)}).\n` +
        `ahead=${ahead} behind=${behind}\n` +
        `Push/merge first. Never publish OTA from a dirty copy onto an old build commit.\n`,
    );
    process.exit(2);
  }

  console.log(`[ota-sync] OK tree = origin/main @ ${short(head)}`);
}

function latestProductionOta() {
  const listOut = run(
    'npx',
    ['eas-cli', 'update:list', '--branch', 'production', '--limit', '1', '--non-interactive', '--json'],
    mobileRoot,
  );
  const list = parseJsonPayload(listOut);
  const page = Array.isArray(list) ? list : list.currentPage;
  const row = Array.isArray(page) ? page[0] : null;
  if (!row) {
    console.log('[ota-sync] No production updates yet — skip ancestor check.');
    return null;
  }
  const groupId = row.group || row.groupId || row.id;
  if (!groupId) throw new Error('latest OTA has no group id');

  const viewOut = run(
    'npx',
    ['eas-cli', 'update:view', String(groupId), '--json'],
    mobileRoot,
  );
  const updates = parseJsonPayload(viewOut);
  const first = Array.isArray(updates) ? updates[0] : updates;
  const sha = normalizeSha(first?.gitCommitHash);
  if (!sha) {
    throw new Error(`OTA group ${groupId} has no gitCommitHash — was it published from a git repo?`);
  }
  if (String(first.gitCommitHash).includes('*')) {
    console.warn(
      `[ota-sync] WARNING: OTA gitCommitHash was dirty (${first.gitCommitHash}). ` +
        `Future publishes must be clean so the next build can embed the same commit.`,
    );
  }
  return {
    sha,
    groupId: first.group || groupId,
    message: first.message || row.message || null,
    runtimeVersion: first.runtimeVersion || row.runtimeVersion || null,
  };
}

function assertCommitContainsOta(ota, commitSha) {
  if (!ota?.sha) return;
  const into = commitSha || resolveHeadSha();

  let r = runAllowFail('git', ['merge-base', '--is-ancestor', ota.sha, into], repoRoot);
  if (r.status !== 0) {
    runAllowFail('git', ['fetch', '--quiet', 'origin', ota.sha], repoRoot);
    runAllowFail('git', ['fetch', '--quiet', 'origin', into], repoRoot);
    r = runAllowFail('git', ['merge-base', '--is-ancestor', ota.sha, into], repoRoot);
  }

  if (r.status !== 0) {
    console.error(
      `\nREFUSING: latest production OTA is not in this tree.\n` +
        `  OTA commit:  ${ota.sha}\n` +
        `  OTA group:   ${ota.groupId || '?'}\n` +
        `  OTA message: ${ota.message || '?'}\n` +
        `  Build commit: ${into}\n\n` +
        `Rule: every published OTA must already be on the branch you build from.\n` +
        `Merge that commit (or rebuild from origin/main that includes it) before EAS build.\n`,
    );
    process.exit(2);
  }
  console.log(
    `[ota-sync] OK ${short(into)} contains latest production OTA ${short(ota.sha)}` +
      (ota.groupId ? ` (group ${ota.groupId})` : ''),
  );
}

if (!hasGitRepo()) {
  if (isEasWorker) {
    // CLI upload tarball has no .git. Local app.config evaluation already enforced the gate.
    console.log(
      '[ota-sync] EAS worker without .git — ancestor check skipped (pre-upload local gate is authoritative).',
    );
    process.exit(0);
  }
  console.error('\nREFUSING: no git repository — cannot verify OTA↔build sync.\n');
  process.exit(2);
}

fetchOriginMain();

if (requireCleanMain) {
  assertCleanMainAligned();
} else if (!isEasWorker) {
  try {
    const behind = Number(run('git', ['rev-list', '--count', 'HEAD..origin/main']) || '0');
    if (behind > 0) {
      console.error(
        `\nREFUSING: HEAD is behind origin/main by ${behind} commit(s).\n` +
          `Update before store build so pushed OTA sources are not omitted.\n`,
      );
      process.exit(2);
    }
  } catch (e) {
    console.warn('[ota-sync] behind-check skipped:', e.message || e);
  }
} else {
  console.log('[ota-sync] EAS worker — skip behind-origin/main check');
}

let ota;
try {
  ota = latestProductionOta();
} catch (e) {
  console.error('[ota-sync] Failed to read latest production OTA:', e.message || e);
  process.exit(2);
}
assertCommitContainsOta(ota, resolveHeadSha());
console.log('[ota-sync] ALL CHECKS PASSED');
