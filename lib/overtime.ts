import { localDateTime, readLocalDateTime } from "./adjustments";
import { defaultWeekStart, type Weekday } from "./company";
import type { Shift } from "./models";
import { addDays } from "./periods";
import type { Plan, WorkHours } from "./schedules";

const minute = 60_000;
const hour = 60 * minute;
const reform = "2026-05-01";
type DateRange = { from: string; to: string };
type Interval = { start: number; end: number };

export type OvertimeWeek = {
  code: string; name: string; weekStart: string; weekEnd: string;
  double: number; triple: number; excess: number; review: number;
  alerts: string[];
};

const mondayIndex = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
const startOfWeek = (day: string, firstDay: Weekday) => addDays(day, -((mondayIndex(day) - firstDay + 7) % 7));

export function overtimeRange(cut: DateRange, firstDay: Weekday = defaultWeekStart) {
  // An overnight shift from the prior day can contribute to the cut.
  const from = startOfWeek(addDays(cut.from, -1), firstDay);
  const startOfLastWeek = startOfWeek(cut.to, firstDay);
  return { from, to: startOfLastWeek > "9999-12-24" ? "9999-12-31" : addDays(startOfLastWeek, 7) };
}

function limits(day: string) {
  const year = Number(day.slice(0, 4));
  const updated = day >= reform;
  return {
    ordinaryWeek: Math.max(40, 48 - Math.max(0, year - 2026) * 2) * hour,
    doubleWeek: Math.min(12, 9 + Math.max(0, year - 2027)) * hour,
    doubleDay: (updated ? 4 : 3) * hour,
    days: updated ? 4 : 3,
    tripleWeek: updated ? 4 * hour : Infinity,
    totalDay: updated ? 12 * hour : Infinity,
  };
}

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function ordinaryDay([start, end]: WorkHours) {
  const from = clockMinutes(start);
  const to = clockMinutes(end) + (end < start ? 1440 : 0);
  const daylight = Math.max(0, Math.min(to, 1200) - Math.max(from, 360))
    + Math.max(0, Math.min(to, 2640) - Math.max(from, 1800));
  const night = to - from - daylight;
  return (night === 0 ? 8 : night >= 210 || daylight === 0 ? 7 : 7.5) * hour;
}

function workHours(plan: Plan | undefined, day: string) {
  return plan?.schedules.find((schedule) => schedule.starts_on <= day)?.week[mondayIndex(day)] ?? null;
}

function localInstant(day: string, time: string, timezone: string) {
  const value = readLocalDateTime(`${day}T${time}`, timezone);
  return value === null ? NaN : Date.parse(value);
}

export function calculateOvertime(cut: DateRange, timezone: string, plans: Plan[], shifts: Shift[], firstDay: Weekday = defaultWeekStart): OvertimeWeek[] {
  const cutStart = localInstant(cut.from, "00:00", timezone);
  const cutEnd = cut.to === "9999-12-31" ? Infinity : localInstant(addDays(cut.to, 1), "00:00", timezone);
  const clip = (start: number, end: number) => Math.max(0, Math.min(end, cutEnd) - Math.max(start, cutStart));
  const byCode = new Map(plans.map((plan) => [plan.code, plan]));
  const byWeek = new Map<string, { code: string; name: string; weekStart: string; days: Map<string, Interval[]> }>();
  const localTimes = new Map<string, number>();
  function scheduledInstant(day: string, time: string) {
    const key = `${day}T${time}`;
    if (!localTimes.has(key)) localTimes.set(key, localInstant(day, time, timezone));
    return localTimes.get(key)!;
  }

  for (const shift of shifts) {
    if (!shift.exited_at) continue;
    const start = Date.parse(shift.entered_at);
    const end = Date.parse(shift.exited_at);
    if (end <= start) continue;
    const [date, time] = localDateTime(shift.entered_at, timezone).split("T");
    const previous = addDays(date, -1);
    const plan = byCode.get(shift.code);
    const overnight = workHours(plan, previous);
    const today = workHours(plan, date);
    const day = overnight && overnight[1] < overnight[0] && time.slice(0, 5) < overnight[1]
      && (!today || time.slice(0, 5) < today[0]) ? previous : date;
    const weekStart = startOfWeek(day, firstDay);
    const key = `${shift.code}/${weekStart}`;
    let week = byWeek.get(key);
    if (!week) {
      week = { code: shift.code, name: shift.name, weekStart, days: new Map() };
      byWeek.set(key, week);
    }
    const intervals = week.days.get(day) ?? [];
    intervals.push({ start, end });
    week.days.set(day, intervals);
  }

  const result: OvertimeWeek[] = [];
  for (const { code, name, weekStart, days } of byWeek.values()) {
    let ordinaryWeek = 0;
    let doubleWeek = 0;
    let tripleWeek = 0;
    let extraDays = 0;
    let visible = false;
    const weekEnd = weekStart > "9999-12-25" ? "9999-12-31" : addDays(weekStart, 6);
    const row: OvertimeWeek = { code, name, weekStart, weekEnd, double: 0, triple: 0, excess: 0, review: 0, alerts: [] };
    const alerts = new Set<string>();

    for (const day of [...days.keys()].sort()) {
      const work = workHours(byCode.get(code), day);
      const rules = limits(day);
      const scheduledStart = work ? scheduledInstant(day, work[0]) : NaN;
      const scheduledEnd = work ? scheduledInstant(work[1] < work[0] ? addDays(day, 1) : day, work[1]) : NaN;
      const hasSchedule = work && Number.isFinite(scheduledStart) && Number.isFinite(scheduledEnd);
      const dailyOrdinaryLimit = work ? ordinaryDay(work) : 0;
      let ordinaryToday = 0;
      let extraToday = 0;
      let workedToday = 0;

      function addExtra(start: number, end: number) {
        if (end <= start) return;
        const duration = end - start;
        // La tarifa se estima por el acumulado semanal. Los límites de distribución tienen sus propias alertas.
        const remainingDouble = Math.max(0, rules.doubleWeek - doubleWeek);
        const doubled = Math.min(duration, remainingDouble);
        const tripled = duration - doubled;
        const doubleEnd = start + doubled;
        const withinTriple = Math.min(tripled, Math.max(0, rules.tripleWeek - tripleWeek));
        row.double += clip(start, doubleEnd) / minute;
        row.triple += clip(doubleEnd, end) / minute;
        row.excess += clip(doubleEnd + withinTriple, end) / minute;
        doubleWeek += doubled;
        tripleWeek += tripled;
        extraToday += duration;
        if (tripleWeek > rules.tripleWeek) alerts.add("Tope semanal de horas triples superado");
      }

      for (const { start, end } of days.get(day)!.sort((a, b) => a.start - b.start)) {
        workedToday += end - start;
        const inCut = clip(start, end);
        visible ||= inCut > 0;
        if (!hasSchedule) {
          row.review += inCut / minute;
          alerts.add("Hay tiempo registrado sin horario ordinario aplicable");
          continue;
        }
        const ordinaryStart = Math.min(end, Math.max(start, scheduledStart));
        const ordinaryEnd = Math.max(ordinaryStart, Math.min(end, scheduledEnd));
        addExtra(start, ordinaryStart);
        const ordinary = Math.max(0, Math.min(ordinaryEnd - ordinaryStart,
          dailyOrdinaryLimit - ordinaryToday, rules.ordinaryWeek - ordinaryWeek));
        ordinaryToday += ordinary;
        ordinaryWeek += ordinary;
        addExtra(ordinaryStart + ordinary, end);
      }

      if (extraToday > 0) extraDays++;
      if (extraToday > rules.doubleDay) alerts.add(`Más de ${rules.doubleDay / hour} h extra en un día`);
      if (extraDays > rules.days) alerts.add(`Horas extra en más de ${rules.days} días de la semana`);
      if (doubleWeek + tripleWeek > rules.doubleWeek) alerts.add(`Más de ${rules.doubleWeek / hour} h extra en la semana`);
      if (workedToday > rules.totalDay) alerts.add("Más de 12 h de jornada en un día");
    }

    row.alerts = [...alerts];
    if (visible && (row.double > 0 || row.triple > 0 || row.review > 0 || row.alerts.length)) result.push(row);
  }
  return result.sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.name.localeCompare(b.name, "es") || a.code.localeCompare(b.code));
}
