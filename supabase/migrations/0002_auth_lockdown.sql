-- Supabase Auth + RLS lockdown (applied 2026-09-20 as migration `auth_lockdown`).
-- App tables become accessible to authenticated staff only; all anon access
-- is revoked. Staff profiles carry a role and are auto-provisioned on signup.

-- Staff profiles + roles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'staff',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lock down the app tables: authenticated staff only, no anon access
do $$
declare t text;
begin
  foreach t in array array['config','rooms','categories','products','clients','bookings','folios','folio_lines','tickets','payments']
  loop
    execute format('drop policy if exists demo_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
