/**
 * Roster PDF text parser regression set.
 *
 *   npx tsx scripts/test-roster-pdf-parser.ts            # compare
 *   npx tsx scripts/test-roster-pdf-parser.ts --update   # rewrite *.expected.json
 *
 * Fixtures are pdf-parse text dumps anonymized with scripts/anonymize-roster-fixture.ts.
 * The file name prefix is the expected layout (e.g. `thy.txt`, `pegasus-duty.txt`).
 * Covers the shared text parser only; the Edge-only SunExpress/Freebird pdfjs layout
 * pass in parse-roster-pdf is not exercised here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseRosterFixtureText } from './rosterFixtureParse';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'roster-pdf');
const update = process.argv.includes('--update');

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort();
assert.ok(fixtures.length > 0, `no fixtures in ${FIXTURE_DIR}`);

let failures = 0;
for (const file of fixtures) {
  const name = file.replace(/\.txt$/, '');
  const expectedLayout = name.split('-')[0];
  const expectedPath = path.join(FIXTURE_DIR, `${name}.expected.json`);
  const actual = parseRosterFixtureText(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));

  if (update) {
    fs.writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`updated ${name}: layout=${actual.layout} rows=${actual.rows.length}`);
    continue;
  }

  try {
    assert.equal(actual.layout, expectedLayout, `${name}: detected layout`);
    assert.ok(fs.existsSync(expectedPath), `${name}: missing ${path.basename(expectedPath)} (run with --update)`);
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    assert.deepEqual(actual, expected, `${name}: parsed rows differ from expected`);
    console.log(`ok ${name}: layout=${actual.layout} rows=${actual.rows.length}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL ${name}: ${(e as Error).message.split('\n')[0]}`);
  }
}

if (failures > 0) {
  console.error(`${failures} roster fixture(s) failed`);
  process.exit(1);
}
if (!update) console.log(`roster pdf parser OK (${fixtures.length} fixtures)`);
