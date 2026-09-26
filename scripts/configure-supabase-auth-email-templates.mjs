#!/usr/bin/env node
/**
 * Publish FlyFam-branded Supabase Auth email templates through Management API.
 *
 * Defaults to the three secondary flows so confirmation/recovery stay untouched.
 * Required: SUPABASE_ACCESS_TOKEN and EXPO_PUBLIC_SUPABASE_URL (root or mobile/.env).
 * Usage:
 *   node scripts/configure-supabase-auth-email-templates.mjs --show
 *   node scripts/configure-supabase-auth-email-templates.mjs --dry-run
 *   node scripts/configure-supabase-auth-email-templates.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadOneDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadOneDotEnv(path.join(root, '.env'));
loadOneDotEnv(path.join(root, 'mobile', '.env'));

function projectRefFromUrl(url) {
  return url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
}

const definitions = [
  {
    name: 'Invite user',
    file: 'invite.html',
    subjectKey: 'mailer_subjects_invite',
    templateKey: 'mailer_templates_invite_content',
    subject: 'FlyFam — Davetinizi kabul edin / Accept your invitation',
    marker: "FlyFam'e davet edildiniz",
  },
  {
    name: 'Magic link',
    file: 'magic-link.html',
    subjectKey: 'mailer_subjects_magic_link',
    templateKey: 'mailer_templates_magic_link_content',
    subject: 'FlyFam — Güvenli giriş bağlantınız / Your secure sign-in link',
    marker: "FlyFam'e güvenle giriş yapın",
  },
  {
    name: 'Change email address',
    file: 'change-email.html',
    subjectKey: 'mailer_subjects_email_change',
    templateKey: 'mailer_templates_email_change_content',
    subject: 'FlyFam — E-posta değişikliğini doğrulayın / Confirm your email change',
    marker: 'Yeni e-posta adresinizi doğrulayın',
  },
];

const showOnly = process.argv.includes('--show');
const dryRun = process.argv.includes('--dry-run');
const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || projectRefFromUrl(supabaseUrl);

if (!projectRef || !accessToken) {
  console.error('Missing SUPABASE_ACCESS_TOKEN or Supabase project URL.');
  process.exit(1);
}

const authConfigUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

async function readConfig() {
  const response = await fetch(authConfigUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  if (!response.ok) {
    console.error('GET auth config failed:', response.status, json.message ?? text.slice(0, 300));
    process.exit(1);
  }
  return json;
}

function status(config, definition) {
  const subjectOk = config[definition.subjectKey] === definition.subject;
  const content = String(config[definition.templateKey] ?? '');
  const contentOk = content.includes(definition.marker) && content.includes('app.flyfamapp.com/auth-callback.html');
  return { subjectOk, contentOk };
}

const before = await readConfig();
console.log('Project:', projectRef);
for (const definition of definitions) {
  const current = status(before, definition);
  console.log(`${definition.name}: subject=${current.subjectOk ? 'OK' : 'different'}, content=${current.contentOk ? 'OK' : 'different'}`);
}

if (showOnly) process.exit(0);

const payload = {};
for (const definition of definitions) {
  const filePath = path.join(root, 'supabase', 'templates', definition.file);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('app.flyfamapp.com/auth-callback.html')) {
    console.error(`Refusing to publish ${definition.file}: branded callback missing.`);
    process.exit(1);
  }
  payload[definition.subjectKey] = definition.subject;
  payload[definition.templateKey] = content;
}

if (dryRun) {
  console.log('Dry run — would update:', Object.keys(payload).join(', '));
  process.exit(0);
}

const patchResponse = await fetch(authConfigUrl, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});
const patchText = await patchResponse.text();
if (!patchResponse.ok) {
  let detail = patchText.slice(0, 300);
  try {
    detail = JSON.parse(patchText).message ?? detail;
  } catch {}
  console.error('PATCH auth config failed:', patchResponse.status, detail);
  process.exit(1);
}

const after = await readConfig();
let failed = false;
for (const definition of definitions) {
  const current = status(after, definition);
  const ok = current.subjectOk && current.contentOk;
  console.log(`${definition.name}: ${ok ? 'VERIFIED' : 'VERIFY FAILED'}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('OK — three secondary FlyFam Auth email templates are live.');
