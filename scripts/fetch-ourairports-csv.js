/**
 * OurAirports güncel airports.csv indirir (dünya geneli ~80k+ kayıt, koordinatlı).
 * timezone kolonu yok; import script geo-tz ile IANA üretir.
 *
 *   node scripts/fetch-ourairports-csv.js
 * Çıktı: scripts/data/airports-ourairports.csv
 */

const fs = require('fs');
const path = require('path');

const URL = 'https://ourairports.com/data/airports.csv';
const outPath = path.join(__dirname, 'data', 'airports-ourairports.csv');

async function main() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  console.log('Downloading', URL, '...');
  const res = await fetch(URL);
  if (!res.ok) {
    console.error(res.status, res.statusText);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim()).length;
  console.log('Wrote', outPath, `(${lines} lines)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
