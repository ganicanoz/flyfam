#!/usr/bin/env node
/** Logbook: son PF/PM seçimi ve son tarihten sonraki Gmail taraması. */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'support/logbook');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const start = app.indexOf('function flownForNew');
const end = app.indexOf('function calculate');
if (start < 0 || end < start) throw new Error('app slice missing');
const context = { state: { version: 1, records: [], airports: {} }, START_DATE: '2026-10-12' };
vm.createContext(context);
vm.runInContext(app.slice(start, end), context);
const q = vm.runInContext;
if (q("flownForNew('yes')", context) !== 'yes') throw new Error('PF seçimi yeni kayda yazılmadı');
if (q("flownForNew('no')", context) !== 'no') throw new Error('PM seçimi bozuldu');
if (q('flownForNew(undefined)', context) !== 'no') throw new Error('seçim yokken eski PM varsayılanı durmalı');
if (q("syncAfterQuery('2026-10-29')", context) !== 'after:2026/10/28') throw new Error('son günün postası dışarıda kaldı');
if (q("syncAfterQuery('')", context) !== 'after:2026/10/11') throw new Error('boş defter 12 Ekim sınırını kaçırdı');
context.state.records = [{ date: '2026-10-12' }, { date: '2026-11-02' }, { date: '2026-09-01' }];
if (q('latestFlightDate()', context) !== '2026-11-02') throw new Error('son uçuş tarihi yanlış');
if (q('syncAfterQuery(latestFlightDate())', context) !== 'after:2026/11/01') throw new Error('tarama son tarihten önceye kaydı');
context.state.records.push({ kind: 'simulator', date: '2026-12-20' });
if (q('latestFlightDate()', context) !== '2026-11-02') throw new Error('simülatör tarihi Gmail taramasını ileri aldı');
const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
const gmail = fs.readFileSync(path.join(dir, 'gmail.js'), 'utf8');
if (!sw.includes("const CACHE='gani-logbook-v1.5.6'")) throw new Error('önbellek sürümü artmadı');
if (!sw.includes('return cached')) throw new Error('uçakta son ekran açılmıyor');
if (sw.includes('.navigate(')) throw new Error('yükleme bitmiyor');
if (q("resumeChoice({remoteCount:0,localCount:3,same:false,joined:false,dirty:false})", context) !== 'save') throw new Error('boş bulut yazılmadı');
if (q("resumeChoice({remoteCount:20,localCount:2,same:false,joined:false,dirty:false,syncIso:'',remoteSavedIso:'2026-10-31T12:00:00Z'})", context) !== 'open') throw new Error('yeni cihaz kayıtlı defteri açmadı');
if (q("resumeChoice({remoteCount:20,localCount:22,same:false,joined:true,dirty:true,syncIso:'2026-10-31T18:00:00Z',remoteSavedIso:'2026-10-31T12:00:00Z'})", context) !== 'save') throw new Error('bu cihazdaki yeni iş yazılmadı');
if (q("resumeChoice({remoteCount:20,localCount:20,same:true,joined:true,dirty:false})", context) !== 'same') throw new Error('aynı kayıt yeniden yazıldı');
const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
if (!page.includes('src="logo.png"') || !page.includes('apple-touch-icon.png') || !page.includes('id="version">v1.5.6') || !page.includes('>Kaydet<') || !page.includes('id="addSim"')) throw new Error('logo, sürüm, Kaydet veya simülatör');
if (!page.includes('id="closePage"') || !page.includes('id="closeBook"')) throw new Error('sayfa/defter kapat düğmesi yok');
if (!page.includes('id="prevBook"') || !page.includes('id="nextBook"')) throw new Error('defter gezinme yok');
const pfAt=page.indexOf('class="pfhead">PF</th>'),dateAt=page.indexOf('>1<br>DATE</th>');
if(pfAt<0||dateAt<0||pfAt>dateAt) throw new Error('PF sütunu solda değil');
if(page.includes('Açılış son sayfadadır')) throw new Error('gereksiz açıklama duruyor');
if (page.includes('Google ile giriş') || page.includes('Gmail bağlantısına hazır')) throw new Error('oturum yazısı duruyor');
if (!sw.includes('apple-touch-icon.png') || !sw.includes('logo.png')) throw new Error('ikon önbellekte yok');
if (q("calendarDaysSince('2026-10-29T12:00:00.000Z','2026-10-31T12:00:00.000Z')", context) !== 2) throw new Error('senkron gün farkı');
if (q('sinceLabel(0)', context) !== 'bugün' || q('sinceLabel(3)', context) !== '3 gün') throw new Error('geçen süre yazısı');
if (q("onlineBehindSync('2026-10-30T12:00:00.000Z','2026-10-31T12:00:00.000Z')", context) !== true) throw new Error('eski online kayıt uyarısız');
if (q("onlineBehindSync('2026-10-31T18:00:00.000Z','2026-10-31T12:00:00.000Z')", context) !== false) throw new Error('yeni online kayıt uyarıldı');
if (q("onlineBehindSync('','2026-10-31T12:00:00.000Z')", context) !== true) throw new Error('online kayıt yokken uyarı yok');
if (q("onlineBehindSync('2026-10-31T12:00:00.000Z','')", context) !== false) throw new Error('senkron yokken uyarı çıktı');
if (!sw.includes("cache:'no-store'")) throw new Error('yenileme eski kopyayı tutuyor');
if (!app.includes("updateViaCache:'none'")) throw new Error('servis güncellemesi erteleniyor');
if (!app.includes('controllerchange')) throw new Error('yeni sürüm sayfayı yenilemiyor');
if (!app.includes('function printBook') || !app.includes('win.print()')) throw new Error('yazdırma sayfası yok');
if (!app.includes('class="pfcell"')) throw new Error('PF işareti satır başında değil');
const cfg=fs.readFileSync(path.join(dir,'gmail-config.js'),'utf8');
if(!/account:\s*'[^']+'/.test(cfg)) throw new Error('varsayılan hesap yok');
if (!app.includes("reg:'TC-NBN'") || !app.includes("reg:'TC-RBP'")) throw new Error('11 Ekim uçuşları yok');
if (app.includes('[1,2,3].map')) throw new Error('üç boş açılış satırı duruyor');
const slotStart = app.indexOf('const PAGE_ROWS');
const slotEnd = app.indexOf('const sums');
if (slotStart < 0 || slotEnd < slotStart) throw new Error('sayfa slotları yok');
vm.runInContext(app.slice(slotStart, slotEnd), context);
context.state.records = [
  { openingSlot: 1, date: '2026-10-11', off: '2026-10-11T02:56:00Z', from: 'SAW', to: 'AYT' },
  { openingSlot: 2, date: '2026-10-11', off: '2026-10-11T07:03:00Z', from: 'AYT', to: 'SAW' },
  { date: '2026-10-12', off: '2026-10-12T08:00:00Z', from: 'SAW', to: 'HEL' },
  { date: '2026-10-13', off: '2026-10-13T09:00:00Z', from: 'SAW', to: 'ADB' },
];
const order = q('pageSlots(state.records).map(r=>r&&r.reserved?\'bos\':r.from+\'-\'+r.to)', context);
if (JSON.stringify(order) !== JSON.stringify(['SAW-AYT', 'AYT-SAW', 'SAW-HEL', 'bos', 'SAW-ADB'])) throw new Error('sıra: ' + JSON.stringify(order));
if (q('initialBookPage(1)', context) !== 0) throw new Error('tek sayfa kaydı');
if (q('initialBookPage(4)', context) !== 3) throw new Error('açılış son sayfa değil');
if (!app.includes('followLast')) throw new Error('açılış ilk sayfada kalıyor');
context.state.records = [
  { id: 'a', date: '2026-10-12', off: '2026-10-12T08:00:00Z', from: 'SAW', to: 'HEL' },
  { id: 'b', date: '2026-10-13', off: '2026-10-13T09:00:00Z', from: 'SAW', to: 'ADB' },
  { id: 'c', date: '2026-10-14', off: '2026-10-14T10:00:00Z', from: 'SAW', to: 'ESB' },
];
context.state.pageCloses = [{ afterId: 'b', closedAt: '2026-11-08T00:00:00Z' }];
context.state.bookCloses = [];
const closed = q("pageSlots(state.records).map(r=>r&&r.voided?'void':r&&r.reserved?'bos':r.id)", context);
if (closed.filter(x => x === 'void').length !== 13) throw new Error('sayfa kapatma boş satır doldurmadı: ' + JSON.stringify(closed));
if (closed.indexOf('c') < closed.lastIndexOf('void')) throw new Error('yeni uçuş kapalı sayfada kaldı');
if (closed.length !== 17) throw new Error('kapalı sayfa sonrası yeni satır yok: ' + closed.length);
context.state.pageCloses = [];
context.state.bookCloses = [{ afterId: 'b', closedAt: '2026-11-08T00:00:00Z', openingForNext: { block: 100, totalTime: 120, day: 1, landNight: 0, night: 0, ifr: 100, pic: 50, copilot: 50, se: 0, me: 0, fstd: 0 } }];
context.state.openingTotals = { block: 10, totalTime: 20, day: 0, landNight: 0, night: 0, ifr: 10, pic: 5, copilot: 5, se: 0, me: 0, fstd: 0 };
const segs = q('bookSegments(pageSlots(state.records))', context);
if (segs.length !== 2) throw new Error('defter kapatma iki defter açmadı');
if (segs[0].open !== false || segs[1].open !== true) throw new Error('açık defter bayrağı yanlış');
if (segs[1].openingTotals.block !== 100 || segs[1].openingTotals.totalTime !== 120) throw new Error('yeni defter devri yanlış');
if (segs[0].end - segs[0].start !== 16) throw new Error('kapalı defter sayfası tamamlanmadı');
if (q("lastClosable([{id:'x'},{voided:true},null]).id", context) !== 'x') throw new Error('son kapatılabilir satır');
if (!app.includes('function closePage') || !app.includes('function closeBook')) throw new Error('kapatma işlevi yok');
if (!app.includes('function voidBlockRows') || !app.includes('void-blank')) throw new Error('beyaz kapatma alanı yok');
if (app.includes('void-7') || app.includes('voidSevenMark') || app.includes('void-mark')) throw new Error('7 işareti duruyor');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
if (!css.includes('void-blank') || css.includes('void-7') || css.includes('void-cell')) throw new Error('kapatma stili yanlış');
const voidStart = app.indexOf('function voidBlockRows');
const voidEnd = app.indexOf('function render()');
if (voidStart < 0 || voidEnd < voidStart) throw new Error('voidBlockRows dilimi yok');
vm.runInContext(app.slice(voidStart, voidEnd), context);
const blank = q('voidBlockRows(3,4)', context);
if (!blank.includes('void-blank') || !blank.includes('colspan="26"') || (blank.match(/<tr /g)||[]).length!==4) throw new Error('beyaz kapatma satırları yanlış');
if (blank.includes('void-7') || blank.includes('<svg')) throw new Error('beyaz alanda çizgi var');
const carryStart = app.indexOf('const PAPER_CARRY');
const carryEnd = app.indexOf('if(storageOK&&state.paperCarry');
if (carryStart < 0 || carryEnd < carryStart) throw new Error('devir toplamı yok');
vm.runInContext(app.slice(carryStart, carryEnd) + `
if(PAPER_CARRY.se!==159*60+35||PAPER_CARRY.me!==16*60+35)throw new Error('SE/ME devri');
if(PAPER_CARRY.block!==2075*60+27||PAPER_CARRY.totalTime!==2223*60+24)throw new Error('blok veya toplam süre devri');
if(PAPER_CARRY.day!==818||PAPER_CARRY.landNight!==349||PAPER_CARRY.night!==707*60+49)throw new Error('iniş veya gece devri');
if(PAPER_CARRY.ifr!==2195*60+33||PAPER_CARRY.pic!==1074*60+34||PAPER_CARRY.copilot!==1027*60+58)throw new Error('IFR veya pilot süresi devri');
if(PAPER_CARRY.fstd!==233*60+30)throw new Error('simülatör süresi devri');
if(carriedTotal(PAPER_CARRY.block,PAPER_CARRY)!==PAPER_CARRY.totalTime)throw new Error('önceki sayfa toplamı');
if(carriedTotal(PAPER_CARRY.block+88,PAPER_CARRY)!==PAPER_CARRY.totalTime+88)throw new Error('yeni uçuş toplam süreye eklenmedi');
`, context);
if (!gmail.includes('flownForNew(next.defaultFlown)')) throw new Error('senkron yeni uçuşa seçimi yazmıyor');
if (!gmail.includes('s.defaultFlown=choice')) throw new Error('PF/PM kaydı hatırlanmıyor');
if (!gmail.includes('known.has(id)')) throw new Error('işlenmiş mail yine indiriliyor');
if (gmail.includes('navigator.onLine)loadGIS')) throw new Error('Google sayfa açılır açılmaz yükleniyor');
console.log('OK logbook sync');
