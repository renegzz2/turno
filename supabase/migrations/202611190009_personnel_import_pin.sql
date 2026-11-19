create or replace function public.attendance_import_personnel(p_from date, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' set statement_timeout = '60s'
as $$
declare
  org uuid;
  zone text;
  item jsonb;
  line text;
  employee_code text;
  full_name text;
  employee_pin text;
  tolerance integer;
  employee uuid;
  count integer := 0;
begin
  select u.organization_id, o.timezone into org, zone
    from public.organization_users u join public.organizations o on o.id = u.organization_id
    where u.user_id = auth.uid() and u.role = 'admin'
    for share of u;
  if not found then raise insufficient_privilege; end if;
  if p_from is null or p_from < (clock_timestamp() at time zone zone)::date
    or jsonb_typeof(p_rows) is distinct from 'array' then
    raise sqlstate 'PT422' using message = 'invalid_employee';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then
    raise sqlstate 'PT422' using message = 'invalid_employee';
  end if;

  -- Insert in employee number order so concurrent imports acquire unique keys consistently.
  for item in select value from jsonb_array_elements(p_rows) order by value ->> 'code' loop
    line := item ->> 'rowNumber';
    employee_code := item ->> 'code';
    full_name := btrim(item ->> 'name');
    employee_pin := nullif(btrim(item ->> 'pin'), '');
    if employee_code is null or employee_code !~ '^[0-9]{1,12}$' or full_name is null
      or length(full_name) not between 1 and 100 then
      raise sqlstate 'PT422' using message = 'invalid_employee', detail = coalesce(line, '');
    end if;
    if employee_pin is not null and employee_pin !~ '^[0-9]{6}$' then
      raise sqlstate 'PT422' using message = 'invalid_pin', detail = coalesce(line, '');
    end if;
    if (item ->> 'tolerance') is null or (item ->> 'tolerance') !~ '^[0-9]{1,4}$' then
      raise sqlstate 'PT422' using message = 'invalid_schedule', detail = coalesce(line, '');
    end if;
    tolerance := (item ->> 'tolerance')::integer;
    insert into public.employees (organization_id, code, name)
      values (org, employee_code, full_name)
      on conflict (organization_id, code) do nothing returning id into employee;
    if not found then
      raise sqlstate 'PT409' using message = 'duplicate_employee', detail = coalesce(line, '');
    end if;
    if public.attendance_save_schedule(employee, p_from, tolerance, item -> 'week') is distinct from 'ok' then
      raise sqlstate 'PT422' using message = 'invalid_schedule', detail = coalesce(line, '');
    end if;
    if employee_pin is not null and public.attendance_reset_pin(employee, employee_pin) is distinct from true then
      raise sqlstate 'PT422' using message = 'invalid_pin', detail = coalesce(line, '');
    end if;
    count := count + 1;
  end loop;
  return count;
end
$$;

notify pgrst, 'reload schema';
