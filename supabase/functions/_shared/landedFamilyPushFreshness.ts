/**
 * Aile «indi» push’u: iniş kanıtı çok eskiyse gönderme.
 * Roster yeniden import / satır yeniden oluşturma eski FR24 ATA’sını bulup
 * «şimdi indi» sanmasın diye (ör. dün inmiş PC582 → bugün push).
 */

/** İniş anından bu kadar sonra aileye landed push atılmaz. */
export const LANDED_FAMILY_PUSH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function parseUtcMs(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * true → push gönderilebilir.
 * Öncelik: FR24 iniş → actual_arrival → (yedek) scheduled_arrival.
 * Hiç zaman yoksa false (kör push yok).
 */
export function isLandedEventFreshForFamilyPush(args: {
  fr24LandedUtc?: string | null;
  actualArrivalUtc?: string | null;
  scheduledArrivalUtc?: string | null;
  nowMs?: number;
  maxAgeMs?: number;
}): boolean {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? LANDED_FAMILY_PUSH_MAX_AGE_MS;
  const eventMs =
    parseUtcMs(args.fr24LandedUtc) ??
    parseUtcMs(args.actualArrivalUtc) ??
    parseUtcMs(args.scheduledArrivalUtc);
  if (eventMs == null) return false;
  // Saat kayması: en fazla 30 dk geleceğe izin.
  if (eventMs > nowMs + 30 * 60 * 1000) return false;
  return nowMs - eventMs <= maxAgeMs;
}
