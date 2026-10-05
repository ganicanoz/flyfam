/**
 * Eso: serbest Türkçe plan cümlesini sınırlı bir yama listesine çevirir.
 * OPENAI_API_KEY yoksa çağrılmaz (yerel yorumlayıcı yeter). Anahtar loglanmaz.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type AssistOp = {
  op: 'rename_hospital' | 'add_vacation' | 'add_once';
  from?: string;
  to?: string;
  label?: string;
  place?: string;
  short?: string;
  start?: string;
  end?: string;
  date?: string;
  note?: string;
  skipSamePlaceFixed?: boolean;
};

function clip(v: unknown, n: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function asOp(raw: unknown): AssistOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.op === 'rename_hospital') return { op: 'rename_hospital' };
  if (o.op === 'add_vacation') {
    const from = clip(o.from, 10);
    const to = clip(o.to, 10);
    if (!YMD.test(from) || !YMD.test(to) || to < from) return null;
    return { op: 'add_vacation', from, to, label: clip(o.label, 80) || 'Tatil' };
  }
  if (o.op === 'add_once') {
    const date = clip(o.date, 10);
    const start = clip(o.start, 5);
    const end = clip(o.end, 5);
    const place = clip(o.place, 40);
    if (!YMD.test(date) || !HM.test(start) || !HM.test(end) || !place) return null;
    if (start >= end) return null;
    return {
      op: 'add_once',
      date,
      start,
      end,
      place,
      label: clip(o.label, 80),
      short: clip(o.short, 12),
      note: clip(o.note, 160),
      skipSamePlaceFixed: o.skipSamePlaceFixed === true,
    };
  }
  return null;
}

export function parseAssistOps(body: unknown): { summary: string; lines: string[]; ops: AssistOp[] } | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const opsRaw = Array.isArray(o.ops) ? o.ops : [];
  const ops = opsRaw.map(asOp).filter((x): x is AssistOp => !!x).slice(0, 5);
  if (!ops.length) return null;
  const lines = Array.isArray(o.lines) ? o.lines.map((x) => clip(x, 160)).filter(Boolean).slice(0, 6) : [];
  return { summary: clip(o.summary, 80) || 'Plan değişikliği', lines, ops };
}

export async function interpretPlannerUtterance(text: string, sketch: unknown): Promise<
  { ok: true; summary: string; lines: string[]; ops: AssistOp[] } | { ok: false; ai: boolean }
> {
  const key = (Deno.env.get('OPENAI_API_KEY') || '').trim();
  if (!key) return { ok: false, ai: false };
  const utterance = clip(text, 500);
  if (!utterance) return { ok: false, ai: true };
  const sketchJson = clip(JSON.stringify(sketch ?? {}), 4000);
  const sys = [
    'Aile planı asistanı Eso’sun. Kullanıcının Türkçe cümlesini yalnız JSON’a çevir.',
    'İzinli op değerleri: rename_hospital; add_vacation (from, to, label); add_once (place, label, short, start, end, date, note, skipSamePlaceFixed).',
    'Hastane işi her yerde «Acıbadem Hastanesi», kısa ad «Acıbadem». İmza bir rozet değil, o günkü işin notudur (note). icon alanı yazma.',
    'Aynı gün hastanede yalnız kısa bir iş varsa skipSamePlaceFixed true.',
    'Anlayamazsan ops boş dizi olsun.',
    'Yanıt: {"summary":"...","lines":["..."],"ops":[...]}',
  ].join(' ');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: 'Bugün ve plan iskeleti:\n' + sketchJson + '\n\nCümle:\n' + utterance },
      ],
    }),
  });
  if (!res.ok) return { ok: false, ai: true };
  const data = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return { ok: false, ai: true };
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return { ok: false, ai: true }; }
  const clean = parseAssistOps(parsed);
  if (!clean) return { ok: false, ai: true };
  return { ok: true, ...clean };
}
