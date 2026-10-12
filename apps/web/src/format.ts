import type { Period } from "@memegen/shared";

/** "1 box", "2 boxes": the count plus `one`, or `many` (default `one + "s"`) when the count isn't 1. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Display names for the ranking periods (feed filter, hot templates, template usage). */
export const PERIOD_LABELS: Record<Period, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  all: "All time",
};
