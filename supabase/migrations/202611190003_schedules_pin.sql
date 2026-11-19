create table attendance_private.employee_schedules (
  employee_id uuid not null references public.employees(id),
  starts_on date not null,
  tolerance integer not null check (tolerance between 0 and 1439),
  week jsonb not null,
  primary key (employee_id, starts_on)
);

create table attendance_private.employee_status_days (
  employee_id uuid not null references public.employees(id),
  starts_on date not null,
  active boolean not null,
  primary key (employee_id, starts_on)
);

insert into attendance_private.employee_status_days
select e.id, (now() at time zone o.timezone)::date, e.active
from public.employees e join public.organizations o on o.id = e.organization_id;

create function attendance_private.record_employee_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into attendance_private.employee_status_days (employee_id, starts_on, active)
    select new.id, (clock_timestamp() at time zone o.timezone)::date, new.active
    from public.organizations o where o.id = new.organization_id
    on conflict (employee_id, starts_on) do update set active = excluded.active;
  return new;
end
$$;

create trigger attendance_status_on_hire after insert on public.employees
  for each row execute function attendance_private.record_employee_status();
create trigger attendance_status_on_change after update of active on public.employees
  for each row when (old.active is distinct from new.active)
  execute function attendance_private.record_employee_status();

create function public.attendance_plans(p_employee uuid default null)
returns table (id uuid, code text, name text, active boolean, schedules jsonb, statuses jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.code, e.name, e.active,
    coalesce((select jsonb_agg(jsonb_build_object('starts_on', s.starts_on, 'tolerance', s.tolerance, 'week', s.week)
      order by s.starts_on desc) from attendance_private.employee_schedules s where s.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('starts_on', d.starts_on, 'active', d.active)
      order by d.starts_on desc) from attendance_private.employee_status_days d where d.employee_id = e.id), '[]'::jsonb)
    from public.employees e join public.organization_users u on u.organization_id = e.organization_id
    where u.user_id = auth.uid() and u.role = 'admin'
      and (p_employee is null or e.id = p_employee)
$$;

create function public.attendance_save_schedule(p_employee uuid, p_from date, p_tolerance integer, p_week jsonb)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  zone text;
  i integer;
  hours jsonb;
  next_hours jsonb;
  starts text;
  ends text;
  time_pattern text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  select o.timezone into zone from public.employees e
    join public.organization_users u on u.organization_id = e.organization_id
    join public.organizations o on o.id = e.organization_id
    where e.id = p_employee and u.user_id = auth.uid() and u.role = 'admin';
  if not found then return 'invalid'; end if;
  if p_from is null or p_from < (clock_timestamp() at time zone zone)::date
    or p_tolerance is null or p_tolerance not between 0 and 1439
    or jsonb_typeof(p_week) is distinct from 'array' then return 'invalid'; end if;
  if jsonb_array_length(p_week) <> 7 then return 'invalid'; end if;
  for i in 0..6 loop
    hours := p_week -> i;
    if hours = 'null'::jsonb then continue; end if;
    if jsonb_typeof(hours) <> 'array' then return 'invalid'; end if;
    if jsonb_array_length(hours) <> 2 then return 'invalid'; end if;
    starts := hours ->> 0;
    ends := hours ->> 1;
    if starts is null or ends is null or starts !~ time_pattern or ends !~ time_pattern
      or starts = ends then return 'invalid'; end if;
    next_hours := p_week -> ((i + 1) % 7);
    if starts > ends and ends > (next_hours ->> 0) then return 'overlap'; end if;
  end loop;
  insert into attendance_private.employee_schedules (employee_id, starts_on, tolerance, week)
    values (p_employee, p_from, p_tolerance, p_week)
    on conflict (employee_id, starts_on) do update set tolerance = excluded.tolerance, week = excluded.week;
  return 'ok';
end
$$;

create function public.attendance_reset_pin(p_employee uuid, p_pin text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then return false; end if;
  perform 1 from public.employees e
    join public.organization_users u on u.organization_id = e.organization_id
    where e.id = p_employee and u.user_id = auth.uid() and u.role = 'admin'
    for update of e;
  if not found then return false; end if;
  insert into attendance_private.employee_pins (employee_id, pin_hash)
    values (p_employee, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
    on conflict (employee_id) do update set pin_hash = excluded.pin_hash;
  return true;
end
$$;

create function public.attendance_entries(p_from date, p_to date)
returns table (code text, entered_at timestamptz, id uuid)
language sql stable security definer set search_path = ''
as $$
  select e.code, s.entered_at, s.id
  from public.organization_users u join public.organizations o on o.id = u.organization_id
  join public.attendance_shifts s on s.organization_id = o.id
  join public.employees e on e.id = s.employee_id
  where u.user_id = auth.uid() and u.role = 'admin' and p_from <= p_to
    and s.entered_at >= p_from::timestamp at time zone o.timezone
    and s.entered_at < (p_to + 1)::timestamp at time zone o.timezone
$$;

create function public.attendance_justify_absence(p_employee uuid, p_day date)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  previous public.attendance_incident_records%rowtype;
begin
  if p_day is null then return 'invalid'; end if;
  select e.organization_id into org from public.employees e
    join public.organization_users u on u.organization_id = e.organization_id
    where e.id = p_employee and u.user_id = auth.uid() and u.role = 'admin'
    for update of e;
  if not found then return 'invalid'; end if;
  select * into previous from public.attendance_incident_records i
    where i.employee_id = p_employee and i.cancelled_at is null
      and p_day between i.starts_on and i.ends_on for update;
  if found then
    if previous.kind = 'justified' then return 'ok'; end if;
    if previous.kind <> 'unjustified' then return 'overlap'; end if;
    update public.attendance_incident_records set cancelled_at = clock_timestamp(), cancelled_by = auth.uid()
      where id = previous.id;
    insert into public.attendance_incident_records (id, organization_id, employee_id, kind, starts_on, ends_on, created_by)
      select gen_random_uuid(), org, p_employee, 'unjustified', span.starts, span.ends, previous.created_by
      from (values (previous.starts_on, p_day - 1), (p_day + 1, previous.ends_on)) span(starts, ends)
      where span.starts <= span.ends;
  end if;
  insert into public.attendance_incident_records (id, organization_id, employee_id, kind, starts_on, ends_on)
    values (gen_random_uuid(), org, p_employee, 'justified', p_day, p_day);
  return 'ok';
end
$$;

revoke execute on function attendance_private.record_employee_status() from public, anon, authenticated;
revoke execute on function public.attendance_plans(uuid), public.attendance_save_schedule(uuid, date, integer, jsonb),
  public.attendance_reset_pin(uuid, text), public.attendance_entries(date, date),
  public.attendance_justify_absence(uuid, date) from public, anon;
grant execute on function public.attendance_plans(uuid), public.attendance_save_schedule(uuid, date, integer, jsonb),
  public.attendance_reset_pin(uuid, text), public.attendance_entries(date, date),
  public.attendance_justify_absence(uuid, date) to authenticated;
