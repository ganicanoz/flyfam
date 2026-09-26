/**
 * Shared Expo Push helpers for FlyFam family notifications.
 * Sound channel IDs (`flyfam_*_v2`) are owned by the mobile app; do not rename lightly.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoPushResult = {
  sent: number;
  errors: string[];
};

export type ExpoPushSoundOpts = {
  sound?: string;
  channelId?: string;
  /** Android small icon drawable resource name (monochrome). */
  icon?: string;
  /** HTTPS URL for rich notification image (Android BigPicture; iOS NSE attachment). */
  imageUrl?: string;
};

export async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown> | null,
  soundOpts?: ExpoPushSoundOpts,
): Promise<ExpoPushResult> {
  if (tokens.length === 0) return { sent: 0, errors: [] };
  const sound = soundOpts?.sound ?? 'default';
  const channelId = soundOpts?.channelId ?? 'default';
  const icon = soundOpts?.icon?.trim() || undefined;
  const imageUrl = soundOpts?.imageUrl?.trim() || undefined;
  const messages = tokens.map((token) => {
    const msg: Record<string, unknown> = {
      to: token,
      title,
      body,
      sound,
      channelId,
    };
    if (icon) msg.icon = icon;
    if (imageUrl) {
      msg.richContent = { image: imageUrl };
      // Required so iOS Notification Service Extension can attach the image.
      msg.mutableContent = true;
    }
    if (data && Object.keys(data).length > 0) msg.data = data;
    return msg;
  });
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
