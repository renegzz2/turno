create function attendance_private.provision_panel_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  provisioning jsonb := new.raw_app_meta_data -> 'turno_provision';
  creator uuid;
  new_role text;
  org uuid;
begin
  -- Supabase Auth only allows its Admin API to set app metadata.
  if provisioning is null then return new; end if;
  new_role := provisioning ->> 'role';
  if new_role is null or new_role not in ('admin', 'leader') or new.email is null then
    raise exception 'Invalid panel user provisioning';
  end if;
  creator := (provisioning ->> 'by')::uuid;
  select organization_id into org from public.organization_users
    where user_id = creator and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;
  insert into public.organization_users (user_id, organization_id, role) values (new.id, org, new_role);
  return new;
end
$$;

revoke execute on function attendance_private.provision_panel_user() from public, anon, authenticated;
create trigger turno_provision_panel_user after insert on auth.users
  for each row execute function attendance_private.provision_panel_user();

create function public.attendance_current_user()
returns table (id uuid, email text, name text, timezone text, role text)
language sql stable security definer set search_path = ''
as $$
  select u.user_id, a.email::text, o.name, o.timezone, u.role
  from public.organization_users u
  join public.organizations o on o.id = u.organization_id
  join auth.users a on a.id = u.user_id
  where u.user_id = auth.uid()
$$;

create function public.attendance_panel_users()
returns table (id uuid, email text, role text)
language sql stable security definer set search_path = ''
as $$
  select u.user_id, a.email::text, u.role
  from public.organization_users caller
  join public.organization_users u on u.organization_id = caller.organization_id
  join auth.users a on a.id = u.user_id
  where caller.user_id = auth.uid() and caller.role = 'admin'
    and u.role in ('admin', 'leader') and a.email is not null
$$;

create function public.attendance_change_panel_role(p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  org uuid;
begin
  if p_user = caller or p_role is null or p_role not in ('admin', 'leader') then return false; end if;
  select organization_id into org from public.organization_users where user_id = caller and role = 'admin';
  if not found then return false; end if;
  -- Serialize role changes for this organization, then check the caller again.
  perform 1 from public.organizations where id = org for no key update;
  if not exists (select 1 from public.organization_users where user_id = caller and organization_id = org and role = 'admin')
    then return false; end if;
  update public.organization_users set role = p_role
    where user_id = p_user and organization_id = org and role in ('admin', 'leader');
  return found;
end
$$;

revoke execute on function public.attendance_current_user(), public.attendance_panel_users(),
  public.attendance_change_panel_role(uuid, text) from public, anon;
grant execute on function public.attendance_current_user(), public.attendance_panel_users(),
  public.attendance_change_panel_role(uuid, text) to authenticated;
