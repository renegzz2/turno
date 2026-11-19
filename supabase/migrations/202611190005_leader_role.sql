alter table public.organization_users
  drop constraint organization_users_role_check,
  add constraint organization_users_role_check check (role in ('admin', 'leader', 'kiosk'));

-- These operations are available to the two dashboard roles in their own organization.
-- Personnel changes, PIN resets, incident cancellation, and kiosk punches keep their existing grants.
create or replace function public.attendance_employees()
returns table (id uuid, code text, name text, active boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.code, e.name, e.active
  from public.employees e join public.organization_users u on u.organization_id = e.organization_id
  where u.user_id = auth.uid() and u.role in ('admin', 'leader')
  order by e.name, e.id
$$;

create or replace function public.attendance_report(p_from date, p_to date)
returns table (id uuid, code text, name text, entered_at timestamptz, exited_at timestamptz, minutes integer)
language sql stable security definer set search_path = ''
as $$
  with bounds as (
    select o.id, p_from::timestamp at time zone o.timezone as starts,
      (p_to + 1)::timestamp at time zone o.timezone as ends
    from public.organization_users u join public.organizations o on o.id = u.organization_id
    where u.user_id = auth.uid() and u.role in ('admin', 'leader') and p_from <= p_to
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

create or replace function public.attendance_add_incident(p_id uuid, p_employee uuid, p_kind text, p_from date, p_to date)
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
    where e.id = p_employee and u.user_id = auth.uid() and u.role in ('admin', 'leader')
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

create or replace function public.attendance_incidents(p_from date, p_to date)
returns table (id uuid, code text, name text, kind text, starts_on date, ends_on date)
language sql stable security definer set search_path = ''
as $$
  select i.id, e.code, e.name, i.kind, i.starts_on, i.ends_on
  from public.attendance_incident_records i
  join public.employees e on e.id = i.employee_id and e.organization_id = i.organization_id
  join public.organization_users u on u.organization_id = i.organization_id
  where u.user_id = auth.uid() and u.role in ('admin', 'leader') and i.cancelled_at is null
    and (p_from is null or i.ends_on >= p_from)
    and (p_to is null or i.starts_on <= p_to)
    and (p_from is null or p_to is null or p_from <= p_to)
  order by i.starts_on desc, i.id
$$;

create or replace function public.attendance_plans(p_employee uuid default null)
returns table (id uuid, code text, name text, active boolean, schedules jsonb, statuses jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.code, e.name, e.active,
    coalesce((select jsonb_agg(jsonb_build_object('starts_on', s.starts_on, 'tolerance', s.tolerance, 'week', s.week)
      order by s.starts_on desc) from attendance_private.employee_schedules s where s.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('starts_on', d.starts_on, 'active', d.active)
      order by d.starts_on desc) from attendance_private.employee_status_days d where d.employee_id = e.id), '[]'::jsonb)
    from public.employees e join public.organization_users u on u.organization_id = e.organization_id
    where u.user_id = auth.uid() and u.role in ('admin', 'leader')
      and (p_employee is null or e.id = p_employee)
$$;

create or replace function public.attendance_save_schedule(p_employee uuid, p_from date, p_tolerance integer, p_week jsonb)
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
    where e.id = p_employee and u.user_id = auth.uid() and u.role in ('admin', 'leader');
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

create or replace function public.attendance_entries(p_from date, p_to date)
returns table (code text, entered_at timestamptz, id uuid)
language sql stable security definer set search_path = ''
as $$
  select e.code, s.entered_at, s.id
  from public.organization_users u join public.organizations o on o.id = u.organization_id
  join public.attendance_shifts s on s.organization_id = o.id
  join public.employees e on e.id = s.employee_id
  where u.user_id = auth.uid() and u.role in ('admin', 'leader') and p_from <= p_to
    and s.entered_at >= p_from::timestamp at time zone o.timezone
    and s.entered_at < (p_to + 1)::timestamp at time zone o.timezone
$$;

create or replace function public.attendance_justify_absence(p_employee uuid, p_day date)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  previous public.attendance_incident_records%rowtype;
begin
  if p_day is null then return 'invalid'; end if;
  select e.organization_id into org from public.employees e
    join public.organization_users u on u.organization_id = e.organization_id
    where e.id = p_employee and u.user_id = auth.uid() and u.role in ('admin', 'leader')
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

create or replace function public.attendance_editable_shift(p_shift uuid)
returns table (id uuid, employee_id uuid, code text, name text, entered_at timestamptz, exited_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, e.id, e.code, e.name, s.entered_at, s.exited_at
  from public.attendance_shifts s
  join public.employees e on e.id = s.employee_id and e.organization_id = s.organization_id
  join public.organization_users u on u.organization_id = s.organization_id
  where s.id = p_shift and u.user_id = auth.uid() and u.role in ('admin', 'leader')
$$;

create or replace function public.attendance_shift_adjustments(p_shift uuid)
returns table (id uuid, shift_id uuid, code text, name text, made_at timestamptz, made_by text, reason text,
  before_entry timestamptz, before_exit timestamptz, after_entry timestamptz, after_exit timestamptz)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.shift_id, e.code, e.name, a.made_at, a.made_by, a.reason,
    a.before_entry, a.before_exit, a.after_entry, a.after_exit
  from public.attendance_shift_adjustment_records a
  join public.employees e on e.id = a.employee_id and e.organization_id = a.organization_id
  join public.organization_users u on u.organization_id = a.organization_id
  where u.user_id = auth.uid() and u.role in ('admin', 'leader') and (p_shift is null or a.shift_id = p_shift)
$$;

create or replace function public.attendance_adjust_shift(
  p_request uuid, p_employee uuid, p_shift uuid, p_expected_entry timestamptz, p_expected_exit timestamptz,
  p_entry timestamptz, p_exit timestamptz, p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  editor uuid := auth.uid();
  editor_label text;
  previous public.attendance_shifts%rowtype;
  saved public.attendance_shift_adjustment_records%rowtype;
  next_entry timestamptz;
  next_exit timestamptz;
  shift uuid := p_shift;
begin
  if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or (p_entry is null and p_exit is null) then return jsonb_build_object('status', 'invalid'); end if;

  -- The kiosk takes the same employee lock before changing a shift.
  select e.organization_id into org
  from public.employees e join public.organization_users u on u.organization_id = e.organization_id
  where e.id = p_employee and u.user_id = editor and u.role in ('admin', 'leader')
  for update of e;
  if not found then return jsonb_build_object('status', 'invalid'); end if;

  select * into saved from public.attendance_shift_adjustment_records where id = p_request;
  if found then
    if saved.actor_id = editor and saved.employee_id = p_employee and saved.reason = btrim(p_reason)
      and ((p_shift is null and saved.before_entry is null) or saved.shift_id = p_shift)
      and saved.before_entry is not distinct from p_expected_entry
      and saved.before_exit is not distinct from p_expected_exit
      and saved.after_entry = coalesce(p_entry, saved.before_entry)
      and saved.after_exit is not distinct from coalesce(p_exit, saved.before_exit) then
      return jsonb_build_object('status', 'ok', 'shift_id', saved.shift_id);
    end if;
    return jsonb_build_object('status', 'stale');
  end if;

  if p_shift is not null then
    select * into previous from public.attendance_shifts
      where id = p_shift and employee_id = p_employee and organization_id = org;
    if not found then return jsonb_build_object('status', 'invalid'); end if;
    if previous.entered_at is distinct from p_expected_entry or previous.exited_at is distinct from p_expected_exit then
      return jsonb_build_object('status', 'stale');
    end if;
  end if;

  next_entry := coalesce(p_entry, previous.entered_at);
  next_exit := coalesce(p_exit, previous.exited_at);
  if next_entry is null or not isfinite(next_entry) or next_entry > clock_timestamp()
    or (next_exit is not null and (not isfinite(next_exit) or next_exit <= next_entry or next_exit > clock_timestamp())) then
    return jsonb_build_object('status', 'times');
  end if;
  if p_shift is not null and next_entry = previous.entered_at and next_exit is not distinct from previous.exited_at then
    return jsonb_build_object('status', 'unchanged');
  end if;
  if exists (
    select 1 from public.attendance_shifts s where s.employee_id = p_employee
      and s.id is distinct from p_shift
      and tstzrange(s.entered_at, s.exited_at, '[)') && tstzrange(next_entry, next_exit, '[)')
  ) then return jsonb_build_object('status', 'overlap'); end if;

  if p_shift is null then
    insert into public.attendance_shifts (organization_id, employee_id, entered_at, exited_at)
      values (org, p_employee, next_entry, next_exit) returning id into shift;
  else
    update public.attendance_shifts set entered_at = next_entry, exited_at = next_exit where id = shift;
  end if;
  select email into editor_label from auth.users where id = editor;
  insert into public.attendance_shift_adjustment_records (
    id, shift_id, organization_id, employee_id, actor_id, made_by, reason, before_entry, before_exit, after_entry, after_exit
  ) values (
    p_request, shift, org, p_employee, editor, coalesce(editor_label, editor::text), btrim(p_reason),
    previous.entered_at, previous.exited_at, next_entry, next_exit
  );
  return jsonb_build_object('status', 'ok', 'shift_id', shift);
end
$$;
