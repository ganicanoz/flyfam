import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../support/aile/index.html',import.meta.url),'utf8');
const script=html.split('<script>')[1].split('</script>')[0];
const body=script.slice(script.indexOf('    function evalDay('),script.indexOf('    function compute('));
const evaluate=new Function(`
const st={draft:{}}; const COLORS={};
const hm=s=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
const fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const dayBase=(cfg,ymd)=>({ymd,base:0,wd:3,schoolDay:false,vac:cfg.vacations?.[0]||null});
const options=()=>({opts:[],rejected:[]}); const picksOf=()=>[];
const crewState=(ivs,s,e)=>ivs.some(iv=>iv.s<e&&iv.e>s&&iv.kind==='duty')?'duty':null;
${body}
return evalDay;
`)();
const appointments=[{person:'crew',date:'2026-10-14',start:'10:20',label:'Appointment',location:'Location'},{person:'child',date:'2026-10-16',start:'14:00',label:'Visa',location:'Location'}];
const cfg={people:{crew:'Crew',child:'Child'},crewDuty:{},partnerFixed:[],familyAppointments:appointments};
const ctx={cfg,crew:{intervals:[],labels:{}}};
let d=evaluate(ctx,'2026-10-14');
assert.equal(d.appointments.length,1);assert.equal(d.segs.crew[0].s,620);assert.equal(d.segs.child.length,0);assert.equal(d.segs.partner.length,0);assert.equal(d.fixed.length,0);assert.equal(d.segs.crew[0].point,true);
d=evaluate(ctx,'2026-10-16');assert.equal(d.segs.child[0].s,840);assert.equal(d.appointments.length,1);
assert.equal(evaluate(ctx,'2026-10-15').appointments.length,0);
assert.equal(evaluate({...ctx,cfg:{...cfg,vacations:[{label:'Holiday'}]}},'2026-10-16').appointments.length,1);
assert.equal(evaluate({...ctx,crew:{intervals:[{s:600,e:700,kind:'duty'}],labels:{}}},'2026-10-14').conflict,true);
console.log('Appointment dates, person rows, start markers, vacation preservation and flight conflict passed');
