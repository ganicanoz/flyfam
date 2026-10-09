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
const sw = fs.readFileSync(path.join(root, 'support/aile/sw.js'), 'utf8');
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
eq('sohbet dışarı tıklayınca kapanmaz', !html.includes("closeAssist();\n    });\n    $('assist')") && !html.includes('Bir bakayım'));
eq('gelir ekle ve roster', html.includes('>Gelir ekle<') && html.includes('id="moneyMemo"') && html.includes('class="clinic-btn') && html.includes('id="btnRoster"') && html.includes('function moneyMonthTotals') && !html.includes('id="moneyClinic"') && !html.includes('Ciro girişleri') && !html.includes('Son 6 ay'));
eq('önbellek v10', sw.includes("const CACHE = 'aile-shell-v10'"));
eq('selamlama', html.includes("const ESO_HI = 'Buyrun Doktor Hanımcım...'"));

const assistStart = script.indexOf('const TR_MONTHS');
const assistEnd = script.indexOf('const assistState');
if (assistStart < 0 || assistEnd < assistStart) {
  console.error('yorumlayıcı bloğu bulunamadı');
  process.exit(1);
}
const interpret = new Function(`
  const HOSPITAL_LABEL = 'Acıbadem Hastanesi';
  const HOSPITAL_SHORT = 'Acıbadem';
  const isHospitalText = (s) => /altunizade|acıbadem|acibadem/.test(String(s || '').toLocaleLowerCase('tr-TR'));
  const dayIndex = (ymd) => Math.round(Date.parse(ymd + 'T00:00:00Z') / 86400000);
  const ymdOf = (idx) => new Date(idx * 86400000).toISOString().slice(0, 10);
  const addDays = (ymd, n) => ymdOf(dayIndex(ymd) + n);
  const weekday = (ymd) => { const d = new Date(ymd + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
  const DAY_NAMES = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  const hm = (v) => { const m = /^(\\d{1,2}):(\\d{2})$/.exec(String(v || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  function appointmentWindow(cfg, place, ymd, start, end) {
    if (!place || place === 'home' || place !== 'konsolosluk') return { start, end, go: 0, back: 0, apptStart: start, apptEnd: end };
    const go = 40, back = 35;
    const s = Math.max(0, hm(start) - go);
    const e = Math.min(1439, hm(end) + back);
    const clock = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    return { start: clock(s), end: clock(e), go, back, apptStart: start, apptEnd: end };
  }
  const fmt = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const dateLong = (ymd) => ymd + ' ' + DAY_NAMES[weekday(ymd)];
  const placeLabel = (cfg, key) => ((cfg.places && cfg.places[key]) || {}).label || key;
  function vacationProblem(from, to) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(from || '') || !/^\\d{4}-\\d{2}-\\d{2}$/.test(to || '')) return 'geçersiz tarih';
    if (to < from) return 'bitiş başlangıçtan önce';
    return '';
  }
  function nowLocal() { return { ymd: '2026-10-06', min: 0 }; }
  ${script.slice(assistStart, assistEnd)}
  return { interpretAssist, resolveAssistTurn, parseAssistDate, parseAssistTimes, expandSpoken };
`)();

const TODAY = '2026-10-06';
const plan = {
  places: {
    altunizade: { label: 'Acıbadem Hastanesi', short: 'Acıbadem' },
    school: { label: 'Okul', short: 'Okul' },
  },
  partnerFixed: [
    { place: 'altunizade', label: 'Acıbadem Hastanesi', short: 'Acıbadem', start: '10:00', end: '16:00', weekdays: [2] },
    { place: 'school', label: 'Okul', short: 'Okul', start: '15:00', end: '16:00', weekdays: [4] },
  ],
  vacations: [{ from: '2026-10-10', to: '2026-10-12', label: 'Kapadokya' }],
};
function say(text, draft) {
  return draft == null ? interpret.interpretAssist(text, plan, TODAY) : interpret.resolveAssistTurn(text, draft, plan, TODAY);
}
function applied(res) {
  const full = JSON.parse(JSON.stringify(plan));
  res.apply(full);
  return full;
}

eq('konuşulan sayı', interpret.expandSpoken('altı ekim saat on altı') === '6 ekim saat 16');
eq('yazılı saat', interpret.parseAssistTimes('16:00').start === '16:00' && interpret.parseAssistTimes('16:00').end === '17:00');
eq('akşam dört', interpret.parseAssistTimes('akşam dört').start === '16:00');
eq('dokuzdan beşe', interpret.parseAssistTimes('9dan 5e').start === '09:00' && interpret.parseAssistTimes('9dan 5e').end === '17:00');
eq('salı bugün', interpret.parseAssistDate('salı', TODAY) === '2026-10-06');
eq('yarın', interpret.parseAssistDate('yarın', TODAY) === '2026-10-07');
eq('gelecek salı', interpret.parseAssistDate('gelecek salı', TODAY) === '2026-10-13');

const imza = say('6 ekimde 16:00 Acıbadem Hastanesi, o günkü iş imza');
eq('imza anlaşıldı', imza.ok && imza.apply);
const imzaFull = applied(imza);
const imzaRow = imzaFull.partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-06'));
eq('imza satırı', !!imzaRow && imzaRow.label === 'Acıbadem Hastanesi' && imzaRow.start === '16:00' && !imzaRow.icon && /imza/i.test(imzaRow.note));
eq('salı atlandı', imzaFull.partnerFixed[0].skipDates && imzaFull.partnerFixed[0].skipDates.includes('2026-10-06'));

const okul = say('yarın 14:00-15:30 okul toplantısı');
const okulFull = applied(okul);
const okulRow = okulFull.partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-07'));
eq('okul toplantısı', okul.ok && okulRow && okulRow.place === 'school' && okulRow.start === '14:00' && okulRow.end === '15:30' && okulRow.label === 'Toplantı');

const dis = say('yarın 11:00 diş hekimi');
const disFull = applied(dis);
const disRow = disFull.partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-07'));
eq('dişçi hastane değil', dis.ok && disRow && disRow.place === 'home' && disRow.label === 'Diş hekimi' && !disFull.partnerFixed[0].skipDates);

const skip = say('salı hastaneye gitmiyorum');
const skipFull = applied(skip);
eq('gitmiyorum atlar', skip.ok && skipFull.partnerFixed[0].skipDates.includes('2026-10-06') && !skipFull.partnerFixed.some((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-06')));

const spoken = say('altı ekim saat on altı hastanede imza');
const spokenRow = applied(spoken).partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-06'));
eq('konuşulan imza', spoken.ok && spokenRow && spokenRow.start === '16:00' && spokenRow.place === 'altunizade');

const vac = say('10-12 ekim Kapadokya tatil');
eq('tatil', vac.ok && applied(vac).vacations.some((v) => v.from === '2026-10-10' && v.to === '2026-10-12' && v.label === 'Kapadokya'));

const half = say('yarın hastane');
eq('saat sorar', !half.ok && half.keep && /Saat kaçta/.test(half.error));
const followed = say('16:00', 'yarın hastane');
const followedRow = applied(followed).partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-07'));
eq('devam cümlesi', followed.ok && followedRow && followedRow.start === '16:00' && followedRow.place === 'altunizade' && followed.draftNext === '');

const rename = say('hastaneye Acıbadem Hastanesi diyelim');
const renamed = applied(rename);
eq('ad değişir', rename.ok && renamed.places.altunizade.label === 'Acıbadem Hastanesi');

const visaPlan = JSON.parse(JSON.stringify(plan));
visaPlan.places.konsolosluk = { label: 'Konsolosluk', short: 'Konsolosluk' };
const visa = interpret.interpretAssist('12 ekim 10:00 vize randevusu konsolosluk', visaPlan, TODAY);
eq('vize anlaşıldı', visa.ok && visa.lines.some((l) => /09:20/.test(l) && /11:35/.test(l)) && visa.lines.some((l) => /gidiş 40 dk, dönüş 35 dk/.test(l)));
const visaFull = JSON.parse(JSON.stringify(visaPlan));
visa.apply(visaFull);
const visaRow = visaFull.partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-12'));
eq('vize bloğu', !!visaRow && visaRow.place === 'konsolosluk' && visaRow.start === '09:20' && visaRow.end === '11:35' && visaRow.label === 'Vize randevusu' && visaRow.includesTravel === true && /10:00/.test(visaRow.note) && /dönüş 35 dk/.test(visaRow.note));

const askWhere = interpret.interpretAssist('12 ekim 10:00 vize randevusu', plan, TODAY);
eq('yer sorar', !askWhere.ok && askWhere.keep && /Nerede/.test(askWhere.error || ''));

const made = interpret.interpretAssist('12 ekim 10:00 vize randevusu konsolosluk', plan, TODAY);
const madeFull = JSON.parse(JSON.stringify(plan));
made.apply(madeFull);
const madeRow = madeFull.partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-12'));
eq('yeni yer', made.ok && madeFull.places.konsolosluk && madeFull.places.konsolosluk.label === 'Konsolosluk' && madeRow && madeRow.start === '09:20' && madeRow.place === 'konsolosluk');

const followedVisa = interpret.resolveAssistTurn('konsolosluk', '12 ekim 10:00 vize randevusu', visaPlan, TODAY);
eq('vize devam', followedVisa.ok && followedVisa.lines.some((l) => /09:20/.test(l) && /Konsolosluk/.test(l)));

const moneyStart = script.indexOf('function placeBlob');
const moneyEnd = script.indexOf('function moneyMonthEnd');
if (moneyStart < 0 || moneyEnd < moneyStart) {
  console.error('para bloğu bulunamadı');
  process.exit(1);
}
const money = new Function(`
  function placeLabel(cfg, key) { return ((cfg.places && cfg.places[key]) || {}).label || key; }
  function finPlaceName(cfg, place) {
    const c = [...(cfg.partnerCandidates || []), ...(cfg.partnerFixed || [])].find((x) => x && String(x.place || x.id) === place);
    return (c && (c.short || c.label)) || placeLabel(cfg, place);
  }
  ${script.slice(moneyStart, moneyEnd)}
  return { moneyReceipts, moneyMonthTotals, moneyClinics };
`)();
const stored = money.moneyReceipts({
  finance: { receipts: [
    { id: 'a', ymd: '2026-10-02', place: 'altunizade', amount: 1000 },
    { id: 'b', ymd: '2026-10-02', place: 'altunizade', amount: '2500' },
    { id: 'c', ymd: '2026-10-09', place: 'konsolosluk', amount: 400 },
    { id: 'd', ymd: '2026-09-30', place: 'altunizade', amount: 9999 },
    { id: 'e', ymd: '2026-10-03', place: 'altunizade', amount: 0 },
  ] },
});
const totals = money.moneyMonthTotals(stored, '2026-10');
const alt = totals.find((x) => x.place === 'altunizade');
const kon = totals.find((x) => x.place === 'konsolosluk');
eq('ay toplamı', !!alt && alt.count === 2 && alt.sum === 3500 && !!kon && kon.sum === 400 && totals.every((x) => x.place !== 'diger'));
const clinics = money.moneyClinics({
  finance: { daily: ['altunizade'], monthly: [] },
  places: {
    home: { label: 'Ev' },
    school: { label: 'Okul' },
    crewBase: { label: 'Havalimanı' },
    konsolosluk: { label: 'Konsolosluk' },
    sogut: { label: 'Söğütlüçeşme tren' },
    maltepe: { label: 'Maltepe Üniversitesi', short: 'Maltepe' },
    muayene: { label: 'Muayene', short: 'Diş' },
    altunizade: { label: 'Acıbadem Hastanesi', short: 'Acıbadem' },
  },
  partnerFixed: [{ place: 'altunizade', short: 'Acıbadem' }, { place: 'konsolosluk', short: 'Vize randevu', label: 'Vize randevusu' }],
}, { finance: { receipts: [] } });
eq('klinik düğmeleri', clinics.length === 3 && clinics[0].key === 'altunizade' && clinics[0].label === 'Acıbadem' && clinics[0].logo.endsWith('logo-acibadem.svg') && clinics[1].key === 'maltepe' && clinics[1].label === 'Maltepe' && clinics[2].key === 'muayene' && clinics[2].label === 'Diş' && !clinics.some((c) => c.key === 'sogut' || c.key === 'konsolosluk' || c.key === 'home'));
const noted = money.moneyReceipts({ finance: { receipts: [{ id: 'n', ymd: '2026-10-08', place: 'altunizade', amount: 10, note: 'öğleden' }] } });
eq('gelir notu', noted.length === 1 && noted[0].note === 'öğleden' && noted[0].amount === 10);

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all ok');
