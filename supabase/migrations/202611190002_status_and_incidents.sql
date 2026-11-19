create table public.attendance_incident_records (
  id uuid primary key,
  organization_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('justified', 'unjustified', 'sick_leave', 'vacation')),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id),
  check (starts_on <= ends_on)
);

create index attendance_incident_active_dates
  on public.attendance_incident_records (organization_id, employee_id, starts_on, ends_on)
  where cancelled_at is null;

alter table public.attendance_incident_records enable row level security;
revoke all on public.attendance_incident_records from public, anon, authenticated;

create function public.attendance_set_employee_active(p_employee uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if p_active is null then return false; end if;
  update public.employees e set active = p_active
  from public.organization_users u
  where e.id = p_employee and e.organization_id = u.organization_id
    and u.user_id = auth.uid() and u.role = 'admin';
  return found;
end
$$;

create function public.attendance_add_incident(p_id uuid, p_employee uuid, p_kind text, p_from date, p_to date)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  previous public.attendance_incident_records%rowtype;
begin
  if p_id is null or p_from is null or p_to is null or p_from > p_to
    or p_kind is null or p_kind not in ('justified', 'unjustified', 'sick_leave', 'vacation') then
    return 'invalid';
  end if;
  -- Serialize incidence creation for the same worker.
  select e.organization_id into org from public.employees e
    join public.organization_users u on u.organization_id = e.organization_id
    where e.id = p_employee and u.user_id = auth.uid() and u.role = 'admin'
    for update of e;
  if not found then return 'invalid'; end if;
  select * into previous from public.attendance_incident_records where id = p_id;
  if found then
    if previous.organization_id = org and previous.employee_id = p_employee
      and previous.kind = p_kind and previous.starts_on = p_from and previous.ends_on = p_to then
      return 'ok';
    end if;
    return 'invalid';
  end if;
  if exists (
    select 1 from public.attendance_incident_records i
      where i.organization_id = org and i.employee_id = p_employee and i.cancelled_at is null
        and i.starts_on <= p_to and i.ends_on >= p_from
  ) then return 'overlap'; end if;
  insert into public.attendance_incident_records (id, organization_id, employee_id, kind, starts_on, ends_on)
    values (p_id, org, p_employee, p_kind, p_from, p_to)
    on conflict (id) do nothing;
  if not found then return 'invalid'; end if;
  return 'ok';
end
$$;

create function public.attendance_cancel_incident(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.attendance_incident_records i
    set cancelled_at = coalesce(i.cancelled_at, clock_timestamp()),
      cancelled_by = case when i.cancelled_at is null then auth.uid() else i.cancelled_by end
  from public.organization_users u
  where i.id = p_id and i.organization_id = u.organization_id
    and u.user_id = auth.uid() and u.role = 'admin';
  return found;
end
$$;

create function public.attendance_incidents(p_from date, p_to date)
returns table (id uuid, code text, name text, kind text, starts_on date, ends_on date)
language sql stable security definer set search_path = ''
as $$
  select i.id, e.code, e.name, i.kind, i.starts_on, i.ends_on
  from public.attendance_incident_records i
  join public.employees e on e.id = i.employee_id and e.organization_id = i.organization_id
  join public.organization_users u on u.organization_id = i.organization_id
  where u.user_id = auth.uid() and u.role = 'admin' and i.cancelled_at is null
    and (p_from is null or i.ends_on >= p_from)
    and (p_to is null or i.starts_on <= p_to)
    and (p_from is null or p_to is null or p_from <= p_to)
  order by i.starts_on desc, i.id
$$;

revoke execute on function public.attendance_set_employee_active(uuid, boolean),
  public.attendance_add_incident(uuid, uuid, text, date, date),
  public.attendance_cancel_incident(uuid), public.attendance_incidents(date, date)
  from public, anon;
grant execute on function public.attendance_set_employee_active(uuid, boolean),
  public.attendance_add_incident(uuid, uuid, text, date, date),
  public.attendance_cancel_incident(uuid), public.attendance_incidents(date, date)
  to authenticated;

create or replace function public.attendance_punch(p_code text, p_pin text, p_direction text, p_request uuid)
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

  select e.id, e.name, e.active, p.pin_hash into employee from public.employees e
    join attendance_private.employee_pins p on p.employee_id = e.id
    where e.organization_id = org and e.code = p_code for update of e;
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
  if not employee.active and (p_direction = 'entrada' or open_shift is null) then
    return jsonb_build_object('status', 'inactive');
  end if;
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
