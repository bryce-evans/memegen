import { Link, useSearchParams } from "react-router-dom";
import { LEADERBOARD_SORTS, type LeaderboardSort } from "@memegen/shared";
import { EmptyState, Icon, PageHeader, SegmentedControl, Spinner, Table } from "@memegen/ui";
import { getLeaderboard } from "../api.ts";
import { ErrorView } from "../components/common.tsx";
import { STAT_HINTS, STAT_LABELS, UserBadges } from "../components/users.tsx";
import { useAsync } from "../useAsync.ts";

export function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const byParam = params.get("by");
  const by: LeaderboardSort = LEADERBOARD_SORTS.find((s) => s === byParam) ?? "hScore";
  const { data: entries, error, loading } = useAsync(by, () => getLeaderboard(by));

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
            options={LEADERBOARD_SORTS.map((s) => ({ value: s, label: STAT_LABELS[s], testId: `leaderboard-by-${s}` }))}
          />
        }
      />
      {error !== null && <ErrorView error={error} />}
      <div data-testid="leaderboard" aria-busy={loading}>
        {loading && <Spinner label="Loading…" />}
        {entries?.length === 0 && <EmptyState icon={<Icon name="chart" />} title="Nobody has posted a meme yet." />}
        {entries && entries.length > 0 && (
          <Table className="leaderboard">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">User</th>
                <th scope="col" aria-sort={by === "memeCount" ? "descending" : undefined}>
                  {STAT_LABELS.memeCount}
                </th>
                <th scope="col" aria-sort={by === "highScore" ? "descending" : undefined}>
                  {STAT_LABELS.highScore}
                </th>
                <th scope="col" aria-sort={by === "hScore" ? "descending" : undefined} title={STAT_HINTS.hScore}>
                  {STAT_LABELS.hScore}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ rank, user, stats }) => (
                <tr key={user.id} data-testid="leaderboard-row" data-username={user.username}>
                  <td data-testid="leaderboard-rank">{rank}</td>
                  <td>
                    <Link to={`/u/${user.username}`} data-testid="lb-username">@{user.username}</Link>
                    <UserBadges stats={stats} compact />
                  </td>
                  <td data-testid="lb-meme-count">{stats.memeCount}</td>
                  <td data-testid="lb-high-score">{stats.highScore}</td>
                  <td data-testid="lb-h-score">{stats.hScore}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  );
}
