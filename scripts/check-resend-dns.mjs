#!/usr/bin/env node
/**
 * Resend + flyfam.app kurulum kontrolü (DNS + isteğe bağlı API gönderim testi).
 *
 * Usage:
 *   node scripts/check-resend-dns.mjs
 *   node scripts/check-resend-dns.mjs --send-test you@example.com
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadDotEnv() {
  for (const rel of ['.env', path.join('mobile', '.env')]) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

function dig(name, type) {
  try {
    const out = execSync(`dig ${type} ${name} +short`, { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

loadDotEnv();

const fromEmail = (process.env.SMTP_FROM_EMAIL ?? 'auth@flyfamapp.com').trim();
const mailDomain = fromEmail.includes('@') ? fromEmail.split('@')[1] : 'flyfamapp.com';
const resendKey = process.env.RESEND_API_KEY?.trim();
const sendTestArg = process.argv.find((a) => a.startsWith('--send-test='));
const sendTestTo = sendTestArg?.split('=')[1]?.trim();

console.log('FlyFam — Resend / DNS kontrol\n');
console.log('Mail domain:', mailDomain, '| From:', fromEmail);

const ns = dig(mailDomain, 'NS');
console.log(`1) Nameserver (${mailDomain})`);
if (ns) {
  console.log('   ', ns.replace(/\n/g, '\n    '));
  if (/cloudflare/i.test(ns)) {
    console.log('   → Cloudflare aktif (Resend “Sign in to Cloudflare” kullanılabilir)');
  } else if (/ui-dns|ionos/i.test(ns)) {
    console.log('   → IONOS / ui-dns (DNS kayıtlarını IONOS panelinde elle ekleyin)');
  }
} else {
  console.log('   (NS bulunamadı)');
}

console.log('\n2) Resend DNS kayıtları (doğrulanmış domain için dolu olmalı)');
const checks = [
  { label: `MX send.${mailDomain}`, value: dig(`send.${mailDomain}`, 'MX') },
  { label: `TXT send.${mailDomain} (SPF)`, value: dig(`send.${mailDomain}`, 'TXT') },
  {
    label: `TXT resend._domainkey.${mailDomain} (DKIM)`,
    value: dig(`resend._domainkey.${mailDomain}`, 'TXT'),
  },
];
let dnsOk = true;
for (const c of checks) {
  const ok = Boolean(c.value);
  if (!ok) dnsOk = false;
  console.log(`   ${ok ? '✓' : '✗'} ${c.label}`);
  if (c.value) console.log('     ', c.value.replace(/\n/g, '\n      '));
}

console.log('\n3) Supabase SMTP (Management API)');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
const ref = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!accessToken || !ref) {
  console.log('   Atlandı (SUPABASE_ACCESS_TOKEN veya URL yok)');
} else {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await res.json();
  if (!res.ok) {
    console.log('   Hata:', res.status, j.message ?? j);
  } else {
    const smtpOk = j.smtp_host === 'smtp.resend.com' && j.smtp_admin_email === fromEmail;
    console.log(`   ${smtpOk ? '✓' : '✗'} smtp_host=${j.smtp_host}, from=${j.smtp_admin_email}`);
    console.log(`   rate_limit_email_sent=${j.rate_limit_email_sent}, mailer_otp_exp=${j.mailer_otp_exp}`);
  }
}

console.log('\n4) Resend gönderim (API)');
if (!resendKey) {
  console.log('   Atlandı (RESEND_API_KEY yok)');
} else if (sendTestTo) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `FlyFam <${fromEmail}>`,
      to: [sendTestTo],
      subject: 'FlyFam Resend test',
      html: '<p>Resend domain test — FlyFam</p>',
    }),
  });
  const j = await res.json();
  console.log('   status', res.status, j.message ?? j.id ?? JSON.stringify(j));
} else {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `FlyFam <${fromEmail}>`,
      to: ['resend-dns-check@invalid.test'],
      subject: 'domain check',
      html: '<p>x</p>',
    }),
  });
  const j = await res.json();
  if (res.status === 403 && /not verified/i.test(j.message ?? '')) {
    console.log('   ✗ Domain doğrulanmamış:', j.message);
  } else if (res.ok) {
    console.log('   ✓ Gönderim kabul edildi (id:', j.id, ')');
  } else {
    console.log('   ', res.status, j.message ?? JSON.stringify(j));
  }
}

console.log('\n--- Özet ---');
if (!dnsOk) {
  console.log('BLOKER: Resend DNS kayıtları yok veya henüz yayılmadı.');
  console.log('Sonraki adım: docs/RESEND_DNS_FLYFAM_APP_TR.md → IONOS’a 3 kayıt → Resend’de Verify');
  console.log('Rehber: docs/RESEND_KURULUM_DURUM.md');
} else {
  console.log('DNS kayıtları görünüyor. Resend panelinde domain “Verified” olmalı; değilse Verify’e basın.');
}
console.log('Kontrol: node scripts/check-resend-dns.mjs --send-test=SIZIN@EMAIL.com');
