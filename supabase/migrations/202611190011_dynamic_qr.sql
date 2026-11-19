create table attendance_private.qr_contacts (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  destination text not null check (length(destination) between 1 and 254)
);

create table attendance_private.shift_qr (
  employee_id uuid not null references public.employees(id) on delete cascade,
  turn_date date not null,
  slot_start timestamptz not null,
  expires_at timestamptz not null,
  code_hash bytea not null unique,
  shift_id uuid unique references public.attendance_shifts(id),
  exit_used_at timestamptz,
  delivery_id uuid not null unique default gen_random_uuid(),
  delivery_code text,
  delivery_channel text not null,
  delivery_destination text not null,
  leased_until timestamptz,
  primary key (employee_id, turn_date)
);

create index attendance_shift_qr_pending
  on attendance_private.shift_qr(expires_at) where delivery_code is not null;
alter table attendance_private.punch_receipts add column qr_hash bytea;

revoke all on attendance_private.qr_contacts, attendance_private.shift_qr from public, anon, authenticated;

create function public.attendance_qr_contact(p_employee uuid)
returns table(channel text, destination text)
language sql stable security definer set search_path = ''
as $$
  select c.channel, c.destination from attendance_private.qr_contacts c
  join public.employees e on e.id = c.employee_id
  join public.organization_users u on u.organization_id = e.organization_id
  where e.id = p_employee and u.user_id = auth.uid() and u.role = 'admin'
$$;

create function public.attendance_save_qr_contact(p_employee uuid, p_channel text, p_destination text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.employees e join public.organization_users u on u.organization_id = e.organization_id
    where e.id = p_employee and u.user_id = auth.uid() and u.role = 'admin' for update of e;
  if not found then return false; end if;
  if p_channel is null then
    delete from attendance_private.qr_contacts where employee_id = p_employee;
  elsif p_destination is null or length(p_destination) > 254
    or p_channel not in ('email', 'whatsapp')
    or (p_channel = 'email' and p_destination !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
    or (p_channel = 'whatsapp' and p_destination !~ '^[+][1-9][0-9]{7,14}$') then
    return false;
  else
    insert into attendance_private.qr_contacts values (p_employee, p_channel, p_destination)
      on conflict (employee_id) do update set channel = excluded.channel, destination = excluded.destination
      where (qr_contacts.channel, qr_contacts.destination) is distinct from (excluded.channel, excluded.destination);
    if not found then return true; end if;
  end if;
  delete from attendance_private.shift_qr where employee_id = p_employee and shift_id is null;
  return true;
end
$$;

create function public.attendance_issue_shift_qr(p_channels text[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  tick timestamptz := clock_timestamp();
  target record;
  slot timestamptz;
  expiry timestamptz;
  code text;
  issued integer := 0;
begin
  for target in
    select e.id, c.channel, c.destination, d.day, bounds.opens, bounds.closes
    from attendance_private.qr_contacts c
    join public.employees e on e.id = c.employee_id
    join attendance_private.employee_pins pin on pin.employee_id = e.id
    join public.organizations o on o.id = e.organization_id
    cross join lateral (values ((tick at time zone o.timezone)::date)) today(day)
    cross join lateral (values (today.day - 1), (today.day), (today.day + 1)) d(day)
    cross join lateral (
      select s.week -> (extract(isodow from d.day)::integer - 1) as hours
      from attendance_private.employee_schedules s where s.employee_id = e.id and s.starts_on <= d.day
      order by s.starts_on desc limit 1
    ) plan
    cross join lateral (values ((plan.hours ->> 0)::time, (plan.hours ->> 1)::time)) hours(entry, departure)
    cross join lateral (values (
      ((d.day + hours.entry) at time zone o.timezone) - interval '30 minutes',
      ((d.day + case when hours.departure < hours.entry then 1 else 0 end + hours.departure) at time zone o.timezone)
    )) bounds(opens, closes)
    where e.active and c.channel = any(p_channels) and tick >= bounds.opens and tick < bounds.closes
      and not exists (select 1 from public.attendance_shifts s where s.employee_id = e.id
        and (s.exited_at is null or s.entered_at >= bounds.opens and s.entered_at < bounds.closes))
      and not exists (select 1 from public.attendance_incident_records i where i.employee_id = e.id
        and i.cancelled_at is null and i.kind in ('vacation','sick_leave') and d.day between i.starts_on and i.ends_on)
    order by e.id, d.day for update of e skip locked
  loop
    slot := target.opens + floor(extract(epoch from tick - target.opens) / 600) * interval '10 minutes';
    expiry := least(slot + interval '10 minutes', target.closes);
    code := upper(encode(extensions.gen_random_bytes(9), 'hex'));
    insert into attendance_private.shift_qr as q
      (employee_id, turn_date, slot_start, expires_at, code_hash, delivery_code, delivery_channel, delivery_destination)
    values (target.id, target.day, slot, expiry, extensions.digest(code, 'sha256'), code, target.channel, target.destination)
      on conflict (employee_id, turn_date) do update set
        slot_start = excluded.slot_start, expires_at = excluded.expires_at, code_hash = excluded.code_hash,
        delivery_id = gen_random_uuid(), delivery_code = excluded.delivery_code, leased_until = null,
        delivery_channel = excluded.delivery_channel, delivery_destination = excluded.delivery_destination
      where q.shift_id is null and (q.slot_start, q.expires_at) is distinct from (excluded.slot_start, excluded.expires_at);
    if found then issued := issued + 1; end if;
  end loop;
  update attendance_private.shift_qr set delivery_code = null, leased_until = null
    where delivery_code is not null and expires_at <= tick;
  return issued;
end
$$;

create function public.attendance_claim_qr_deliveries(p_channels text[], p_limit integer)
returns table(id uuid, code text, channel text, destination text, expires_at timestamptz)
language sql volatile security definer set search_path = ''
as $$
  with pending as (
    select q.delivery_id from attendance_private.shift_qr q
    join public.employees e on e.id = q.employee_id
    where q.delivery_code is not null and q.shift_id is null and e.active
      and q.delivery_channel = any(p_channels) and q.expires_at > clock_timestamp()
      and (q.leased_until is null or q.leased_until <= clock_timestamp())
      and not exists (select 1 from public.attendance_shifts s where s.employee_id = e.id and s.exited_at is null)
    order by q.expires_at, q.delivery_id limit least(50, greatest(1, p_limit))
    for update of q skip locked
  )
  update attendance_private.shift_qr q set leased_until = clock_timestamp() + interval '75 seconds'
  from pending where q.delivery_id = pending.delivery_id
  returning q.delivery_id, q.delivery_code, q.delivery_channel, q.delivery_destination, q.expires_at
$$;

create function public.attendance_finish_qr_delivery(p_id uuid, p_sent boolean)
returns void language sql security definer set search_path = ''
as $$
  update attendance_private.shift_qr set delivery_code = case when p_sent then null else delivery_code end,
    leased_until = case when p_sent then null else clock_timestamp() + interval '30 seconds' end
  where delivery_id = p_id and delivery_code is not null
$$;

create function public.attendance_qr_delivery_current(p_id uuid)
returns boolean language sql volatile security definer set search_path = ''
as $$
  select exists (
    select 1 from attendance_private.shift_qr q join public.employees e on e.id = q.employee_id
    where q.delivery_id = p_id and q.delivery_code is not null and q.shift_id is null
      and e.active and q.expires_at > clock_timestamp()
      and not exists (select 1 from public.attendance_shifts s where s.employee_id = e.id and s.exited_at is null)
  )
$$;

revoke execute on function public.attendance_qr_contact(uuid), public.attendance_save_qr_contact(uuid,text,text)
  from public, anon;
grant execute on function public.attendance_qr_contact(uuid), public.attendance_save_qr_contact(uuid,text,text)
  to authenticated;
revoke execute on function public.attendance_issue_shift_qr(text[]), public.attendance_claim_qr_deliveries(text[],integer),
  public.attendance_finish_qr_delivery(uuid,boolean), public.attendance_qr_delivery_current(uuid) from public, anon, authenticated;
grant execute on function public.attendance_issue_shift_qr(text[]), public.attendance_claim_qr_deliveries(text[],integer),
  public.attendance_finish_qr_delivery(uuid,boolean), public.attendance_qr_delivery_current(uuid) to service_role;

create function attendance_private.record_punch_qr(kiosk uuid, p_code text, p_pin text, p_direction text, p_request uuid, p_qr text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  employee record;
  limits attendance_private.kiosk_limits%rowtype;
  receipt attendance_private.punch_receipts%rowtype;
  open_shift uuid;
  marked timestamptz;
  token attendance_private.shift_qr%rowtype;
  qr_hash bytea;
begin
  select organization_id into org from public.organization_users
    where user_id = kiosk and role = 'kiosk';
  if org is null then raise insufficient_privilege; end if;
  if p_code is null or p_code !~ '^[0-9]{1,12}$' or p_pin is null
    or p_pin !~ '^[0-9]{6}$' or p_direction is null
    or p_direction not in ('entrada', 'salida') or p_request is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  if p_qr is not null then
    if p_qr !~ '^[A-F0-9]{18}$' then return jsonb_build_object('status', 'qr_invalid'); end if;
    qr_hash := extensions.digest(p_qr, 'sha256');
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
    if receipt.employee_id <> employee.id or receipt.direction <> p_direction
      or receipt.qr_hash is distinct from qr_hash then
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
  end if;
  if p_direction = 'entrada' and (qr_hash is not null or exists (
    select 1 from attendance_private.qr_contacts c where c.employee_id = employee.id
  )) then
    if qr_hash is null then return jsonb_build_object('status', 'qr_required'); end if;
    select * into token from attendance_private.shift_qr q where q.employee_id = employee.id
      and q.code_hash = qr_hash and q.shift_id is null and marked >= q.slot_start and marked < q.expires_at for update;
    if not found then return jsonb_build_object('status', 'qr_invalid'); end if;
  elsif p_direction = 'salida' then
    select * into token from attendance_private.shift_qr q where q.shift_id = open_shift for update;
    if token.shift_id is not null and qr_hash is null then return jsonb_build_object('status', 'qr_required'); end if;
    if qr_hash is not null and (token.code_hash is distinct from qr_hash or token.exit_used_at is not null) then
      return jsonb_build_object('status', 'qr_invalid');
    end if;
  end if;
  if p_direction = 'entrada' then
    insert into public.attendance_shifts (organization_id, employee_id, entered_at)
      values (org, employee.id, marked) returning id into open_shift;
    if token.delivery_id is not null then
      update attendance_private.shift_qr set shift_id = open_shift, delivery_code = null, leased_until = null
        where delivery_id = token.delivery_id;
    end if;
  else
    update public.attendance_shifts set exited_at = marked where id = open_shift;
    if token.shift_id is not null then
      update attendance_private.shift_qr set exit_used_at = marked where shift_id = open_shift;
    end if;
  end if;
  insert into attendance_private.punch_receipts (kiosk_id, request_id, employee_id, direction, marked_at, qr_hash)
    values (kiosk, p_request, employee.id, p_direction, marked, qr_hash);
  return jsonb_build_object('status', 'ok', 'name', employee.name, 'marked_at', marked);
end
$$;

create or replace function attendance_private.record_punch(kiosk uuid, p_code text, p_pin text, p_direction text, p_request uuid)
returns jsonb language sql security definer set search_path = ''
as $$
  select attendance_private.record_punch_qr(kiosk, p_code, p_pin, p_direction, p_request, null)
$$;

create function public.attendance_public_punch_qr(p_token text, p_code text, p_pin text, p_direction text, p_request uuid, p_qr text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  terminal record;
begin
  select * into terminal from attendance_private.find_public_terminal(p_token);
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  return attendance_private.record_punch_qr(terminal.id, p_code, p_pin, p_direction, p_request, p_qr)
    || jsonb_build_object('timezone', terminal.timezone);
end
$$;

revoke execute on function attendance_private.record_punch_qr(uuid,text,text,text,uuid,text) from public, anon, authenticated;
revoke execute on function public.attendance_public_punch_qr(text,text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.attendance_public_punch_qr(text,text,text,text,uuid,text) to anon;
notify pgrst, 'reload schema';
