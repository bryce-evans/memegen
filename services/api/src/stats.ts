import type { InternalUserStats, LeaderboardEntry, LeaderboardSort, UserStats } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";

interface StatsRow {
  owner_id: string;
  meme_count: number;
  high_score: number;
  h_score: number;
  negative_h_score: number;
}

/**
 * Per-owner stats over posted memes, one row per owner with at least one posted meme.
 * `filter` narrows the memes (e.g. to one owner). The single definition behind every stat.
 * hScore: largest h with h memes scoring >= h.
 * negativeHScore: largest h with h memes scoring <= -h (internal only).
 */
function statsSelect(sql: Sql, filter = sql``) {
  return sql`
    with posted as (
      select owner_id, score,
        row_number() over (partition by owner_id order by score desc) as up_rank,
        row_number() over (partition by owner_id order by score asc) as down_rank
      from memes
      where posted_at is not null ${filter}
    )
    select owner_id,
      count(*)::int as meme_count,
      max(score)::int as high_score,
      coalesce(max(up_rank) filter (where score >= up_rank), 0)::int as h_score,
      coalesce(max(down_rank) filter (where -score >= down_rank), 0)::int as negative_h_score
    from posted
    group by owner_id`;
}

export async function userStats(sql: Sql, userId: string): Promise<InternalUserStats> {
  const [row] = await sql<StatsRow[]>`${statsSelect(sql, sql`and owner_id = ${userId}`)}`;
  return {
    memeCount: row?.meme_count ?? 0,
    highScore: row?.high_score ?? 0,
    hScore: row?.h_score ?? 0,
    negativeHScore: row?.negative_h_score ?? 0,
  };
}

export function publicStats({ negativeHScore: _hidden, ...stats }: InternalUserStats): UserStats {
  return stats;
}

const SORT_COLUMN: Record<LeaderboardSort, string> = {
  hScore: "h_score",
  highScore: "high_score",
  memeCount: "meme_count",
};

/** Users with at least one posted meme, best first by `by`; ties fall through the other stats, then username. */
export async function leaderboard(sql: Sql, by: LeaderboardSort, limit: number): Promise<LeaderboardEntry[]> {
  const rows = await sql<(StatsRow & { username: string })[]>`
    select s.*, u.username
    from (${statsSelect(sql)}) s
    join users u on u.id = s.owner_id
    order by ${sql(SORT_COLUMN[by])} desc, s.h_score desc, s.high_score desc, s.meme_count desc,
      lower(u.username), u.username
    limit ${limit}`;
  return rows.map((r, i) => ({
    rank: i + 1,
    user: { id: r.owner_id, username: r.username },
    stats: { memeCount: r.meme_count, highScore: r.high_score, hScore: r.h_score },
  }));
}
