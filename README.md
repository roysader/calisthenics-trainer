# Calisthenics Trainer

A installable phone web-app (PWA) for logging calisthenics sets/reps, resistance-band assistance, a rest timer with a beep, and a simple auto-generated training plan based on a per-move max-rep test.

## 1. Try it locally first

```
python -m http.server 8000
```
Open http://localhost:8000 in a browser. Without Supabase configured (see below), it still fully works — data is stored in the browser's `localStorage`.

## 2. Put it on your iPhone (GitHub Pages)

1. Create a new GitHub repo (public or private) and push everything in this folder to it.
2. In the repo: **Settings → Pages → Deploy from a branch**, pick `main` and `/ (root)`, save.
3. Wait ~1 minute, then open the given `https://<you>.github.io/<repo>/` URL on your iPhone in **Safari**.
4. Tap the Share icon → **Add to Home Screen**. It now launches full-screen with its own icon, and the app shell (HTML/CSS/JS) is cached for offline use.

## 3. Add cloud sync (Supabase, free tier)

Without this step the app still works great, but data lives only on that one phone/browser.

1. Create a free project at supabase.com.
2. In the SQL editor, run:

```sql
create table moves (
  id text primary key,
  user_id uuid not null references auth.users(id),
  name text not null,
  is_assistable boolean not null default false
);

create table max_tests (
  user_id uuid not null references auth.users(id),
  move_id text not null,
  reps int not null,
  band text not null default 'none',
  tested_at timestamptz not null default now(),
  primary key (user_id, move_id)
);

create table sessions (
  id text primary key,
  user_id uuid not null references auth.users(id),
  move_id text not null,
  reps int not null,
  band text not null default 'none',
  logged_at timestamptz not null default now()
);

create table settings (
  user_id uuid primary key references auth.users(id),
  rest_seconds int not null default 90,
  sound_on boolean not null default true,
  vibrate_on boolean not null default true,
  last_deload timestamptz not null default now()
);

alter table moves enable row level security;
alter table max_tests enable row level security;
alter table sessions enable row level security;
alter table settings enable row level security;

create policy "own rows" on moves for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on max_tests for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

3. In **Authentication → Providers**, make sure **Anonymous Sign-ins** is enabled (Settings → Auth → toggle "Allow anonymous sign-ins"). This lets the app create a private account for you with zero login friction.
4. In **Project Settings → API**, copy the **Project URL** and **anon public key**.
5. Open [supabaseClient.js](supabaseClient.js) and paste them in:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
6. Commit and push — GitHub Pages redeploys automatically. Reload the app on your phone; it will sign in anonymously and sync from then on. If you ever reinstall/clear Safari data, your account (and data) is tied to that anonymous Supabase session, so **don't clear Safari site data** for this app unless you've noted the account is disposable — for guaranteed recovery across a phone reset, switch to Supabase email-link auth instead (a small change in `supabaseClient.js`'s `signInAnon`).

## Notes
- The bands are **assistance** bands (they make pull-ups/dips easier), not added weight: Blue = 10kg assist, Yellow = 20kg, Red = 30kg.
- The app first asks for an unassisted (or lightest-possible-band) max-rep test per move, then suggests a target of ~75% of that max for 3-4 sets. Once you hit that target for 2 sessions in a row, it nudges you to retest (or drop to a lighter band for assisted moves).
- Everything works offline; writes queue locally and sync to Supabase once you're back online.
