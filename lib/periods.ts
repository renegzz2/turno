export const periodNames = {
  week: "Semanal",
  fortnight: "Catorcenal",
  half: "Quincenal",
  month: "Mensual",
  custom: "Personalizado",
} as const;

export type Period = keyof typeof periodNames;
export type Cut = { period: Period; from: string; to: string };
export type Query = Record<string, string | string[] | undefined>;

export function localDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function preset(period: Exclude<Period, "custom">, anchor: string): Cut {
  if (period === "week" || period === "fortnight") {
    return { period, from: anchor, to: addDays(anchor, period === "week" ? 6 : 13) };
  }
  const [year, month, day] = anchor.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = anchor.slice(0, 7);
  const secondHalf = period === "half" && day > 15;
  return {
    period,
    from: `${prefix}-${secondHalf ? "16" : "01"}`,
    to: `${prefix}-${period === "half" && !secondHalf ? 15 : last}`,
  };
}

export function readCut(query: Query, today: string): Cut | null {
  const { from, to, period } = query;
  if (from === undefined && to === undefined) return preset("half", today);
  if ((period === "week" || period === "fortnight") && isDate(from)) {
    const cut = preset(period, from);
    return isDate(cut.to) ? cut : null;
  }
  if (!isDate(from) || !isDate(to) || from > to) return null;
  const selected = typeof period === "string" && Object.hasOwn(periodNames, period)
    ? period as Period : "custom";
  return { from, to, period: selected };
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function stamp(value: string, timeZone: string) {
  const date = new Date(value);
  return {
    date: localDate(date, timeZone),
    time: new Intl.DateTimeFormat("es-MX", {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(date),
  };
}
