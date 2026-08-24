#!/usr/bin/env node
/**
 * Enable Resend SMTP on Supabase Auth (hosted project) via Management API.
 *
 * Required in .env (repo root):
 *   RESEND_API_KEY=re_...
 *   SUPABASE_ACCESS_TOKEN=sbp_...   https://supabase.com/dashboard/account/tokens
 *   EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *
 * Optional:
 *   SMTP_FROM_EMAIL=auth@flyfamapp.com
 *   SMTP_SENDER_NAME=FlyFam
 *   SMTP_PORT=465
 *   RATE_LIMIT_EMAIL_SENT=100
 *
 * Usage:
 *   node scripts/configure-supabase-resend-smtp.mjs
 *   node scripts/configure-supabase-resend-smtp.mjs --dry-run
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

function loadDotEnv() {
  loadOneDotEnv(path.join(root, '.env'));
  loadOneDotEnv(path.join(root, 'mobile', '.env'));
}

function projectRefFromUrl(url) {
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return m?.[1] ?? '';
}

const dryRun = process.argv.includes('--dry-run');
loadDotEnv();

const supabaseUrl = (
  process.env.SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  ''
).trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const resendKey = process.env.RESEND_API_KEY?.trim();
const fromEmail = (process.env.SMTP_FROM_EMAIL ?? 'auth@flyfamapp.com').trim();
const senderName = (process.env.SMTP_SENDER_NAME ?? 'FlyFam').trim();
const smtpPort = String(process.env.SMTP_PORT ?? '465').trim();
const emailSentLimit = Number(process.env.RATE_LIMIT_EMAIL_SENT ?? '100');

const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() || projectRefFromUrl(supabaseUrl);

if (!projectRef) {
  console.error('Missing project ref. Set EXPO_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF.');
  process.exit(1);
}
if (!accessToken) {
  console.error('Missing SUPABASE_ACCESS_TOKEN.');
  console.error('Create one: https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}
if (!resendKey || !resendKey.startsWith('re_')) {
  console.error('Missing or invalid RESEND_API_KEY (must start with re_).');
  console.error('Create one: https://resend.com/api-keys');
  process.exit(1);
}

const payload = {
  external_email_enabled: true,
  smtp_admin_email: fromEmail,
  smtp_host: 'smtp.resend.com',
  smtp_port: smtpPort,
  smtp_user: 'resend',
  smtp_pass: resendKey,
  smtp_sender_name: senderName,
  rate_limit_email_sent: emailSentLimit,
};

console.log('Project:', projectRef);
console.log('SMTP host: smtp.resend.com:' + smtpPort);
console.log('From:', `${senderName} <${fromEmail}>`);
console.log('Rate limit (email_sent/hour):', emailSentLimit);

if (dryRun) {
  console.log('\n--dry-run: would PATCH auth config with keys:', Object.keys(payload).join(', '));
  process.exit(0);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text };
}

if (!res.ok) {
  console.error('PATCH failed:', res.status, json.message ?? json.error ?? text.slice(0, 500));
  process.exit(1);
}

console.log('\nOK — Resend SMTP enabled on Supabase Auth.');
console.log('\nNext steps:');
console.log('  1. Resend → Domains → verify flyfamapp.com (if not done)');
console.log('  2. Dashboard → Authentication → Email Templates → paste confirmation.html / recovery.html');
console.log('  3. Test signup + password reset');
console.log(
  '\nDashboard:',
  `https://supabase.com/dashboard/project/${projectRef}/auth/smtp`
);
