import type { InternalUserStats } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";

/**
 * Stats over a user's posted memes.
 * hScore: largest h with h memes scoring >= h.
 * negativeHScore: largest h with h memes scoring <= -h (internal only).
 */
export async function userStats(sql: Sql, userId: string): Promise<InternalUserStats> {
  const [row] = await sql<
    { meme_count: number; high_score: number | null; h_score: number; negative_h_score: number }[]
  >`
    with posted as (
      select score,
        row_number() over (order by score desc) as up_rank,
        row_number() over (order by score asc) as down_rank
      from memes
      where owner_id = ${userId} and posted_at is not null
    )
    select
      count(*)::int as meme_count,
      max(score)::int as high_score,
      coalesce(max(up_rank) filter (where score >= up_rank), 0)::int as h_score,
      coalesce(max(down_rank) filter (where -score >= down_rank), 0)::int as negative_h_score
    from posted`;
  return {
    memeCount: row!.meme_count,
    highScore: row!.high_score ?? 0,
    hScore: row!.h_score,
    negativeHScore: row!.negative_h_score,
  };
}

export function publicStats({ negativeHScore: _hidden, ...stats }: InternalUserStats) {
  return stats;
}
