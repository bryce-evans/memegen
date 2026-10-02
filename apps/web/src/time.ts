const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "3m ago", "2h ago", "5d ago"; older than ~a month → "Mar 4" (plus year if not this year). */
export function timeAgo(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const diff = Math.max(0, now - date.getTime());
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}
