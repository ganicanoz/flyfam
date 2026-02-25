/**
 * Invoke the notify-family Edge Function to send push to family users.
 * - notifyFamilyFlightEvent: after crew updates flight and status is took_off (en_route) or landed.
 * - notifyFamilyTodayFlights: when crew taps "Send flights to my family".
 */
import { supabase } from './supabase';

export async function notifyFamilyFlightEvent(
  type: 'took_off' | 'landed',
  flightId: string
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  const { error } = await supabase.functions.invoke('notify-family', {
    body: { type, flightId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) console.warn('[NotifyFamily]', type, error);
}

export type NotifyTodayFlightsResult = { ok: true; sent: number } | { ok: false; error: string };

export async function notifyFamilyTodayFlights(
  crewId: string,
  date: string
): Promise<NotifyTodayFlightsResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, error: 'Oturum yok' };
  }

  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; sent?: number; error?: string }>('notify-family', {
    body: { type: 'today_flights', crewId, date },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    return { ok: false, error: error.message || 'Gönderilemedi' };
  }
  if (data?.ok === true && typeof data.sent === 'number') {
    return { ok: true, sent: data.sent };
  }
  return { ok: false, error: (data?.error as string) || 'Gönderilemedi' };
}
