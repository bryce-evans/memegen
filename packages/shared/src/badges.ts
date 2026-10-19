import type { UserStats } from "./types.ts";

/**
 * A badge: one stat's tier, plus a predicate over public stats deciding whether a user earns it. The web app shows it
 * as a star in the tier's color after that stat's figure, and profile stat tiles take the tier's color as outline.
 */
export interface BadgeDef {
  id: string;
  /** The stat this badge rewards. */
  stat: keyof UserStats;
  tier: BadgeTier;
  label: string;
  description: string;
  show: (stats: UserStats) => boolean;
}

const TIERS = [
  { id: "bronze", label: "Bronze" },
  { id: "silver", label: "Silver" },
  { id: "gold", label: "Gold" },
  { id: "platinum", label: "Platinum" },
  { id: "diamond", label: "Diamond" },
] as const;

export type BadgeTier = (typeof TIERS)[number]["id"];

type Thresholds = readonly [number, number, number, number, number];

/**
 * One badge per tier for a stat. A tier shows while the stat is in [its threshold, the next tier's),
 * so a user carries only their highest tier for each stat.
 */
function tiered(stat: keyof UserStats, name: string, unit: string, thresholds: Thresholds): BadgeDef[] {
  return TIERS.map((tier, i) => {
    const min = thresholds[i]!;
    const next = thresholds[i + 1];
    return {
      id: `${stat}-${tier.id}`,
      stat,
      tier: tier.id,
      label: `${tier.label} ${name}`,
      description: `${unit} of ${min} or more`,
      show: (s: UserStats) => s[stat] >= min && (next === undefined || s[stat] < next),
    };
  });
}

/** Badge config. Add a badge by appending an entry. */
export const BADGES: readonly BadgeDef[] = [
  ...tiered("memeCount", "meme maker", "Posted memes", [3, 10, 25, 50, 100]),
  ...tiered("highScore", "high score", "A meme scoring", [10, 25, 50, 100, 250]),
  ...tiered("hScore", "h-score", "An h-score", [2, 5, 10, 20, 30]),
];

/** The badge `stats` earn for one stat (its highest tier), if any. */
export function badgeFor(stats: UserStats, stat: keyof UserStats): BadgeDef | undefined {
  return BADGES.find((b) => b.stat === stat && b.show(stats));
}
