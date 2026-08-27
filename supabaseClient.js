// Fill these in after creating your free Supabase project (see README.md).
export const SUPABASE_URL = 'YOUR_SUPABASE_URL';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

export const SUPABASE_CONFIGURED =
  !SUPABASE_URL.startsWith('YOUR_') && !SUPABASE_ANON_KEY.startsWith('YOUR_');

let client = null;

export function getClient() {
  if (!SUPABASE_CONFIGURED) return null;
  if (!client && window.supabase) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export async function signInAnon() {
  const sb = getClient();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    console.error('Supabase anon sign-in failed', error);
    return null;
  }
  return data.user;
}
