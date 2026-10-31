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
if (!sw.includes("const CACHE='gani-logbook-v1.4.2'")) throw new Error('önbellek sürümü artmadı');
if (!gmail.includes('flownForNew(next.defaultFlown)')) throw new Error('senkron yeni uçuşa seçimi yazmıyor');
if (!gmail.includes('s.defaultFlown=choice')) throw new Error('PF/PM kaydı hatırlanmıyor');
if (!gmail.includes('known.has(id)')) throw new Error('işlenmiş mail yine indiriliyor');
console.log('OK logbook sync');
