create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists attendance_private;
revoke all on schema attendance_private from public, anon, authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Mexico_City'
);

create table public.organization_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  role text not null check (role in ('admin', 'kiosk'))
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null check (code ~ '^[0-9]{1,12}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  active boolean not null default true,
  unique (organization_id, code),
  unique (organization_id, id)
);

create table attendance_private.employee_pins (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  pin_hash text not null
);

create table public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  entered_at timestamptz not null,
  exited_at timestamptz,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id),
  check (exited_at is null or exited_at >= entered_at)
);

create unique index attendance_one_open_shift
  on public.attendance_shifts (employee_id) where exited_at is null;
create index attendance_shifts_org_start on public.attendance_shifts (organization_id, entered_at);

create table attendance_private.kiosk_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  valid_until timestamptz not null,
  failures integer not null default 0
);

create table attendance_private.punch_receipts (
  kiosk_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  employee_id uuid not null references public.employees(id),
  direction text not null,
  marked_at timestamptz not null,
  primary key (kiosk_id, request_id)
);

alter table public.organizations enable row level security;
alter table public.organization_users enable row level security;
alter table public.employees enable row level security;
alter table public.attendance_shifts enable row level security;
revoke all on public.organizations, public.organization_users,
  public.employees, public.attendance_shifts from anon, authenticated, public;
revoke all on all tables in schema attendance_private from anon, authenticated, public;

create function public.attendance_actor()
returns table (name text, timezone text, role text)
language sql stable security definer set search_path = ''
as $$
  select o.name, o.timezone, u.role
  from public.organization_users u join public.organizations o on o.id = u.organization_id
  where u.user_id = auth.uid()
$$;

create function public.attendance_employees()
returns table (id uuid, code text, name text, active boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.code, e.name, e.active
  from public.employees e join public.organization_users u on u.organization_id = e.organization_id
  where u.user_id = auth.uid() and u.role = 'admin'
  order by e.name, e.id
$$;

create function public.attendance_add_employee(p_code text, p_name text, p_pin text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  employee uuid;
begin
  select organization_id into org from public.organization_users
    where user_id = auth.uid() and role = 'admin';
  if org is null then raise insufficient_privilege; end if;
  if p_code is null or p_code !~ '^[0-9]{1,12}$' or p_pin is null
    or p_pin !~ '^[0-9]{6}$' or p_name is null
    or length(btrim(p_name)) not between 1 and 100 then
    return 'invalid';
  end if;
  insert into public.employees (organization_id, code, name)
    values (org, p_code, btrim(p_name))
    on conflict (organization_id, code) do nothing returning id into employee;
  if employee is null then return 'duplicate'; end if;
  insert into attendance_private.employee_pins (employee_id, pin_hash)
    values (employee, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)));
  return 'ok';
end
$$;

create function public.attendance_punch(p_code text, p_pin text, p_direction text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  kiosk uuid := auth.uid();
  org uuid;
  employee record;
  limits attendance_private.kiosk_limits%rowtype;
  receipt attendance_private.punch_receipts%rowtype;
  open_shift uuid;
  marked timestamptz;
begin
  select organization_id into org from public.organization_users
    where user_id = kiosk and role = 'kiosk';
  if org is null then raise insufficient_privilege; end if;
  if p_code is null or p_code !~ '^[0-9]{1,12}$' or p_pin is null
    or p_pin !~ '^[0-9]{6}$' or p_direction is null
    or p_direction not in ('entrada', 'salida') or p_request is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into attendance_private.kiosk_limits (user_id, valid_until)
    values (kiosk, clock_timestamp() + interval '5 minutes') on conflict do nothing;
  select * into limits from attendance_private.kiosk_limits where user_id = kiosk for update;
  if limits.valid_until <= clock_timestamp() then
    update attendance_private.kiosk_limits set failures = 0,
      valid_until = clock_timestamp() + interval '5 minutes' where user_id = kiosk;
  elsif limits.failures >= 15 then
    return jsonb_build_object('status', 'locked');
  end if;

  select e.id, e.name, p.pin_hash into employee from public.employees e
    join attendance_private.employee_pins p on p.employee_id = e.id
    where e.organization_id = org and e.code = p_code and e.active for update of e;
  if not found or extensions.crypt(p_pin, employee.pin_hash) <> employee.pin_hash then
    update attendance_private.kiosk_limits set failures = failures + 1 where user_id = kiosk;
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into receipt from attendance_private.punch_receipts
    where kiosk_id = kiosk and request_id = p_request;
  if found then
    if receipt.employee_id <> employee.id or receipt.direction <> p_direction then
      return jsonb_build_object('status', 'invalid');
    end if;
    return jsonb_build_object('status', 'ok', 'name', employee.name, 'marked_at', receipt.marked_at);
  end if;

  select id into open_shift from public.attendance_shifts
    where employee_id = employee.id and exited_at is null;
  marked := clock_timestamp();
  if p_direction = 'entrada' and open_shift is not null then
    return jsonb_build_object('status', 'already_open');
  elsif p_direction = 'salida' and open_shift is null then
    return jsonb_build_object('status', 'no_open');
  elsif p_direction = 'entrada' then
    insert into public.attendance_shifts (organization_id, employee_id, entered_at)
      values (org, employee.id, marked);
  else
    update public.attendance_shifts set exited_at = marked where id = open_shift;
  end if;
  insert into attendance_private.punch_receipts (kiosk_id, request_id, employee_id, direction, marked_at)
    values (kiosk, p_request, employee.id, p_direction, marked);
  return jsonb_build_object('status', 'ok', 'name', employee.name, 'marked_at', marked);
end
$$;

create function public.attendance_report(p_from date, p_to date)
returns table (id uuid, code text, name text, entered_at timestamptz, exited_at timestamptz, minutes integer)
language sql stable security definer set search_path = ''
as $$
  with bounds as (
    select o.id, p_from::timestamp at time zone o.timezone as starts,
      (p_to + 1)::timestamp at time zone o.timezone as ends
    from public.organization_users u join public.organizations o on o.id = u.organization_id
    where u.user_id = auth.uid() and u.role = 'admin' and p_from <= p_to
  )
  select s.id, e.code, e.name, s.entered_at, s.exited_at,
    case when s.exited_at is not null then
      floor(extract(epoch from (least(s.exited_at, b.ends) - greatest(s.entered_at, b.starts))) / 60)::integer
    end
  from bounds b join public.attendance_shifts s on s.organization_id = b.id
  join public.employees e on e.id = s.employee_id
  where s.entered_at < b.ends and (s.exited_at > b.starts or s.entered_at >= b.starts)
  order by s.entered_at desc, s.id
$$;

revoke execute on function public.attendance_actor(),
  public.attendance_employees(), public.attendance_add_employee(text, text, text),
  public.attendance_punch(text, text, text, uuid), public.attendance_report(date, date)
  from public, anon;
grant execute on function public.attendance_actor(),
  public.attendance_employees(), public.attendance_add_employee(text, text, text),
  public.attendance_punch(text, text, text, uuid), public.attendance_report(date, date)
  to authenticated;
