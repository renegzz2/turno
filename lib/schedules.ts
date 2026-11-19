import type { Employee, Incident } from "./models";
import { addDays, localDate } from "./periods";

export const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export type WorkHours = [string, string];
export type Schedule = { starts_on: string; tolerance: number; week: (WorkHours | null)[] };
export type Plan = Employee & { schedules: Schedule[]; statuses: { starts_on: string; active: boolean }[] };
export type Entry = { code: string; entered_at: string };
export type Exception = {
  employeeId: string; code: string; name: string; day: string;
  expected: string; actual: string | null; minutes: number | null;
  kind: "late" | "absent" | "justified";
};
export const exceptionNames = { late: "Retardo", absent: "Falta", justified: "Falta justificada" } as const;
const minute = 60_000;
const dateAndTime = (date: string, time: string) => Date.parse(`${date}T${time}Z`);
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
export const isTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

export function validWeek(week: Schedule["week"]) {
  return week.every((hours, day) => {
    if (!hours) return true;
    const [start, end] = hours;
    if (!isTime(start) || !isTime(end) || start === end) return false;
    const next = week[(day + 1) % 7];
    return start < end || !next || end <= next[0];
  });
}

function workday(plan: Plan, day: string) {
  const status = plan.statuses.find((version) => version.starts_on <= day);
  const schedule = plan.schedules.find((version) => version.starts_on <= day);
  const hours = schedule?.week[weekday(day)];
  if (!status?.active || !schedule || !hours) return null;
  const [start, end] = hours;
  const overnight = end < start;
  return { start, end, overnight, tolerance: schedule.tolerance, endsAt: dateAndTime(overnight ? addDays(day, 1) : day, end) };
}

export function detectExceptions(
  cut: { from: string; to: string }, timezone: string, now: Date,
  plans: Plan[], entries: Entry[], incidents: Incident[],
): Exception[] {
  const today = localDate(now, timezone);
  const lastDay = cut.to < today ? cut.to : today;
  const clock = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const [nowDate, nowTime] = clock.format(now).split(" ");
  const nowLocal = dateAndTime(nowDate, nowTime);
  const byCode = new Map(plans.map((plan) => [plan.code, plan]));
  const firstEntries = new Map<string, string>();
  for (const entry of entries) {
    const plan = byCode.get(entry.code);
    if (!plan?.schedules.length) continue;
    const [day, time] = clock.format(new Date(entry.entered_at)).split(" ");
    const previous = addDays(day, -1);
    const previousShift = workday(plan, previous);
    const currentShift = workday(plan, day);
    const belongsToPrevious = previousShift?.overnight && time.slice(0, 5) < previousShift.end
      && (!currentShift || time.slice(0, 5) < currentShift.start);
    const key = `${entry.code}/${belongsToPrevious ? previous : day}`;
    const timestamp = `${day}T${time}`;
    const current = firstEntries.get(key);
    if (!current || timestamp < current) firstEntries.set(key, timestamp);
  }
  const incidentsByCode = Map.groupBy(incidents, (row) => row.code);
  const results: Exception[] = [];
  for (const plan of plans) {
    if (!plan.schedules.length) continue;
    const first = plan.schedules.at(-1)!.starts_on;
    for (let day = first > cut.from ? first : cut.from; day <= lastDay; day = addDays(day, 1)) {
      const work = workday(plan, day);
      if (!work) continue;
      const incident = incidentsByCode.get(plan.code)?.find((row) => row.starts_on <= day && row.ends_on >= day);
      if (incident?.kind === "vacation" || incident?.kind === "sick_leave") continue;
      const actual = firstEntries.get(`${plan.code}/${day}`) ?? null;
      const base = { employeeId: plan.id, code: plan.code, name: plan.name, day, expected: work.start };
      if (actual) {
        const actualTime = actual.slice(11, 16);
        const minutes = Math.floor((Date.parse(`${actual}Z`) - dateAndTime(day, work.start)) / minute);
        if (minutes > work.tolerance && incident?.kind !== "justified") {
          results.push({ ...base, actual: actualTime, minutes, kind: "late" });
        }
      } else if (nowLocal >= work.endsAt) {
        results.push({ ...base, actual: null, minutes: null, kind: incident?.kind === "justified" ? "justified" : "absent" });
      }
    }
  }
  return results.sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name, "es"));
}
