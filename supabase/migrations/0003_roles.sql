-- Role-based permissions (applied 2026-09-20 as migration `roles`).
-- Roles: staff (default) < manager < admin.
-- - app_role(): caller's role, SECURITY DEFINER so profile policies don't recurse
-- - profiles: self-update removed (no self role-escalation); admins manage roles
-- - first account ever created becomes admin; later signups are staff

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as
$$ select coalesce((select role from public.profiles where id = auth.uid()), 'staff') $$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('staff','manager','admin'));

drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    case when exists (select 1 from public.profiles) then 'staff' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

update public.profiles p set role = 'admin'
where p.id = (select id from public.profiles order by created_at asc limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');
