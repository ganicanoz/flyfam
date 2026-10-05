/**
 * Builds a privacy-safe roster parser fixture from a real roster PDF (or extracted text).
 *
 *   npx tsx scripts/anonymize-roster-fixture.ts <input.pdf|input.txt> <output.txt>
 *
 * Every letter run and every 3+ digit run is replaced, one at a time, by a same-length
 * pseudo token. A replacement is kept only if the parse result (layout + rows) stays
 * identical, so tokens the parser depends on survive and everything else (names, crew
 * IDs, phone numbers, hotels, addresses) is scrubbed. Review the printed "kept" list before committing:
 * a kept token is parser-relevant but may still be personal.
 */
import fs from 'node:fs';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import { parseRosterFixtureText } from './rosterFixtureParse';

const CONSONANTS = 'bdfgklmnprstvz';
const VOWELS = 'aeiou';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boundaryRegExp(token: string): RegExp {
  const esc = escapeRegExp(token);
  return /^\d+$/.test(token)
    ? new RegExp(`(?<!\\d)${esc}(?!\\d)`, 'g')
    : new RegExp(`(?<!\\p{L})${esc}(?!\\p{L})`, 'gu');
}

function makePseudo(token: string, seed: number, taken: Set<string>): string {
  for (let attempt = 0; ; attempt++) {
    let n = seed * 7919 + attempt * 104729 + 17;
    let out = '';
    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      n = (n * 1103515245 + 12345) % 2147483648;
      if (/\d/.test(ch)) {
        const d = n % 10;
        out += i === 0 && ch !== '0' && d === 0 ? '1' : String(d);
      } else {
        const pool = i % 2 === 0 ? CONSONANTS : VOWELS;
        const c = pool[n % pool.length];
        out += ch === ch.toLocaleUpperCase('tr') && ch !== ch.toLocaleLowerCase('tr') ? c.toUpperCase() : c;
      }
    }
    if (!taken.has(out)) {
      taken.add(out);
      return out;
    }
  }
}

async function readInputText(file: string): Promise<string> {
  if (file.toLowerCase().endsWith('.pdf')) {
    const parsed = await pdfParse(fs.readFileSync(file));
    return parsed.text;
  }
  return fs.readFileSync(file, 'utf8');
}

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: npx tsx scripts/anonymize-roster-fixture.ts <input.pdf|input.txt> <output.txt>');
    process.exit(2);
  }
  const original = await readInputText(input);
  const baseline = JSON.stringify(parseRosterFixtureText(original));

  const letterRuns = original.match(/\p{L}{2,}/gu) ?? [];
  const digitRuns = original.match(/(?<!\d)\d{3,}(?!\d)/g) ?? [];
  const tokens = [...new Set([...letterRuns, ...digitRuns])].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const taken = new Set(tokens);

  let text = original;
  const kept: string[] = [];
  tokens.forEach((token, i) => {
    const candidate = text.replace(boundaryRegExp(token), makePseudo(token, i + 1, taken));
    if (candidate === text) return;
    if (JSON.stringify(parseRosterFixtureText(candidate)) === baseline) text = candidate;
    else kept.push(token);
  });

  if (JSON.stringify(parseRosterFixtureText(text)) !== baseline) {
    throw new Error('Anonymized text no longer parses identically');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text);
  const result = parseRosterFixtureText(text);
  console.log(`layout=${result.layout} rows=${result.rows.length} tokens=${tokens.length} replaced=${tokens.length - kept.length} kept=${kept.length}`);
  console.log(`kept: ${kept.sort().join(' ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
