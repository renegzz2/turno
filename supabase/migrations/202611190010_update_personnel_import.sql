create function public.attendance_apply_personnel_import(p_from date, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '60s'
as $$
declare
  org uuid;
  zone text;
  item jsonb;
  line text;
  employee_code text;
  previous_code text;
  full_name text;
  employee_pin text;
  new_week jsonb;
  new_tolerance integer;
  current_week jsonb;
  current_tolerance integer;
  employee uuid;
  is_new boolean;
  created integer := 0;
  existing integer := 0;
begin
  select u.organization_id, o.timezone into org, zone
    from public.organization_users u join public.organizations o on o.id = u.organization_id
    where u.user_id = auth.uid() and u.role = 'admin' for share of u;
  if not found then raise insufficient_privilege; end if;
  if p_from is null or p_from < (clock_timestamp() at time zone zone)::date
    or jsonb_typeof(p_rows) is distinct from 'array' then
    raise sqlstate 'PT422' using message = 'invalid_employee';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then
    raise sqlstate 'PT422' using message = 'invalid_employee';
  end if;

  -- Lock employees in number order for concurrent imports.
  for item in select value from jsonb_array_elements(p_rows) order by value ->> 'code' loop
    line := coalesce(item ->> 'rowNumber', '');
    employee_code := item ->> 'code';
    full_name := nullif(btrim(item ->> 'name'), '');
    employee_pin := nullif(btrim(item ->> 'pin'), '');
    new_week := nullif(item -> 'week', 'null'::jsonb);
    if employee_code is null or employee_code !~ '^[0-9]{1,12}$' or length(full_name) > 100 then
      raise sqlstate 'PT422' using message = 'invalid_employee', detail = line;
    end if;
    if employee_code = previous_code then
      raise sqlstate 'PT409' using message = 'duplicate_employee', detail = line;
    end if;
    previous_code := employee_code;
    if employee_pin is not null and employee_pin !~ '^[0-9]{6}$' then
      raise sqlstate 'PT422' using message = 'invalid_pin', detail = line;
    end if;
    if (item ->> 'tolerance') is not null and (item ->> 'tolerance') !~ '^[0-9]{1,4}$' then
      raise sqlstate 'PT422' using message = 'invalid_schedule', detail = line;
    end if;
    new_tolerance := (item ->> 'tolerance')::integer;

    select e.id into employee from public.employees e
      where e.organization_id = org and e.code = employee_code for update;
    is_new := false;
    if not found then
      if full_name is null then raise sqlstate 'PT422' using message = 'name_required', detail = line; end if;
      insert into public.employees (organization_id, code, name)
        values (org, employee_code, full_name)
        on conflict (organization_id, code) do nothing returning id into employee;
      is_new := found;
      if not is_new then
        select e.id into strict employee from public.employees e
          where e.organization_id = org and e.code = employee_code for update;
      end if;
    end if;

    if is_new or new_week is not null or new_tolerance is not null then
      select s.week, s.tolerance into current_week, current_tolerance
        from attendance_private.employee_schedules s
        where s.employee_id = employee and s.starts_on <= p_from
        order by s.starts_on desc limit 1;
      if public.attendance_save_schedule(employee, p_from, coalesce(new_tolerance, current_tolerance, 0),
        coalesce(new_week, current_week, '[null,null,null,null,null,null,null]'::jsonb)) is distinct from 'ok' then
        raise sqlstate 'PT422' using message = 'invalid_schedule', detail = line;
      end if;
    end if;
    if employee_pin is not null and public.attendance_reset_pin(employee, employee_pin) is distinct from true then
      raise sqlstate 'PT422' using message = 'invalid_pin', detail = line;
    end if;
    if is_new then created := created + 1; else existing := existing + 1; end if;
  end loop;
  return jsonb_build_object('created', created, 'existing', existing);
end
$$;

revoke execute on function public.attendance_apply_personnel_import(date, jsonb) from public, anon;
grant execute on function public.attendance_apply_personnel_import(date, jsonb) to authenticated;

-- Manual schedule changes use the same employee lock as imports.
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
    where e.id = p_employee and u.user_id = auth.uid() and u.role in ('admin', 'leader') for update of e;
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

notify pgrst, 'reload schema';
