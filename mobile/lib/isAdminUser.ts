/** Uygulama içi gizli debug roster — yalnızca bu hesap. */
const ADMIN_EMAIL_NORMALIZED = 'ganicanoz@gmail.com';

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL_NORMALIZED;
}
