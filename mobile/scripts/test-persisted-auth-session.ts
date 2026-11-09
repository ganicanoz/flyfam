/**
 * Unit checks for offline auth session parse (no AsyncStorage / network).
 * Run: npx tsx mobile/scripts/test-persisted-auth-session.ts
 */
import { parsePersistedAuthSessionRaw } from '../lib/persistedAuthSessionParse';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const valid = {
  access_token: 'aaa',
  refresh_token: 'bbb',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1', email: 'a@b.c' },
};

assert(parsePersistedAuthSessionRaw(JSON.stringify(valid))?.user?.id === 'user-1', 'direct session');
assert(
  parsePersistedAuthSessionRaw(JSON.stringify({ currentSession: valid }))?.user?.id === 'user-1',
  'currentSession envelope',
);
assert(
  parsePersistedAuthSessionRaw(JSON.stringify({ session: valid }))?.user?.id === 'user-1',
  'session envelope',
);
assert(parsePersistedAuthSessionRaw(null) === null, 'null');
assert(parsePersistedAuthSessionRaw('not-json') === null, 'bad json');
assert(parsePersistedAuthSessionRaw(JSON.stringify({ access_token: 'x' })) === null, 'missing user');
assert(
  parsePersistedAuthSessionRaw(JSON.stringify({ ...valid, refresh_token: '' })) === null,
  'empty refresh',
);

console.log('test-persisted-auth-session: PASS');
