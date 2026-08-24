/**
 * Backfill crew_profiles.airline_icao from company_name using the same airline
 * dataset as the mobile app (docs/flyfam_airlines_pro_dataset.json).
 *
 * Updates a row when:
 *   - company_name is non-empty, AND
 *   - we find a unique match, AND
 *   - airline_icao is null/empty OR not a known ICAO in the dataset (e.g. typo "PGS")
 *
 * Env (repo root):
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...   (or SERVICE_ROLE_KEY)
 *
 * Usage:
 *   node scripts/backfill-crew-airline-icao.mjs           # dry-run (default)
 *   node scripts/backfill-crew-airline-icao.mjs --apply   # write to DB
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY)?.trim();
const apply = process.argv.includes('--apply');

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY).');
  process.exit(1);
}

const datasetPath = path.join(root, 'docs', 'flyfam_airlines_pro_dataset.json');
const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

function toAirline(item) {
  const iata = item.iata?.trim().toUpperCase();
  const icao = item.icao?.trim().toUpperCase();
  if (!iata || !icao || !item.name) return null;
  return { icao, iata, name: item.name.trim() };
}

const AIRLINES = raw.map(toAirline).filter(Boolean);
const VALID_ICAOS = new Set(AIRLINES.map((a) => a.icao));

function matchAirlineByCompanyText(input) {
  const rawIn = String(input ?? '').trim().toLowerCase();
  if (!rawIn) return null;

  let a = AIRLINES.find((x) => x.name.toLowerCase() === rawIn);
  if (a) return a;

  a = AIRLINES.find((x) => x.icao.toLowerCase() === rawIn);
  if (a) return a;

  a = AIRLINES.find((x) => x.iata.toLowerCase() === rawIn);
  if (a) return a;

  a = AIRLINES.find((x) => rawIn.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(rawIn));
  if (a) return a;

  return null;
}

function shouldBackfillIcao(companyName, currentIcao) {
  const match = matchAirlineByCompanyText(companyName);
  if (!match) return { match: null, reason: 'no_match' };

  const cur = String(currentIcao ?? '').trim().toUpperCase();
  if (!cur) return { match, reason: 'missing_icao' };
  if (!VALID_ICAOS.has(cur)) return { match, reason: 'invalid_icao' };
  if (cur !== match.icao) return { match: null, reason: 'icao_differs_skip' };
  return { match: null, reason: 'already_ok' };
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pageSize = 500;
let from = 0;
const updates = [];

for (;;) {
  const { data: rows, error } = await supabase
    .from('crew_profiles')
    .select('id, user_id, company_name, airline_icao')
    .range(from, from + pageSize - 1);

  if (error) {
    console.error(error);
    process.exit(1);
  }
  if (!rows?.length) break;

  for (const row of rows) {
    const cn = String(row.company_name ?? '').trim();
    if (!cn) continue;

    const { match, reason } = shouldBackfillIcao(cn, row.airline_icao);
    if (!match) continue;

    const next = match.icao;
    const cur = String(row.airline_icao ?? '').trim().toUpperCase();
    if (cur === next) continue;

    updates.push({
      id: row.id,
      user_id: row.user_id,
      company_name: cn,
      from_icao: row.airline_icao ?? null,
      to_icao: next,
      airline_name: match.name,
      reason,
    });
  }

  if (rows.length < pageSize) break;
  from += pageSize;
}

console.log(apply ? 'APPLY mode: writing updates.\n' : 'DRY-RUN (no DB writes). Pass --apply to update.\n');
console.log('Planned updates:', updates.length);
for (const u of updates) {
  console.log(
    `- ${u.id.slice(0, 8)}… user=${u.user_id.slice(0, 8)}… | "${u.company_name}" | ICAO ${u.from_icao ?? '(null)'} → ${u.to_icao} (${u.airline_name}) [${u.reason}]`,
  );
}

if (!apply || updates.length === 0) {
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const u of updates) {
  const { error } = await supabase.from('crew_profiles').update({ airline_icao: u.to_icao }).eq('id', u.id);
  if (error) {
    console.error('Update failed', u.id, error.message);
    fail += 1;
  } else {
    ok += 1;
  }
}
console.log(`Done. Updated ${ok}, failed ${fail}.`);
