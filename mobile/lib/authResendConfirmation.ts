import { supabase } from './supabase';
import { authEmailRedirectTo } from './authRedirect';

export async function resendSignupConfirmationEmail(
  email: string
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: 'missing_email' };

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: trimmed,
    options: { emailRedirectTo: authEmailRedirectTo() },
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
