import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

type Result = { name: string; ok: boolean; detail?: string; kind: 'check' | 'known' };

const results: Result[] = [];

export async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true, kind: 'check' });
  } catch (e) {
    results.push({ name, ok: false, kind: 'check', detail: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * `stillPresent` must return true while the documented bug is still reproducible.
 * When it returns false the bug was fixed: the run fails so the case is turned into a regular check.
 */
export async function knownBug(name: string, stillPresent: () => boolean | Promise<boolean>): Promise<void> {
  try {
    const present = await stillPresent();
    results.push(
      present
        ? { name, ok: true, kind: 'known' }
        : { name, ok: false, kind: 'known', detail: 'no longer reproduces — convert to a regular check' },
    );
  } catch (e) {
    results.push({ name, ok: false, kind: 'known', detail: e instanceof Error ? e.message : String(e) });
  }
}

export function report(title: string): void {
  let failed = 0;
  for (const r of results) {
    const tag = r.kind === 'known' ? (r.ok ? 'KNOWN' : 'FAIL ') : r.ok ? 'OK   ' : 'FAIL ';
    if (!r.ok) failed++;
    console.log(`${tag} ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  }
  const checks = results.filter((r) => r.kind === 'check');
  const known = results.filter((r) => r.kind === 'known');
  console.log(
    `\n${title}: ${checks.filter((r) => r.ok).length}/${checks.length} OK, ${known.filter((r) => r.ok).length} known bug(s) still present, ${failed} failure(s)`,
  );
  if (failed) process.exitCode = 1;
}

/** Lets tsx load `lib/flightApi.ts` offline by replacing its Supabase client import. */
export function stubMobileSupabaseClient(): void {
  const stubUrl = pathToFileURL(join(__dirname, 'stubs', 'supabaseClient.cjs')).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === './supabase' && context.parentURL?.includes('/mobile/lib/')) {
        return { url: stubUrl, format: 'commonjs', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

let pinnedNow: number | null = null;
const realDateNow = Date.now.bind(Date);
Date.now = () => (pinnedNow ?? realDateNow());

export function pinNow(iso: string | null): void {
  pinnedNow = iso ? Date.parse(iso) : null;
}
