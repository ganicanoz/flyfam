/**
 * Edge Function log helpers — never emit raw emails, UUIDs lists, or push tokens.
 */

export function maskEmail(email: string | null | undefined): string | null {
  const raw = String(email ?? '').trim().toLowerCase();
  if (!raw || !raw.includes('@')) return raw ? '[email]' : null;
  const [local, domain] = raw.split('@');
  if (!domain) return '[email]';
  const localMask = local.length <= 2 ? `${local[0] ?? '*'}*` : `${local.slice(0, 2)}***`;
  return `${localMask}@${domain}`;
}

/** Short irreversible tag for correlating a user without logging the UUID. */
export function anonUserRef(userId: string | null | undefined): string | null {
  const id = String(userId ?? '').trim();
  if (!id) return null;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `u_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function countOrZero(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
