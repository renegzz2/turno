create table attendance_private.public_terminals (
  kiosk_id uuid primary key references public.organization_users(user_id) on delete cascade,
  token_hash bytea not null unique
);
revoke all on attendance_private.public_terminals from public, anon, authenticated;

create function attendance_private.find_public_terminal(p_token text)
returns table (id uuid, name text, timezone text)
language sql stable security definer set search_path = ''
as $$
  select u.user_id, o.name, o.timezone
  from attendance_private.public_terminals t
  join public.organization_users u on u.user_id = t.kiosk_id
  join public.organizations o on o.id = u.organization_id
  where u.role = 'kiosk' and p_token ~ '^[0-9a-f]{64}$'
    and t.token_hash = extensions.digest(p_token, 'sha256')
$$;

create function attendance_private.record_punch(kiosk uuid, p_code text, p_pin text, p_direction text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
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

create or replace function public.attendance_punch(p_code text, p_pin text, p_direction text, p_request uuid)
returns jsonb language sql security definer set search_path = ''
as $$
  select attendance_private.record_punch(auth.uid(), p_code, p_pin, p_direction, p_request)
$$;

create function public.attendance_public_kiosk(p_token text)
returns table (name text, timezone text)
language sql stable security definer set search_path = ''
as $$
  select t.name, t.timezone from attendance_private.find_public_terminal(p_token) t
$$;

create function public.attendance_public_punch(p_token text, p_code text, p_pin text, p_direction text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  terminal record;
begin
  select * into terminal from attendance_private.find_public_terminal(p_token);
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  return attendance_private.record_punch(terminal.id, p_code, p_pin, p_direction, p_request)
    || jsonb_build_object('timezone', terminal.timezone);
end
$$;

revoke execute on function attendance_private.find_public_terminal(text),
  attendance_private.record_punch(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.attendance_public_kiosk(text),
  public.attendance_public_punch(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.attendance_public_kiosk(text),
  public.attendance_public_punch(text, text, text, text, uuid) to anon;
