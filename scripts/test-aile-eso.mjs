#!/usr/bin/env node
/**
 * Aile planı: hastane adı yaması, imza, gelir, takvim ve Kasım kayıtları.
 * Çalıştırma: node scripts/test-aile-eso.mjs
 */
import fs from 'fs';
import { buildWorkIcs, WORK_HOLIDAYS } from '../supabase/functions/_shared/workCalendar.mjs';
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
eq('ev bakımı kaydı adsız', fresh.homeHelp && fresh.homeHelp.covers.includes('home') && fresh.homeHelp.mark === 'carpet' && !fresh.homeHelp.name);
const named = { configMigrations: (fresh.configMigrations || []).filter((x) => x !== 'home_help_carpet'), homeHelp: { name: 'Keep', covers: ['home'], mark: 'carpet' } };
eq('ad korunur', migrate(named) === true && named.homeHelp.name === 'Keep' && named.homeHelp.covers.includes('home'));
eq('ad ikinci yok', migrate(named) === false);

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

const sat = {
  places: { altunizade: { label: 'Acıbadem Hastanesi', short: 'Acıbadem' } },
  configMigrations: ['partner_fixed_2026_10_06_imza', 'partner_place_acibadem_hastanesi'],
  partnerFixed: [
    { place: 'muayene', label: 'Muayene', short: 'Diş', weekdays: [6], start: '10:00', end: '16:00' },
    { place: 'altunizade', label: 'Acıbadem Hastanesi', short: 'Acıbadem', weekdays: [2], start: '10:00', end: '16:00' },
    { place: 'muayene', label: 'Muayene', short: 'Diş', dates: ['2026-10-10'], start: '10:00', end: '14:00' },
  ],
  plans: { '2026-10': { '2026-10-10': { cand: 'x' }, '2026-10-12': { cand: 'y' } } },
  travel: { fallbackMin: [40, 55], pairs: {} },
};
eq('cumartesi yaması', migrate(sat) === true);
eq('cumartesi atlanır', !(sat.partnerFixed[0].skipDates || []).includes('2026-10-10'));
eq('o gün tek sefer kalkar', sat.partnerFixed.some((x) => x.place === 'muayene' && Array.isArray(x.dates) && x.dates.includes('2026-10-10')));
eq('o gün seçim silinir', sat.plans['2026-10']['2026-10-10'] && sat.plans['2026-10']['2026-10-12']);
const vfs = sat.partnerFixed.find((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-16'));
eq('vfs randevu', !!vfs && vfs.place === 'vfs' && vfs.label === 'Çekya vize' && vfs.short === 'VFS' && vfs.start === '13:20' && vfs.end === '15:40' && vfs.includesTravel === true && /14:00/.test(vfs.note) && sat.places.vfs && sat.places.vfs.label === 'VFS');
eq('cumartesi tekrar yok', migrate(sat) === false);

eq('tatil cümlesi', html.includes('Doktor Hanıım, bu ay bir seyehatiniz olacak mı?') && !html.includes('nereye gidiyoruz kankam'));
eq('eso yok', !html.includes('id="esoDock"') && !html.includes('ESO_HI') && !html.includes('interpretAssist') && !html.includes('Buyrun Doktor') && !html.includes('Konuşarak söyle'));
eq('İ ikonu üretilmiyor', !html.includes("icon: 'İ'") && !html.includes('short: \'İmza\''));
eq('gelir ekle ve roster', html.includes('>Gelir ekle<') && html.includes('id="moneyMemo"') && html.includes('class="clinic-btn') && html.includes('id="btnRoster"') && html.includes('function moneyMonthTotals') && !html.includes('id="moneyClinic"') && !html.includes('Ciro girişleri') && !html.includes('Son 6 ay'));
eq('önbellek v26', sw.includes("const CACHE = 'aile-shell-v26'") && sw.includes('/aile/work-cal.mjs') && !sw.includes('logo-dis-wide') && !html.includes('logo-dis-wide') && !html.includes("'<span>' + esc(c.label)") && html.includes('id="conflicts"') && html.includes('class="sug"') && html.includes('hours ticks') && html.includes("const bad = past ? ''") && html.includes('id="calYes"') && html.includes('family-planner-calendar') && html.includes('partner_off_acibadem_2026_10_11') && html.includes('id="schAdd"') && html.includes('school_closed_2026_11_16_20') && html.includes('vacation_hongkong_2026_11_18_25') && html.includes('visa_norway_2026_11_05_brief') && html.includes('family_appt_2026_11_08_alparslan') && html.includes('family_appt_2026_11_09_uk_visa') && html.includes("'hepimiz'") && html.includes('keyOf'));
eq('geçmiş kilit', html.includes('Geçmiş gün değişmez') && html.includes('Gerçekleşti') && html.includes('partner_off_2026_10_10') && html.includes('vfs_cekya_2026_10_16'));
eq('halı motifi', html.includes('function carpetSvg') && html.includes('home_help_carpet') && html.includes("fill=\"#c8102e\"") && !html.includes('function schoolRunHelp'));

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
  return { moneyReceipts, moneyMonthTotals, moneyClinics, clinicLogo };
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
eq('klinik düğmeleri', clinics.length === 3 && clinics[0].key === 'altunizade' && clinics[0].label === 'Acıbadem' && clinics[0].logo.endsWith('logo-acibadem.svg') && clinics[1].key === 'maltepe' && clinics[1].label === 'Maltepe' && clinics[2].key === 'muayene' && clinics[2].label === 'Diş' && !clinics.some((c) => c.key === 'sogut' || c.key === 'konsolosluk' || c.key === 'home' || c.wide));
const crossed = money.moneyClinics({
  places: {
    altunizade: { label: 'Acıbadem Hastanesi', short: 'Maltepe' },
    maltepe: { label: 'Maltepe Üniversitesi', short: 'Maltepe' },
    muayene: { label: 'Muayene', short: 'Diş' },
  },
  partnerFixed: [],
}, { finance: { receipts: [] } });
eq('hastane maltepe yazmaz', crossed[0].key === 'altunizade' && crossed[0].label === 'Acıbadem' && crossed[0].logo.endsWith('logo-acibadem.svg') && crossed[1].key === 'maltepe' && crossed[1].logo.endsWith('logo-maltepe.png') && money.clinicLogo({ places: { altunizade: { label: 'Acıbadem Hastanesi', short: 'Maltepe' } } }, 'altunizade').endsWith('logo-acibadem.svg'));
eq('diş logosu T', money.clinicLogo({ places: { klinik: { label: 'Maltepe', short: 'Maltepe' } } }, { place: 'klinik', label: 'Muayene', short: 'Diş' }).endsWith('logo-dis.png'));
eq('üniversite alev', money.clinicLogo({ places: { maltepe: { label: 'Maltepe Üniversitesi', short: 'Maltepe' } } }, 'maltepe').endsWith('logo-maltepe.png'));
const noted = money.moneyReceipts({ finance: { receipts: [{ id: 'n', ymd: '2026-10-08', place: 'altunizade', amount: 10, note: 'öğleden' }] } });
eq('gelir notu', noted.length === 1 && noted[0].note === 'öğleden' && noted[0].amount === 10);

const hospOff = {
  configMigrations: ['partner_fixed_2026_10_06_imza', 'partner_place_acibadem_hastanesi', 'partner_off_2026_10_10', 'vfs_cekya_2026_10_16'],
  places: { altunizade: { label: 'Acıbadem Hastanesi', short: 'Acıbadem', address: 'Üsküdar' }, maltepe: { label: 'Maltepe Üniversitesi', short: 'Maltepe' } },
  partnerFixed: [
    { place: 'altunizade', label: 'Acıbadem Hastanesi', weekdays: [2], start: '09:00', end: '16:00' },
    { place: 'altunizade', label: 'Acıbadem Hastanesi', dates: ['2026-10-11'], start: '10:00', end: '14:00' },
    { place: 'maltepe', label: 'Maltepe Üniversitesi', weekdays: [4], start: '09:00', end: '16:00' },
  ],
  plans: { '2026-10': {
    '2026-10-11': { place: 'altunizade', label: 'Acıbadem Hastanesi', start: '09:00', end: '16:00' },
    '2026-10-12': { place: 'maltepe', label: 'Maltepe Üniversitesi', start: '16:00', end: '20:00' },
  } },
  rosters: [{ flight_number: 'PC9999' }],
};
eq('dün hastane yaması', migrate(hospOff) === true);
eq('hastane 11 ekim atlanır', hospOff.partnerFixed[0].skipDates && hospOff.partnerFixed[0].skipDates.includes('2026-10-11'));
eq('o gün tek sefer hastane kalkar', !hospOff.partnerFixed.some((x) => Array.isArray(x.dates) && x.dates.includes('2026-10-11')));
eq('üniversite 11 ekim durur', !(hospOff.partnerFixed.find((x) => x.place === 'maltepe').skipDates || []).includes('2026-10-11'));
eq('o gün hastane seçimi silinir', !hospOff.plans['2026-10']['2026-10-11'] && hospOff.plans['2026-10']['2026-10-12']);
eq('dün hastane tekrar yok', migrate(hospOff) === false);
const ics = buildWorkIcs(hospOff, { today: '2026-10-12', from: '2026-10-01', to: '2026-10-31' });
eq('11 ekim takvimde yok', !ics.includes('20261011T'));
eq('sonraki salı durur', ics.includes('DTSTART;TZID=Europe/Istanbul:20261013T090000') && ics.includes('SUMMARY:Acıbadem Hastanesi'));
eq('uçuş takvime girmez', !ics.includes('PC9999') && ics.includes('X-WR-CALNAME:Çalışma'));
eq('onaysız otomatik yok', !html.includes('st.full.calendarOk = true;\n      ensureCalendarToken'));
const calA = fs.readFileSync(path.join(root, 'supabase/functions/_shared/workCalendar.mjs'));
const calB = fs.readFileSync(path.join(root, 'support/aile/work-cal.mjs'));
eq('takvim dosyası aynı', calA.equals(calB));
const holStart = script.indexOf('const HOLIDAYS = ');
const holEnd = script.indexOf(';', holStart);
const pageHolidays = new Function(script.slice(holStart, holEnd + 1) + '\nreturn HOLIDAYS;')();
eq('tatil günleri aynı', JSON.stringify(pageHolidays) === JSON.stringify(WORK_HOLIDAYS));

const nov = {
  configMigrations: ['partner_fixed_2026_10_06_imza', 'partner_place_acibadem_hastanesi', 'partner_off_2026_10_10', 'vfs_cekya_2026_10_16', 'partner_off_acibadem_2026_10_11'],
  school: { weekdays: [1, 2, 3, 4, 5], start: '09:30', end: '15:00', closedDates: [] },
  vacations: [],
  plans: { '2026-11': { '2026-11-19': { place: 'maltepe', label: 'Maltepe', start: '16:00', end: '20:00' }, '2026-11-26': { place: 'maltepe', start: '16:00', end: '20:00' } } },
  partnerFixed: [{ place: 'altunizade', label: 'Acıbadem Hastanesi', weekdays: [2], start: '09:00', end: '16:00' }],
};
eq('kasım yaması', migrate(nov) === true);
eq('okul 16-20 kapalı', JSON.stringify(nov.school.closedDates) === JSON.stringify(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']));
const norway = (nov.familyAppointments || []).filter((a) => a.date === '2026-11-05');
eq('vize görüşmesi üç kişi', norway.length === 3 && ['child', 'partner', 'crew'].every((p) => norway.some((a) => a.person === p && a.start === '10:15' && !a.end && a.label === 'vize görüşmesi' && !a.location)) && norway.find((a) => a.person === 'child').thenSchool === true && !norway.some((a) => a.person !== 'child' && a.thenSchool));
const bday = (nov.familyAppointments || []).filter((a) => a.date === '2026-11-08');
eq('doğum günü kahvaltısı üç kişi', bday.length === 3 && ['child', 'partner', 'crew'].every((p) => bday.some((a) => a.person === p && a.start === '10:00' && a.label === 'Alparslan doğum günü kahvaltısı' && a.location === 'Ercan Steakhouse, Başakşehir')));
const uk = (nov.familyAppointments || []).filter((a) => a.date === '2026-11-09');
eq('UK vize üç kişi', uk.length === 3 && ['child', 'partner', 'crew'].every((p) => uk.some((a) => a.person === p && a.start === '15:00' && a.label === 'UK vize görüşmesi' && a.location === 'VFS Astoria AVM')));
eq('hong kong tatil', nov.vacations.some((v) => v.from === '2026-11-18' && v.to === '2026-11-25' && v.label === 'Hong Kong'));
eq('tatilde iş seçimi silinir', !nov.plans['2026-11']['2026-11-19'] && !!nov.plans['2026-11']['2026-11-26']);
eq('kasım tekrar yok', migrate(nov) === false);

const helpStart = script.indexOf('function homeHelpOf');
const helpEnd = script.indexOf('function needText');
if (helpStart < 0 || helpEnd < helpStart) {
  console.error('ev bakımı bloğu bulunamadı');
  process.exit(1);
}
const help = new Function(script.slice(helpStart, helpEnd) + '\nreturn { homeHelpOf, coverHomeCare };')();
const helpCfg = { homeHelp: { name: 'Yardimci', covers: ['home'] } };
eq('ev bakımı açık', help.homeHelpOf(helpCfg).name === 'Yardimci');
eq('okul yolu kapalı', help.homeHelpOf({ homeHelp: { covers: ['drop', 'pick'] } }) == null);
const needs = [
  { what: 'evde bakım', st: 'away' },
  { what: 'okula götürme', st: 'duty', run: true },
  { what: 'evde bakım', st: null },
  { what: 'evde bakım', st: 'standby' },
];
help.coverHomeCare(helpCfg, needs);
eq('yatıda evde bakar', needs[0].help === true && needs[0].st == null && needs[0].helpName === 'Yardimci');
eq('okul bırakma durur', needs[1].st === 'duty' && !needs[1].help);
eq('müsait crew durur', needs[2].st == null && !needs[2].help);
eq('nöbette evde bakar', needs[3].help === true && needs[3].st == null);

const partial = {
  configMigrations: ['partner_fixed_2026_10_06_imza', 'partner_place_acibadem_hastanesi', 'partner_off_2026_10_10', 'vfs_cekya_2026_10_16', 'partner_off_acibadem_2026_10_11', 'school_closed_2026_11_16_20', 'vacation_hongkong_2026_11_18_25', 'home_help_carpet'],
  familyAppointments: [{ id: 'keep', person: 'child', date: '2026-11-05', start: '10:15', label: 'Norveç vize görüşmesi', location: 'eski' }],
  school: { closedDates: ['2026-11-16'] },
  vacations: [{ from: '2026-11-18', to: '2026-11-25', label: 'Hong Kong' }],
};
eq('eksik kişiler tamamlanır', migrate(partial) === true);
const kept = partial.familyAppointments.find((a) => a.id === 'keep');
eq('ayrıntı silinir', !!kept && kept.label === 'vize görüşmesi' && !kept.location && kept.thenSchool === true && partial.familyAppointments.filter((a) => a.person === 'child' && a.date === '2026-11-05').length === 1);
eq('eş ve ekip eklenir', ['partner', 'crew'].every((p) => partial.familyAppointments.some((a) => a.person === p && a.date === '2026-11-05' && a.start === '10:15' && a.label === 'vize görüşmesi' && !a.location)));
eq('okul günü açık', !partial.school.closedDates.includes('2026-11-05') && partial.school.closedDates.includes('2026-11-16'));
eq('norveç tekrar yok', migrate(partial) === false);
const messy = {
  configMigrations: ['visa_norway_2026_11_05', 'home_help_carpet', 'school_closed_2026_11_16_20', 'vacation_hongkong_2026_11_18_25', 'partner_off_acibadem_2026_10_11', 'partner_off_2026_10_10', 'vfs_cekya_2026_10_16', 'partner_place_acibadem_hastanesi', 'partner_fixed_2026_10_06_imza'],
  familyAppointments: ['child', 'partner', 'crew'].map((person) => ({ id: 'visa-norway-2026-11-05-' + person, person, date: '2026-11-05', start: '10:15', label: 'Norveç vize görüşmesi', location: 'adres' })),
  school: { closedDates: ['2026-11-05', '2026-11-16'] },
  vacations: [{ from: '2026-11-18', to: '2026-11-25', label: 'Hong Kong' }],
};
eq('uzun metin kısalır', migrate(messy) === true && messy.familyAppointments.filter((a) => a.date === '2026-11-05').every((a) => a.label === 'vize görüşmesi' && !a.location) && messy.familyAppointments.find((a) => a.person === 'child' && a.date === '2026-11-05').thenSchool === true && !messy.school.closedDates.includes('2026-11-05') && messy.school.closedDates.includes('2026-11-16'));
eq('kısa tekrar yok', migrate(messy) === false);
eq('messy doğum/UK eklenir', messy.familyAppointments.filter((a) => a.date === '2026-11-08').length === 3 && messy.familyAppointments.filter((a) => a.date === '2026-11-09').length === 3);
eq('ad yok', !html.includes('Aybölek') && !html.includes('Aybolek') && !html.includes('Oben') && !html.includes('Ofton') && !html.includes('NOR23622921493'));

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all ok');
