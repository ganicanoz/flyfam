#!/usr/bin/env node
/**
 * Aile planı: hastane adı yaması, imza rozeti ve Eso metinleri.
 * Çalıştırma: node scripts/test-aile-eso.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'support/aile/index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];

const start = script.indexOf('const CONFIG_MIG_OCT6_IMZA');
const end = script.indexOf('async function api(');
if (start < 0 || end < start) {
  console.error('migrate bloğu bulunamadı');
  process.exit(1);
}
const migrate = new Function(script.slice(start, end) + '\nreturn migrateConfigInPlace;')();

let failed = 0;
function eq(name, cond) {
  if (!cond) { failed += 1; console.error('FAIL', name); }
  else console.log('OK', name);
}

const fresh = {
  places: { altunizade: { label: 'Acıbadem Altunizade', short: 'Altunizade', address: 'Üsküdar' } },
  partnerFixed: [
    { place: 'altunizade', label: 'Acıbadem Altunizade (Salı)', short: 'Altunizade', start: '10:00', end: '16:00', weekdays: [2] },
    { place: 'okul', label: 'Toplantı', short: 'Toplantı', icon: 'T', weekdays: [3], start: '15:00', end: '16:00' },
  ],
};
eq('fresh migrate', migrate(fresh) === true);
const day = fresh.partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-06'));
eq('tek seferlik var', !!day && day.label === 'Acıbadem Hastanesi' && day.short === 'Acıbadem' && !day.icon && day.start === '16:00');
eq('not işi anlatıyor', !!day && /imza/.test(day.note));
eq('salı atlanır', fresh.partnerFixed[0].skipDates && fresh.partnerFixed[0].skipDates.includes('2026-10-06'));
eq('salı adı', fresh.partnerFixed[0].label === 'Acıbadem Hastanesi' && fresh.partnerFixed[0].short === 'Acıbadem');
eq('yer adı', fresh.places.altunizade.label === 'Acıbadem Hastanesi' && fresh.places.altunizade.address === 'Üsküdar');
eq('başka iş durur', fresh.partnerFixed.some((x) => x.icon === 'T' && x.label === 'Toplantı'));
eq('ikinci çağrı yok', migrate(fresh) === false);

const legacy = {
  places: { altunizade: { label: 'Altunizade', short: 'Altunizade' } },
  configMigrations: ['partner_fixed_2026_10_06_imza'],
  partnerFixed: [
    { place: 'altunizade', label: 'Acıbadem Altunizade (Salı)', short: 'Altunizade', weekdays: [2], start: '10:00', end: '16:00', skipDates: ['2026-10-06'] },
    { place: 'altunizade', label: 'Acıbadem Altunizade · sözleşme imza', short: 'İmza', icon: 'İ', start: '16:00', end: '17:00', dates: ['2026-10-06'], note: 'Bu gün imza.' },
  ],
};
eq('eski imza yaması', migrate(legacy) === true);
const old = legacy.partnerFixed[1];
eq('İ rozeti kalktı', old.icon == null && old.short === 'Acıbadem' && old.label === 'Acıbadem Hastanesi' && old.note === 'Bu gün imza.');
eq('eski tekrar yok', migrate(legacy) === false);

eq('tatil cümlesi', html.includes('Doktor Hanıım, bu ay bir seyehatiniz olacak mı?') && !html.includes('nereye gidiyoruz kankam'));
eq('eso duruyor', html.includes('id="esoDock"') && html.includes('Konuşarak söyle') && !html.includes('Plan asistanı'));
eq('İ ikonu üretilmiyor', !html.includes("icon: 'İ'") && !html.includes('short: \'İmza\''));

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all ok');
