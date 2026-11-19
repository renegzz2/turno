create table public.attendance_shift_adjustment_records (
  id uuid primary key,
  shift_id uuid not null references public.attendance_shifts(id),
  organization_id uuid not null,
  employee_id uuid not null,
  made_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  made_by text not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  before_entry timestamptz,
  before_exit timestamptz,
  after_entry timestamptz not null,
  after_exit timestamptz,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id)
);

create index attendance_adjustments_org_time
  on public.attendance_shift_adjustment_records (organization_id, made_at desc, id);
create index attendance_adjustments_shift_time
  on public.attendance_shift_adjustment_records (shift_id, made_at desc, id);

alter table public.attendance_shift_adjustment_records enable row level security;
revoke all on public.attendance_shift_adjustment_records from public, anon, authenticated;

create function public.attendance_editable_shift(p_shift uuid)
returns table (id uuid, employee_id uuid, code text, name text, entered_at timestamptz, exited_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, e.id, e.code, e.name, s.entered_at, s.exited_at
  from public.attendance_shifts s
  join public.employees e on e.id = s.employee_id and e.organization_id = s.organization_id
  join public.organization_users u on u.organization_id = s.organization_id
  where s.id = p_shift and u.user_id = auth.uid() and u.role = 'admin'
$$;

create function public.attendance_shift_adjustments(p_shift uuid)
returns table (id uuid, shift_id uuid, code text, name text, made_at timestamptz, made_by text, reason text,
  before_entry timestamptz, before_exit timestamptz, after_entry timestamptz, after_exit timestamptz)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.shift_id, e.code, e.name, a.made_at, a.made_by, a.reason,
    a.before_entry, a.before_exit, a.after_entry, a.after_exit
  from public.attendance_shift_adjustment_records a
  join public.employees e on e.id = a.employee_id and e.organization_id = a.organization_id
  join public.organization_users u on u.organization_id = a.organization_id
  where u.user_id = auth.uid() and u.role = 'admin' and (p_shift is null or a.shift_id = p_shift)
$$;

create function public.attendance_adjust_shift(
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
  where e.id = p_employee and u.user_id = editor and u.role = 'admin'
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

revoke execute on function public.attendance_editable_shift(uuid), public.attendance_shift_adjustments(uuid),
  public.attendance_adjust_shift(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.attendance_editable_shift(uuid), public.attendance_shift_adjustments(uuid),
  public.attendance_adjust_shift(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, text)
  to authenticated;
