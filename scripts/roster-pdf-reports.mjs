#!/usr/bin/env node
/**
 * Kullanıcıların onayla gönderdiği roster PDF hata raporları (private bucket `roster-pdf-reports`).
 *
 *   node scripts/roster-pdf-reports.mjs list [--all]
 *   node scripts/roster-pdf-reports.mjs fetch [--all] [--out DIR]   (varsayılan: ~/Downloads/flyfam-roster-reports)
 *   node scripts/roster-pdf-reports.mjs mark <id-prefix> reviewed|fixed
 *
 * Anahtarlar Supabase CLI oturumundan okunur, yazdırılmaz. PDF'ler kişisel veri içerir: repoya koyma,
 * işin bitince yerel kopyaları sil. Sunucu kopyası 30 günde otomatik silinir.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'mobile', 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const REF = process.env.SUPABASE_PROJECT_REF || 'slmgmcpluanezvkgkozw';
const BUCKET = 'roster-pdf-reports';
const args = process.argv.slice(2);
const cmd = args[0] || 'list';
const all = args.includes('--all');
const outIdx = args.indexOf('--out');
const outDir = outIdx > 0 ? path.resolve(args[outIdx + 1]) : path.join(os.homedir(), 'Downloads', 'flyfam-roster-reports');

function serviceClient() {
  const raw = execSync(`npx -y supabase@2.118.0 projects api-keys --project-ref ${REF} -o json`, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  const key = JSON.parse(raw).find((k) => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('service_role key not available (supabase login?)');
  return createClient(`https://${REF}.supabase.co`, key, { auth: { persistSession: false } });
}

async function listReports(db) {
  let q = db
    .from('roster_pdf_reports')
    .select('id, user_id, reason, airline_icao, parse_source, app_version, platform, size_bytes, meta, status, created_at, expires_at, storage_path')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!all) q = q.eq('status', 'new');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

const db = serviceClient();

if (cmd === 'list' || cmd === 'fetch') {
  const rows = await listReports(db);
  if (!rows.length) console.log(all ? 'Rapor yok.' : 'Yeni rapor yok (tümü için --all).');
  for (const r of rows) {
    const meta = r.meta && Object.keys(r.meta).length ? ` ${JSON.stringify(r.meta)}` : '';
    console.log(`${r.id.slice(0, 8)}  ${r.created_at.slice(0, 16)}  ${r.status.padEnd(8)} ${r.reason.padEnd(7)} ${r.airline_icao ?? '-'}  ${r.parse_source ?? '-'}  app ${r.app_version ?? '-'}  user ${r.user_id.slice(0, 8)}${meta}`);
  }
  if (cmd === 'fetch' && rows.length) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const r of rows) {
      const file = path.join(outDir, `${r.created_at.slice(0, 10)}_${r.airline_icao ?? 'X'}_${r.reason}_${r.id.slice(0, 8)}.pdf`);
      if (fs.existsSync(file)) continue;
      const { data, error } = await db.storage.from(BUCKET).download(r.storage_path);
      if (error || !data) {
        console.log(`! ${r.id.slice(0, 8)} indirilemedi: ${error?.message ?? 'empty'}`);
        continue;
      }
      fs.writeFileSync(file, Buffer.from(await data.arrayBuffer()));
    }
    console.log(`\nKlasör: ${outDir}`);
  }
} else if (cmd === 'mark') {
  const [, prefix, status] = args;
  if (!prefix || !['new', 'reviewed', 'fixed'].includes(status)) {
    console.log('Kullanım: mark <id-prefix> reviewed|fixed');
    process.exit(1);
  }
  const { data, error: listErr } = await db.from('roster_pdf_reports').select('id').order('created_at', { ascending: false }).limit(1000);
  if (listErr) throw new Error(listErr.message);
  const ids = (data ?? []).map((r) => r.id).filter((id) => id.startsWith(prefix));
  if (ids.length !== 1) {
    console.log(`Eşleşen rapor sayısı: ${ids.length} (tam bir tane olmalı)`);
    process.exit(1);
  }
  const { error } = await db.from('roster_pdf_reports').update({ status }).eq('id', ids[0]);
  console.log(error ? `Hata: ${error.message}` : `${ids[0].slice(0, 8)} → ${status}`);
} else {
  console.log('Komutlar: list | fetch | mark');
  process.exit(1);
}
