#!/usr/bin/env node
/**
 * Seeded 10-flight simulation using V3-style decision rules.
 *
 * Purpose:
 * - "Sanki bu benim uçuş listemmiş gibi" sabit bir 10'lu listeyi çalıştırır
 * - Status/phase kararını tablo halinde verir
 * - Provider çağrısı yapmaz (kota/rate-limit'ten bağımsız deterministik dry-run)
 * - Seed kaynağından (link/ekran) yalnızca uçuş kodu alınır; decision reason tamamen V3 kurallarından üretilir
 *
 * Usage:
 *   node scripts/run-seed10-chatllm-sim.js
 *   NOW_IST=2026-03-27T11:10:00 node scripts/run-seed10-chatllm-sim.js
 */

const IST_OFFSET = '+03:00';

/** Curated 10 — karışık havayolu / rota / gecikme senaryosu (sim için). */
const SEED_FLIGHTS = [
  // Departures (5)
  { flight: 'XQ794', dir: 'DEP', route: 'SAW->AYT', city: 'Antalya', std: '09:05', est: '09:12', board: null },
  { flight: 'PC2664', dir: 'DEP', route: 'SAW->ESB', city: 'Ankara', std: '08:10', est: null, board: null },
  { flight: 'TK2156', dir: 'DEP', route: 'IST->LGW', city: 'London', std: '14:20', est: '14:45', board: null },
  { flight: 'PC1043', dir: 'DEP', route: 'SAW->VIE', city: 'Vienna', std: '20:15', est: '20:15', board: null },
  { flight: 'PC2096', dir: 'DEP', route: 'SAW->COV', city: 'Cukurova', std: '16:40', est: '17:05', board: null },

  // Arrivals (5)
  { flight: 'TK1805', dir: 'ARR', route: 'LHR->IST', city: 'London', std: '14:55', est: '15:25', board: null },
  { flight: 'PC2012', dir: 'ARR', route: 'AYT->SAW', city: 'Antalya', std: '15:40', est: '15:38', board: null },
  { flight: 'PC2082', dir: 'ARR', route: 'COV->SAW', city: 'Cukurova', std: '16:40', est: '16:55', board: null },
  { flight: 'VF3002', dir: 'ARR', route: 'ESB->SAW', city: 'Ankara', std: '10:00', est: '09:58', board: null },
  { flight: 'PC2198', dir: 'ARR', route: 'ADB->SAW', city: 'Izmir', std: '19:45', est: '20:10', board: null },
];

function line(ch, n) {
  return ch.repeat(n);
}
function cell(v, w) {
  const s = (v == null || v === '') ? '—' : String(v);
  return s.length <= w ? s.padEnd(w) : s.slice(0, w - 1) + '…';
}

function toMsIst(dateStr, hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return 0;
  const iso = `${dateStr}T${hhmm}:00${IST_OFFSET}`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function nowIstDate() {
  const custom = process.env.NOW_IST;
  if (custom) {
    const s = custom.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(custom) ? custom : `${custom}${IST_OFFSET}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function ymdInIst(d) {
  // Shift to IST for date formatting
  const ms = d.getTime() + 3 * 60 * 60 * 1000;
  const x = new Date(ms);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolvePhase(nowMs, stdMs, staMs, status) {
  if (status === 'LANDED') return 'PASSIVE_PAST';
  if (!stdMs) return 'SEMI_ACTIVE';
  if (nowMs < stdMs - 3 * 60 * 60 * 1000) return 'PASSIVE_FUTURE';
  if (nowMs < stdMs - 20 * 60 * 1000) return 'SEMI_ACTIVE';
  const closeRef = staMs || (stdMs + 3 * 60 * 60 * 1000);
  if (nowMs < closeRef + 2 * 60 * 1000) return 'ACTIVE';
  return 'PASSIVE_PAST';
}

function deriveStatus(f, nowMs, stdMs, estMs) {
  const depRef = estMs || stdMs;
  const depDelay = stdMs > 0 && estMs > 0 ? Math.round((estMs - stdMs) / 60000) : null;

  // Departure side
  if (f.dir === 'DEP') {
    if (stdMs > 0 && nowMs >= stdMs - 20 * 60 * 1000 && nowMs < stdMs + 10 * 60 * 1000) {
      return {
        status: 'TAXI_OUT',
        confidence: 'MEDIUM',
        why: 'ACTIVE departure critical window (STD-20m..STD+10m) -> TAXI_OUT candidate',
        internal: 'TAXI_OUT',
        depDelayMin: depDelay,
        arrDelayMin: null,
        delayPhase: 'departure',
        delayVisible: depDelay != null && Math.abs(depDelay) >= 5,
        delayText: depDelay == null ? null : (depDelay >= 0 ? `+${depDelay}m` : `${depDelay}m`),
        reviewFlag: false,
      };
    }
    if (depRef > nowMs && depRef - nowMs <= 90 * 60 * 1000) {
      return {
        status: 'SCHEDULED',
        confidence: 'MEDIUM',
        why: 'Departure within 90 minutes, no movement signal yet',
        internal: 'SCHEDULED',
        depDelayMin: depDelay,
        arrDelayMin: null,
        delayPhase: 'departure',
        delayVisible: depDelay != null && Math.abs(depDelay) >= 5,
        delayText: depDelay == null ? null : (depDelay >= 0 ? `+${depDelay}m` : `${depDelay}m`),
        reviewFlag: false,
      };
    }
    if (depRef > 0 && nowMs > depRef + 30 * 60 * 1000) {
      return {
        status: 'TAXI_OUT',
        confidence: 'LOW',
        why: 'Past STD+30m with no takeoff evidence -> keep TAXI_OUT + review_flag',
        internal: 'TAXI_OUT',
        depDelayMin: depDelay,
        arrDelayMin: null,
        delayPhase: 'departure',
        delayVisible: depDelay != null && Math.abs(depDelay) >= 5,
        delayText: depDelay == null ? null : (depDelay >= 0 ? `+${depDelay}m` : `${depDelay}m`),
        reviewFlag: true,
      };
    }
    return {
      status: 'SCHEDULED',
      confidence: 'MEDIUM',
      why: 'No live movement signal; keep scheduled',
      internal: 'SCHEDULED',
      depDelayMin: depDelay,
      arrDelayMin: null,
      delayPhase: 'departure',
      delayVisible: depDelay != null && Math.abs(depDelay) >= 5,
      delayText: depDelay == null ? null : (depDelay >= 0 ? `+${depDelay}m` : `${depDelay}m`),
      reviewFlag: false,
    };
  }

  // Arrival side
  if (f.dir === 'ARR') {
    const arrDelay = stdMs > 0 && estMs > 0 ? Math.round((estMs - stdMs) / 60000) : null;
    if (depRef > nowMs + 15 * 60 * 1000) {
      return {
        status: 'EN_ROUTE',
        confidence: 'MEDIUM',
        why: 'Arrival ETA still ahead (>15m) -> EN_ROUTE',
        internal: 'EN_ROUTE',
        depDelayMin: null,
        arrDelayMin: arrDelay,
        delayPhase: 'arrival',
        delayVisible: arrDelay != null && Math.abs(arrDelay) >= 5,
        delayText: arrDelay == null ? null : (arrDelay >= 0 ? `+${arrDelay}m` : `${arrDelay}m`),
        reviewFlag: false,
      };
    }
    if (depRef > 0 && nowMs >= depRef - 20 * 60 * 1000 && nowMs <= depRef + 20 * 60 * 1000) {
      return {
        status: 'SCHEDULED',
        confidence: 'LOW',
        why: 'Arrival critical window (ETA±20m) without strong landed evidence -> keep previous user status; candidate internal',
        internal: 'LANDED_CANDIDATE',
        depDelayMin: null,
        arrDelayMin: arrDelay,
        delayPhase: 'arrival',
        delayVisible: arrDelay != null && Math.abs(arrDelay) >= 5,
        delayText: arrDelay == null ? null : (arrDelay >= 0 ? `+${arrDelay}m` : `${arrDelay}m`),
        reviewFlag: true,
      };
    }
    if (depRef > 0 && nowMs > depRef + 20 * 60 * 1000) {
      return {
        status: 'SCHEDULED',
        confidence: 'LOW',
        why: 'Past ETA+20m but no landed confirmation -> keep SCHEDULED + review (UNKNOWN hidden)',
        internal: 'SCHEDULED',
        depDelayMin: null,
        arrDelayMin: arrDelay,
        delayPhase: 'arrival',
        delayVisible: arrDelay != null && Math.abs(arrDelay) >= 5,
        delayText: arrDelay == null ? null : (arrDelay >= 0 ? `+${arrDelay}m` : `${arrDelay}m`),
        reviewFlag: true,
      };
    }
  }

  return {
    status: 'SCHEDULED',
    confidence: 'LOW',
    why: 'Insufficient evidence; keep SCHEDULED (UNKNOWN hidden)',
    internal: 'SCHEDULED',
    depDelayMin: null,
    arrDelayMin: null,
    delayPhase: null,
    delayVisible: false,
    delayText: null,
    reviewFlag: true,
  };
}

function landedEvidenceChecklist(f, status, internal) {
  // Seed simde provider alanları yok; bu yüzden kanıtları "missing" olarak gösteririz.
  const needsLandingEvidence = f.dir === 'ARR' || status === 'LANDED' || internal === 'LANDED_CANDIDATE';
  if (!needsLandingEvidence) return 'n/a';
  const dtLanded = false;
  const ended = false;
  const lastSeen20 = false;
  const missing = [];
  if (!dtLanded) missing.push('datetime_landed');
  if (!ended) missing.push('flight_ended');
  if (!lastSeen20) missing.push('last_seen>20m');
  return missing.join(', ');
}

function main() {
  const now = nowIstDate();
  const nowMs = now.getTime();
  const dateStr = ymdInIst(now);

  const rows = SEED_FLIGHTS.map((f) => {
    const stdMs = toMsIst(dateStr, f.std);
    const estMs = toMsIst(dateStr, f.est);
    const staMs = f.dir === 'ARR' ? (estMs || stdMs) : 0;
    const decision = deriveStatus(f, nowMs, stdMs, estMs);
    const phase = resolvePhase(nowMs, stdMs, staMs, decision.status);
    const landingMissing = landedEvidenceChecklist(f, decision.status, decision.internal);
    return {
      ...f,
      phase,
      status: decision.status,
      confidence: decision.confidence,
      internal: decision.internal,
      reviewFlag: !!decision.reviewFlag,
      depDelayMin: decision.depDelayMin ?? null,
      arrDelayMin: decision.arrDelayMin ?? null,
      delayVisible: !!decision.delayVisible,
      delayText: decision.delayText ?? null,
      why: decision.why,
      landingMissing,
      now_ist: now.toISOString().replace('T', ' ').slice(0, 19),
    };
  });

  console.log('\n' + line('═', 156));
  console.log(` FlyFam Seed10 Simulation (V3-style)  | NOW_IST=${rows[0]?.now_ist ?? '—'} | date=${dateStr}`);
  console.log(line('═', 156));

  const cols = [
    { h: '#', w: 2, f: (_, i) => i + 1 },
    { h: 'Flight', w: 8, f: (r) => r.flight },
    { h: 'Dir', w: 3, f: (r) => r.dir },
    { h: 'Route', w: 12, f: (r) => r.route },
    { h: 'STD', w: 5, f: (r) => r.std },
    { h: 'EST', w: 5, f: (r) => r.est || '—' },
    { h: 'Board', w: 12, f: (r) => r.board || 'seed_only' },
    { h: 'Phase', w: 14, f: (r) => r.phase },
    { h: 'Status', w: 10, f: (r) => r.status },
    { h: 'dep_delay', w: 9, f: (r) => (r.depDelayMin == null ? '—' : r.depDelayMin) },
    { h: 'arr_delay', w: 9, f: (r) => (r.arrDelayMin == null ? '—' : r.arrDelayMin) },
    { h: 'DelayShow', w: 9, f: (r) => (r.delayVisible ? (r.delayText ?? 'yes') : 'no') },
    { h: 'Conf', w: 6, f: (r) => r.confidence },
    { h: 'Review', w: 6, f: (r) => (r.reviewFlag ? 'true' : 'false') },
    { h: 'Internal', w: 16, f: (r) => r.internal },
    { h: 'Landed Kanıt Eksik', w: 38, f: (r) => r.landingMissing },
    { h: 'Decision Reason', w: 45, f: (r) => r.why },
  ];

  let header = '│';
  let bar = '├';
  for (const c of cols) {
    header += ' ' + cell(c.h, c.w) + ' │';
    bar += '─'.repeat(c.w + 2) + '┼';
  }
  console.log(header);
  console.log(bar.slice(0, -1) + '┤');
  rows.forEach((r, i) => {
    let out = '│';
    for (const c of cols) out += ' ' + cell(c.f(r, i), c.w) + ' │';
    console.log(out);
  });
  console.log(line('─', 156));

  const counts = rows.reduce((acc, r) => {
    acc.status[r.status] = (acc.status[r.status] || 0) + 1;
    acc.phase[r.phase] = (acc.phase[r.phase] || 0) + 1;
    return acc;
  }, { status: {}, phase: {} });
  console.log('Status summary:', JSON.stringify(counts.status));
  console.log('Phase summary :', JSON.stringify(counts.phase));
  console.log(line('═', 156) + '\n');
}

main();

