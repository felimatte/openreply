export type DurationUnit = "seconds" | "minutes" | "hours";

export const MAX_DELAY_MINUTES = 10080;

const minutesPerUnit: Record<DurationUnit, number> = { seconds: 1 / 60, minutes: 1, hours: 60 };
const labels: Record<DurationUnit, [string, string]> = {
  seconds: ["segundo", "segundos"], minutes: ["minuto", "minutos"], hours: ["hora", "horas"],
};

export function durationToMinutes(value: number, unit: DurationUnit): number {
  return value * minutesPerUnit[unit];
}

export function durationFromMinutes(minutes: number, unit: DurationUnit): number {
  // Avoid showing floating-point artifacts when a saved number of seconds is reopened.
  return Number((minutes / minutesPerUnit[unit]).toPrecision(12));
}

export function getDurationUnit(data: { minutes: number; unit?: DurationUnit }): DurationUnit {
  if (data.unit) return data.unit;
  if (data.minutes > 0 && data.minutes < 1) return "seconds";
  if (data.minutes >= 60 && data.minutes % 60 === 0) return "hours";
  return "minutes";
}

export function formatDelayDuration(data: { minutes: number; unit?: DurationUnit }): string {
  const unit = getDurationUnit(data);
  const value = durationFromMinutes(data.minutes, unit);
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 9 }).format(value)} ${labels[unit][value === 1 ? 0 : 1]}`;
}
