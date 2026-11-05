import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../support/aile/index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../support/aile/sw.js', import.meta.url), 'utf8');
const notify = fs.readFileSync(new URL('../supabase/functions/family-planner/notify.ts', import.meta.url), 'utf8');
let failed = 0;
const eq = (name, ok) => { if (!ok) { failed += 1; console.error('FAIL', name); } };

eq('önbellek', sw.includes("const CACHE = 'aile-shell-v28'"));
eq('üç sekme', html.includes('data-tab="todo"') && html.includes('id="tabTodo"') && html.includes('id="todoAdd"'));
eq('geçmiş ay', html.includes('function moneyViewMonth') && html.includes('data-money-month') && !html.includes('Tarih bu aydan olsun'));
eq('bildirim metni', notify.includes('export function todoDigest') && notify.includes("'todo:' + today") && notify.includes("'Yapılacak: ' + t"));

const start = notify.indexOf('function validTodos');
const end = notify.indexOf('/** Kayıt öncesi');
const slice = notify.slice(start, end)
  .replace(/: Cfg/g, '')
  .replace(/: \{ id: string; text: string; due: string; done: boolean \}\[\]/g, '')
  .replace(/: string\[\]/g, '')
  .replace('export function todoDigest', 'function todoDigest');
const ctx = { addDays: (ymd, n) => new Date(Math.round(Date.parse(ymd + 'T00:00:00Z') / 86400000 + n) * 86400000).toISOString().slice(0, 10) };
vm.runInNewContext(slice + '\nthis.todoDigest = todoDigest;', ctx);
const d = ctx.todoDigest({
  todos: [
    { id: 'a', text: 'Ekim fişi', due: '2026-10-31', done: '' },
    { id: 'b', text: 'Bugün ara', due: '2026-11-05', done: false },
    { id: 'c', text: 'Yarın evrak', due: '2026-11-06' },
    { id: 'd', text: 'Bitti', due: '2026-11-05', done: '2026-11-04' },
    { id: 'e', text: 'Tarihsiz' },
  ],
}, '2026-11-05');
eq('geciken', d.overdue.length === 1 && d.overdue[0] === 'Ekim fişi');
eq('bugün', d.dueToday.length === 1 && d.dueToday[0] === 'Bugün ara');
eq('yarın', d.dueTomorrow.length === 1 && d.dueTomorrow[0] === 'Yarın evrak');
eq('biten yok', !JSON.stringify(d).includes('Bitti') && !JSON.stringify(d).includes('Tarihsiz'));

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('OK aile todo');
