alter table public.organizations
  add column workweek_start smallint not null default 0 check (workweek_start between 0 and 6),
  add column company_logo bytea,
  add column logo_revision uuid,
  add column settings_saved boolean not null default false;

create function public.attendance_company_settings()
returns table(name text, workweek_start smallint, logo_revision uuid, settings_saved boolean)
language sql stable security definer set search_path = ''
as $$
  select o.name, o.workweek_start, o.logo_revision, o.settings_saved
  from public.organizations o join public.organization_users u on u.organization_id = o.id
  where u.user_id = auth.uid() and u.role in ('admin', 'leader')
$$;

create function public.attendance_save_company_settings(p_name text, p_workweek integer, p_logo_change text, p_logo text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  logo bytea;
begin
  select organization_id into org from public.organization_users where user_id = auth.uid() and role = 'admin';
  if org is null or p_name is null or char_length(btrim(p_name)) not between 1 and 100
    or p_workweek is null or p_workweek not between 0 and 6
    or p_logo_change is null or p_logo_change not in ('keep', 'replace', 'remove') then
    return false;
  end if;
  if p_logo_change = 'replace' then
    if p_logo is null or length(p_logo) > 349528 or p_logo !~ '^[A-Za-z0-9+/]+={0,2}$' then return false; end if;
    begin
      logo := decode(p_logo, 'base64');
    exception when invalid_parameter_value then return false;
    end;
    if octet_length(logo) not between 20 and 262144 or substring(logo from 1 for 4) <> '\x52494646'::bytea
      or substring(logo from 9 for 4) <> '\x57454250'::bytea then return false; end if;
  end if;
  update public.organizations set
    name = btrim(p_name), workweek_start = p_workweek, settings_saved = true,
    company_logo = case when p_logo_change = 'keep' then company_logo else logo end,
    logo_revision = case p_logo_change when 'keep' then logo_revision when 'replace' then gen_random_uuid() else null end
  where id = org;
  return found;
end
$$;

create function public.attendance_company_logo(p_revision uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select encode(o.company_logo, 'base64')
  from public.organizations o join public.organization_users u on u.organization_id = o.id
  where u.user_id = auth.uid() and u.role in ('admin', 'leader') and o.logo_revision = p_revision
$$;

create function public.attendance_public_company(p_token text)
returns table(name text, timezone text, logo_revision uuid)
language sql stable security definer set search_path = ''
as $$
  select t.name, t.timezone, o.logo_revision
  from attendance_private.find_public_terminal(p_token) t
  join public.organization_users u on u.user_id = t.id
  join public.organizations o on o.id = u.organization_id
$$;

create function public.attendance_public_company_logo(p_token text, p_revision uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select encode(o.company_logo, 'base64')
  from attendance_private.find_public_terminal(p_token) t
  join public.organization_users u on u.user_id = t.id
  join public.organizations o on o.id = u.organization_id
  where o.logo_revision = p_revision
$$;

revoke execute on function public.attendance_company_settings(), public.attendance_company_logo(uuid),
  public.attendance_save_company_settings(text,integer,text,text) from public, anon, authenticated;
grant execute on function public.attendance_company_settings(), public.attendance_company_logo(uuid),
  public.attendance_save_company_settings(text,integer,text,text) to authenticated;
revoke execute on function public.attendance_public_company(text), public.attendance_public_company_logo(text,uuid)
  from public, anon, authenticated;
grant execute on function public.attendance_public_company(text), public.attendance_public_company_logo(text,uuid) to anon;
notify pgrst, 'reload schema';
