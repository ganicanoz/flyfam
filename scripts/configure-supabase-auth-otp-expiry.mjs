#!/usr/bin/env node
/**
 * Set email confirmation / magic-link OTP lifetime on hosted Supabase (Management API).
 *
 * Dashboard'da "OTP expiry" alanı çoğu projede yok; API alan adı: mailer_otp_exp (saniye).
 *
 * Required in .env (repo root):
 *   SUPABASE_ACCESS_TOKEN=sbp_...   https://supabase.com/dashboard/account/tokens
 *   EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *
 * Optional:
 *   MAILER_OTP_EXP=86400   (default 24 hours; Supabase default is often 3600 = 1 hour)
 *
 * Usage:
 *   node scripts/configure-supabase-auth-otp-expiry.mjs
 *   node scripts/configure-supabase-auth-otp-expiry.mjs --dry-run
 *   node scripts/configure-supabase-auth-otp-expiry.mjs --show
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadOneDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const ENV_FILES = [path.join(root, '.env'), path.join(root, 'mobile', '.env')];

/** Kök .env sonra mobile/.env (eksik anahtarları doldurur). */
function loadDotEnv() {
  for (const envPath of ENV_FILES) {
    loadOneDotEnv(envPath);
  }
}

function envFileHasKey(envPath, key) {
  if (!fs.existsSync(envPath)) return false;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() === key) return true;
  }
  return false;
}

function printEnvDiagnostics() {
  console.error('Kontrol edilen dosyalar:');
  for (const envPath of ENV_FILES) {
    const exists = fs.existsSync(envPath);
    const hasKey = exists && envFileHasKey(envPath, 'SUPABASE_ACCESS_TOKEN');
    console.error(`  ${exists ? '✓' : '✗'} ${envPath}`);
    if (exists) {
      console.error(`      SUPABASE_ACCESS_TOKEN satırı: ${hasKey ? 'var' : 'YOK (veya # ile yorum)'}`);
    }
  }
}

function projectRefFromUrl(url) {
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return m?.[1] ?? '';
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return String(seconds);
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} gün`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} saat`;
  return `${seconds} sn`;
}

const dryRun = process.argv.includes('--dry-run');
const showOnly = process.argv.includes('--show');
loadDotEnv();

const supabaseUrl = (
  process.env.SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  ''
).trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const mailerOtpExp = Number(process.env.MAILER_OTP_EXP ?? '86400');

const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() || projectRefFromUrl(supabaseUrl);

if (!projectRef) {
  console.error('Missing project ref. Set EXPO_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF.');
  process.exit(1);
}
if (!accessToken) {
  console.error('Missing SUPABASE_ACCESS_TOKEN.\n');
  printEnvDiagnostics();
  console.error('');
  console.error('Bu, proje API sayfasındaki anon/service key DEĞİL.');
  console.error('Supabase hesabınız için tek seferlik Personal Access Token:');
  console.error('  https://supabase.com/dashboard/account/tokens');
  console.error('');
  console.error('mobile/.env sonuna ekleyin (# olmadan), dosyayı KAYDEDİN (Cmd+S):');
  console.error('  SUPABASE_ACCESS_TOKEN=sbp_...');
  console.error('');
  console.error('Veya tek seferlik terminalde (değeri yapıştırın):');
  console.error('  SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/configure-supabase-auth-otp-expiry.mjs --show');
  process.exit(1);
}
if (!Number.isFinite(mailerOtpExp) || mailerOtpExp < 60) {
  console.error('Invalid MAILER_OTP_EXP (min 60 seconds).');
  process.exit(1);
}

const authConfigUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

const getRes = await fetch(authConfigUrl, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const getText = await getRes.text();
let current;
try {
  current = JSON.parse(getText);
} catch {
  current = { raw: getText };
}

if (!getRes.ok) {
  console.error('GET auth config failed:', getRes.status, current.message ?? current.error ?? getText.slice(0, 500));
  process.exit(1);
}

const currentExp = current.mailer_otp_exp;
console.log('Project:', projectRef);
console.log('Current mailer_otp_exp:', currentExp, `(${formatDuration(currentExp)})`);

if (showOnly) process.exit(0);

console.log('Target mailer_otp_exp:', mailerOtpExp, `(${formatDuration(mailerOtpExp)})`);

if (dryRun) {
  console.log('\n--dry-run: would PATCH { mailer_otp_exp:', mailerOtpExp, '}');
  process.exit(0);
}

const patchRes = await fetch(authConfigUrl, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ mailer_otp_exp: mailerOtpExp }),
});

const patchText = await patchRes.text();
let patchJson;
try {
  patchJson = JSON.parse(patchText);
} catch {
  patchJson = { raw: patchText };
}

if (!patchRes.ok) {
  console.error('PATCH failed:', patchRes.status, patchJson.message ?? patchJson.error ?? patchText.slice(0, 500));
  process.exit(1);
}

console.log('\nOK — mailer_otp_exp updated to', patchJson.mailer_otp_exp ?? mailerOtpExp);
console.log(
  '\nNot: Supabase Dashboard’da bu alan görünmeyebilir; değeri doğrulamak için:',
  'node scripts/configure-supabase-auth-otp-expiry.mjs --show'
);
