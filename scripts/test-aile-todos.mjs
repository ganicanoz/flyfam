import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../support/aile/index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../support/aile/sw.js', import.meta.url), 'utf8');
const notify = fs.readFileSync(new URL('../supabase/functions/family-planner/notify.ts', import.meta.url), 'utf8');
let failed = 0;
const eq = (name, ok) => { if (!ok) { failed += 1; console.error('FAIL', name); } };

eq('önbellek', sw.includes("const CACHE = 'aile-shell-v29'"));
eq('iki kutu', html.includes('class="todo-board"') && html.includes('>Yeni iş<') && html.includes('>Liste'));
eq('önem ve sıralama', html.includes('data-todo-pri="high"') && html.includes('data-todo-sort="pri"') && html.includes('class="todo-ok"'));
eq('geciken kırmızı', html.includes('todo-item.late') && html.includes('#fef2f2'));
eq('gelir formu', html.includes('id="moneyForm"') && !html.includes('<form class="money-form"') && html.includes('if (!ymd) ymd ='));
eq('kayıt kilidi', html.includes('st.saveLock') && html.includes('st.dataGen'));
eq('alarmlar', notify.includes('export function todoAlarms') && notify.includes('high: [24, 12, 6, 3, 1]') && notify.includes('mid: [24, 3]'));

const start = notify.indexOf('function validTodos');
const end = notify.indexOf('/** Kayıt öncesi');
const slice = notify.slice(start, end).replace(/: Cfg/g, '').replace('export function todoAlarms', 'function todoAlarms');
const ctx = {};
vm.runInNewContext(slice + '\nthis.todoAlarms = todoAlarms;', ctx);
const cfg = {
  todos: [
    { id: 'h', text: 'Yüksek iş', due: '2026-11-06', dueTime: '18:00', pri: 'high' },
    { id: 'm', text: 'Orta iş', due: '2026-11-06', dueTime: '18:00', pri: 'mid' },
    { id: 'l', text: 'Düşük iş', due: '2026-11-05', pri: 'low' },
    { id: 'd', text: 'Bitti', due: '2026-11-05', pri: 'high', done: '2026-11-04' },
  ],
};
const dayBefore = ctx.todoAlarms(cfg, '2026-11-05', 18 * 60);
eq('yüksek 24s', dayBefore.some((n) => n.key === 'todo:h:24'));
eq('orta 24s', dayBefore.some((n) => n.key === 'todo:m:24'));
eq('düşük 24s yok', !dayBefore.some((n) => n.key.startsWith('todo:l:')));
const soon = ctx.todoAlarms(cfg, '2026-11-06', 17 * 60);
eq('yüksek 1s', soon.some((n) => n.key === 'todo:h:1'));
eq('orta 1s yok', !soon.some((n) => n.key === 'todo:m:1'));
const morning = ctx.todoAlarms(cfg, '2026-11-05', 9 * 60);
eq('düşük sabah', morning.some((n) => n.key === 'todo-day:l:2026-11-05'));
eq('biten yok', !JSON.stringify(morning).includes('Bitti') && !JSON.stringify(soon).includes('Bitti'));

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('OK aile todo');
