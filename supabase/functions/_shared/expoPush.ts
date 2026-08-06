const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoPushResult = {
  sent: number;
  errors: string[];
};

export async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown> | null,
): Promise<ExpoPushResult> {
  if (tokens.length === 0) return { sent: 0, errors: [] };
  const messages = tokens.map((token) => ({
    to: token,
    title,
    body,
    sound: 'default' as const,
    channelId: 'default',
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  }));
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  const text = await res.text();
  if (!res.ok) {
    return { sent: 0, errors: [`Expo HTTP ${res.status}: ${text.slice(0, 200)}`] };
  }
  const errors: string[] = [];
  let sent = 0;
  try {
    const dataJson = JSON.parse(text) as {
      data?: Array<{ status?: string; message?: string; details?: { error?: string } }>;
    };
    const tickets = dataJson?.data ?? [];
    tickets.forEach((ticket, i) => {
      if (ticket?.status === 'ok') {
        sent += 1;
      } else if (ticket?.status === 'error') {
        const err = ticket.details?.error ?? ticket.message ?? 'unknown';
        errors.push(`token[${i}]: ${err}`);
      }
    });
  } catch {
    sent = tokens.length;
  }
  return { sent, errors };
}
