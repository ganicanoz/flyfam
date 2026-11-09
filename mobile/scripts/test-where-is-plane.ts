/**
 * Unit checks for Where-is-my-plane URL + visibility + reg override pick.
 * Run: npx tsx mobile/scripts/test-where-is-plane.ts
 */
import { pickAircraftRegistration } from '../lib/aircraftRegOverride';
import {
  resolveWhereIsMyPlaneUrl,
  shouldShowWhereIsMyPlane,
} from '../lib/whereIsMyPlane';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const now = Date.parse('2026-11-09T08:00:00.000Z');
const depIn6h = now + 6 * 60 * 60 * 1000;
const depIn13h = now + 13 * 60 * 60 * 1000;

assert(
  shouldShowWhereIsMyPlane({
    isCrew: true,
    isFlightRow: true,
    scheduledDepMs: depIn6h,
    nowMs: now,
    isLanded: false,
  }),
  'crew flight within 12h should show',
);

assert(
  !shouldShowWhereIsMyPlane({
    isCrew: true,
    isFlightRow: true,
    scheduledDepMs: depIn6h,
    nowMs: now,
    isLanded: false,
    liveTrackActive: true,
  }),
  'live track active should hide where-is-plane',
);

assert(
  !shouldShowWhereIsMyPlane({
    isCrew: true,
    isFlightRow: true,
    scheduledDepMs: depIn13h,
    nowMs: now,
    isLanded: false,
  }),
  'outside 12h should hide',
);

assert(
  !shouldShowWhereIsMyPlane({
    isCrew: false,
    isFlightRow: true,
    scheduledDepMs: depIn6h,
    nowMs: now,
    isLanded: false,
  }),
  'family should hide',
);

assert(
  !shouldShowWhereIsMyPlane({
    isCrew: true,
    isFlightRow: true,
    scheduledDepMs: depIn6h,
    nowMs: now,
    isLanded: true,
  }),
  'landed should hide',
);

const noReg = resolveWhereIsMyPlaneUrl({ aircraftRegistration: null });
assert(noReg === null, 'without reg → prompt (no flight fallback)');

const withReg = resolveWhereIsMyPlaneUrl({ aircraftRegistration: 'TC-RBA' });
assert(withReg?.kind === 'registration', 'reg present → aircraft page');
assert(
  withReg?.url === 'https://www.flightradar24.com/data/aircraft/tc-rba',
  `unexpected reg url: ${withReg?.url}`,
);

assert(
  pickAircraftRegistration({ systemReg: null, overrideReg: 'tc-rba' }) === 'TC-RBA',
  'override used when system empty',
);
assert(
  pickAircraftRegistration({ systemReg: 'TC-AAA', overrideReg: 'TC-RBA' }) === 'TC-AAA',
  'system reg wins over override',
);

console.log('test-where-is-plane: ALL PASS');
