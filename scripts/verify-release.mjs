#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(import.meta.dirname, '..');
const mobileDir = join(repoRoot, 'mobile');
const skipExport = process.argv.includes('--skip-export');

function run(label, command, args, cwd = repoRoot, env = {}) {
  console.log(`\n[release] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function uniqueMatches(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))];
}

async function verifyVersions() {
  console.log('\n[release] Version alignment');
  const configModule = await import(
    `${pathToFileURL(join(mobileDir, 'app.config.js')).href}?release-check=${Date.now()}`
  );
  const expo = configModule.default?.expo;
  if (!expo) throw new Error('mobile/app.config.js did not export expo config');

  const expectedVersion = String(expo.version);
  const expectedBuild = String(expo.ios?.buildNumber);
  const expectedVersionCode = Number(expo.android?.versionCode);
  if (!expectedVersion || !/^\d+$/.test(expectedBuild) || !Number.isInteger(expectedVersionCode)) {
    throw new Error('Expo version/build values are missing or invalid');
  }

  const gradle = readFileSync(join(mobileDir, 'android/app/build.gradle'), 'utf8');
  const androidVersion = gradle.match(/versionName\s+["']([^"']+)["']/)?.[1];
  const androidCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);

  const pbx = readFileSync(join(mobileDir, 'ios/FlyFam.xcodeproj/project.pbxproj'), 'utf8');
  const iosVersions = uniqueMatches(pbx, /MARKETING_VERSION\s*=\s*([^;]+);/g);
  const iosBuilds = uniqueMatches(pbx, /CURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g);

  const errors = [];
  if (androidVersion !== expectedVersion) {
    errors.push(`Android versionName=${androidVersion} expected=${expectedVersion}`);
  }
  if (androidCode !== expectedVersionCode) {
    errors.push(`Android versionCode=${androidCode} expected=${expectedVersionCode}`);
  }
  if (expectedBuild !== String(expectedVersionCode)) {
    errors.push(`Expo iOS build=${expectedBuild} and Android code=${expectedVersionCode} differ`);
  }
  if (iosVersions.length !== 1 || iosVersions[0] !== expectedVersion) {
    errors.push(`Xcode MARKETING_VERSION=${iosVersions.join(',')} expected=${expectedVersion}`);
  }
  if (iosBuilds.length !== 1 || iosBuilds[0] !== expectedBuild) {
    errors.push(`Xcode CURRENT_PROJECT_VERSION=${iosBuilds.join(',')} expected=${expectedBuild}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  console.log(`[release] OK ${expectedVersion} (${expectedBuild}) on Expo, iOS and Android`);
}

let exportRoot;
try {
  await verifyVersions();
  run('TypeScript', 'npx', ['tsc', '--noEmit', '--pretty', 'false'], mobileDir);
  run('Follower capacity tests', 'npm', ['run', 'test:capacity'], mobileDir);
  run('Flight time tests', 'npx', ['tsx', 'scripts/test-flight-times.ts'], mobileDir);
  run('Flight provider fallback tests', 'npx', ['tsx', 'scripts/test-flight-provider-fallback.ts'], mobileDir);
  run('Android launcher icon', 'npm', ['run', 'verify:android:icon'], mobileDir);
  run('Whitespace/conflict markers', 'git', ['diff', '--check'], repoRoot);
  run('Secret scan for latest commit', 'gitleaks', ['git', '--log-opts=-1', '--no-banner', '--redact'], repoRoot);
  run('Secret scan for pending changes', 'gitleaks', ['git', '--pre-commit', '--no-banner', '--redact'], repoRoot);

  if (!skipExport) {
    exportRoot = mkdtempSync(join(tmpdir(), 'flyfam-release-export-'));
    run(
      'Expo iOS production export',
      'npx',
      ['expo', 'export', '--platform', 'ios', '--output-dir', join(exportRoot, 'ios'), '--clear'],
      mobileDir,
      { NODE_ENV: 'production', EXPO_NO_TELEMETRY: '1' },
    );
    run(
      'Expo Android production export',
      'npx',
      ['expo', 'export', '--platform', 'android', '--output-dir', join(exportRoot, 'android'), '--clear'],
      mobileDir,
      { NODE_ENV: 'production', EXPO_NO_TELEMETRY: '1' },
    );
  } else {
    console.log('\n[release] Expo exports skipped by --skip-export');
  }

  console.log('\n[release] ALL CHECKS PASSED');
} catch (error) {
  console.error(`\n[release] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (exportRoot) rmSync(exportRoot, { recursive: true, force: true });
}
