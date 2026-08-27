// Fill these in after creating your free Supabase project (see README.md).
export const SUPABASE_URL = 'https://rwksapcqocodartiqcza.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3a3NhcGNxb2NvZGFydGlxY3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NjA3ODMsImV4cCI6MjEwMzQzNjc4M30.A_j42RWUeINFMS2H_peltyqN4ay1nzPeJxhSXW2UFbw';

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
