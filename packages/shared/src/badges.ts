import type { UserStats } from "./types.ts";

/** A profile badge: an emoji icon plus a predicate over public stats deciding whether the profile shows it. */
export interface BadgeDef {
  id: string;
  icon: string;
  label: string;
  description: string;
  show: (stats: UserStats) => boolean;
}

const TIERS = [
  { id: "bronze", label: "Bronze", icon: "🥉" },
  { id: "silver", label: "Silver", icon: "🥈" },
  { id: "gold", label: "Gold", icon: "🥇" },
  { id: "platinum", label: "Platinum", icon: "🏆" },
  { id: "diamond", label: "Diamond", icon: "💎" },
] as const;

type Thresholds = readonly [number, number, number, number, number];

/**
 * One badge per tier for a stat. A tier shows while the stat is in [its threshold, the next tier's),
 * so a profile carries only its highest tier for each stat.
 */
function tiered(stat: keyof UserStats, name: string, unit: string, thresholds: Thresholds): BadgeDef[] {
  return TIERS.map((tier, i) => {
    const min = thresholds[i]!;
    const next = thresholds[i + 1];
    return {
      id: `${stat}-${tier.id}`,
      icon: tier.icon,
      label: `${tier.label} ${name}`,
      description: `${unit} of ${min} or more`,
      show: (s: UserStats) => s[stat] >= min && (next === undefined || s[stat] < next),
    };
  });
}

/** Badge config. Add a badge by appending an entry; the profile renders whatever `show` accepts. */
export const BADGES: readonly BadgeDef[] = [
  ...tiered("memeCount", "meme maker", "Posted memes", [3, 10, 25, 50, 100]),
  ...tiered("highScore", "high score", "A meme scoring", [10, 25, 50, 100, 250]),
  ...tiered("hScore", "h-score", "An h-score", [2, 5, 10, 20, 30]),
];

export function badgesFor(stats: UserStats): BadgeDef[] {
  return BADGES.filter((b) => b.show(stats));
}
