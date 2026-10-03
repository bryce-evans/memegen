import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LEADERBOARD_SORTS, badgesFor, type LeaderboardEntry, type LeaderboardSort } from "@memegen/shared";
import { EmptyState, Icon, PageHeader, SegmentedControl, Spinner } from "@memegen/ui";
import { getLeaderboard } from "../api.ts";
import { ErrorView } from "../components/common.tsx";

const SORT_LABELS: Record<LeaderboardSort, string> = { hScore: "h-score", highScore: "High score", memeCount: "Memes" };

export function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const byParam = params.get("by");
  const by: LeaderboardSort = LEADERBOARD_SORTS.find((s) => s === byParam) ?? "hScore";
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    getLeaderboard(by).then(
      (rows) => !cancelled && setEntries(rows),
      (err) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [by]);

  return (
    <section>
      <PageHeader
        title="Leaderboard"
        actions={
          <SegmentedControl
            aria-label="Rank by"
            size="sm"
            value={by}
            onChange={(next) => setParams({ by: next }, { replace: true })}
            options={LEADERBOARD_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s], testId: `leaderboard-by-${s}` }))}
          />
        }
      />
      {error !== null && <ErrorView error={error} />}
      <div data-testid="leaderboard" aria-busy={entries === null && error === null}>
        {entries === null && error === null && <Spinner label="Loading…" />}
        {entries?.length === 0 && <EmptyState icon={<Icon name="chart" />} title="Nobody has posted a meme yet." />}
        {entries && entries.length > 0 && (
          <table className="leaderboard">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">User</th>
                <th scope="col" aria-sort={by === "memeCount" ? "descending" : undefined}>
                  Memes
                </th>
                <th scope="col" aria-sort={by === "highScore" ? "descending" : undefined}>
                  High score
                </th>
                <th scope="col" aria-sort={by === "hScore" ? "descending" : undefined} title="h memes with a score of at least h">
                  h-score
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ rank, user, stats }) => (
                <tr key={user.id} data-testid="leaderboard-row" data-username={user.username}>
                  <td data-testid="leaderboard-rank">{rank}</td>
                  <td>
                    <Link to={`/u/${user.username}`}>@{user.username}</Link>
                    {badgesFor(stats).map((b) => (
                      <span key={b.id} className="leaderboard-badge" role="img" aria-label={b.label} title={`${b.label}: ${b.description}`}>
                        {b.icon}
                      </span>
                    ))}
                  </td>
                  <td data-testid="lb-meme-count">{stats.memeCount}</td>
                  <td data-testid="lb-high-score">{stats.highScore}</td>
                  <td data-testid="lb-h-score">{stats.hScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
