/**
 * Strip PII / secrets from client error reports before AsyncStorage / Supabase.
 */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const PUSH_TOKEN_RE = /\bExponentPushToken\[[^\]]+\]/gi;
const FILE_PATH_RE =
  /(?:file:\/\/)?(?:\/(?:Users|home|var|private|data|storage)\/[^\s"'`]+|file:\/\/[^\s"'`]+)/gi;
const QUERY_FRAGMENT_RE = /([?&#](?:access_token|refresh_token|token_hash|token|code|otp|apikey|authorization|anon_key|service_role)=)[^&#\s"']+/gi;
const KEY_VALUE_SECRET_RE =
  /\b(access_token|refresh_token|token_hash|id_token|api[_-]?key|apikey|authorization|password|secret|push[_-]?token)\b\s*[:=]\s*["']?[^\s"',;]+/gi;

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;
const MAX_COMPONENT_STACK = 2000;
const MAX_LINE_LEN = 240;

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function redact(text: string): string {
  let out = text;
  out = out.replace(EMAIL_RE, '[email]');
  out = out.replace(PUSH_TOKEN_RE, '[push_token]');
  out = out.replace(JWT_RE, '[jwt]');
  out = out.replace(BEARER_RE, 'Bearer [token]');
  out = out.replace(QUERY_FRAGMENT_RE, '$1[redacted]');
  out = out.replace(KEY_VALUE_SECRET_RE, '$1=[redacted]');
  out = out.replace(FILE_PATH_RE, '[path]');
  out = out.replace(PHONE_RE, '[phone]');
  // Long pasted roster / PDF dumps
  out = out
    .split('\n')
    .map((line) => (line.length > MAX_LINE_LEN ? `${line.slice(0, MAX_LINE_LEN)}…` : line))
    .join('\n');
  if (out.length > 12_000) out = `${out.slice(0, 12_000)}…`;
  return out;
}

export type SanitizedErrorFields = {
  error_name: string | null;
  message: string;
  stack: string | null;
  component_stack: string | null;
};

export function sanitizeErrorReport(input: {
  error_name?: string | null;
  message?: unknown;
  stack?: string | null;
  component_stack?: string | null;
}): SanitizedErrorFields {
  const rawMessage = String(input.message ?? '(empty error)');
  const message = clip(redact(rawMessage), MAX_MESSAGE) || '(empty error)';
  const stackRaw = input.stack ? redact(String(input.stack)) : null;
  const componentRaw = input.component_stack ? redact(String(input.component_stack)) : null;
  // Drop dense UUID dumps that often accompany roster/debug blobs.
  const scrubUuids = (s: string | null) => (s ? s.replace(UUID_RE, '[id]') : null);
  return {
    error_name: input.error_name ? clip(redact(String(input.error_name)), 120) : null,
    message: scrubUuids(message) ?? '(empty error)',
    stack: scrubUuids(stackRaw ? clip(stackRaw, MAX_STACK) : null),
    component_stack: scrubUuids(componentRaw ? clip(componentRaw, MAX_COMPONENT_STACK) : null),
  };
}
