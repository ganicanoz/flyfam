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
const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
const gmail = fs.readFileSync(path.join(dir, 'gmail.js'), 'utf8');
if (!sw.includes("const CACHE='gani-logbook-v1.4.6'")) throw new Error('önbellek sürümü artmadı');
if (!sw.includes("cache:'no-store'")) throw new Error('yenileme eski kopyayı tutuyor');
if (!app.includes("updateViaCache:'none'")) throw new Error('servis güncellemesi erteleniyor');
if (!app.includes("reg:'TC-NBN'") || !app.includes("reg:'TC-RBP'")) throw new Error('11 Ekim uçuşları yok');
if (app.includes('[1,2,3].map')) throw new Error('üç boş açılış satırı duruyor');
const slotStart = app.indexOf('function initialBookPage');
const slotEnd = app.indexOf('const sums');
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
console.log('OK logbook sync');
