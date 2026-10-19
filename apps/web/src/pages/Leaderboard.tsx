import { Link, useSearchParams } from "react-router-dom";
import { LEADERBOARD_SORTS, type LeaderboardSort } from "@memegen/shared";
import { Badge, Button, EmptyState, Icon, PageHeader, Spinner, Table } from "@memegen/ui";
import { getLeaderboard } from "../api.ts";
import { useUser } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { STAT_HINTS, STAT_LABELS, StatFigure } from "../components/users.tsx";
import { useAsync } from "../useAsync.ts";

/** Test id of each stat column's figures; the columns follow `LEADERBOARD_SORTS`, like the "Rank by" control. */
const FIGURE_TEST_IDS: Record<LeaderboardSort, string> = {
  memeCount: "lb-meme-count",
  highScore: "lb-high-score",
  hScore: "lb-h-score",
};

export function Leaderboard() {
  const me = useUser();
  const [params, setParams] = useSearchParams();
  const byParam = params.get("by");
  const by: LeaderboardSort = LEADERBOARD_SORTS.find((s) => s === byParam) ?? "hScore";
  // Keep the board up while it re-sorts: its headings are the sort buttons, so blanking it would drop focus.
  const { data: entries, error, loading } = useAsync(by, () => getLeaderboard(by), { keepStale: true });

  return (
    <section>
      <PageHeader title="Leaderboard" />
      {error !== null && <ErrorView error={error} />}
      <div data-testid="leaderboard" aria-busy={loading}>
        {loading && !entries && <Spinner label="Loading…" />}
        {entries?.length === 0 && <EmptyState icon={<Icon name="chart" />} title="Nobody has posted a meme yet." />}
        {entries && entries.length > 0 && (
          <Table className="leaderboard">
            <thead>
              <tr>
                {/* Rank and name need no visible heading; screen readers still get one. */}
                <th scope="col">
                  <span className="ui-visually-hidden">Rank</span>
                </th>
                <th scope="col">
                  <span className="ui-visually-hidden">User</span>
                </th>
                {/* Each stat heading ranks the board by that stat. */}
                {LEADERBOARD_SORTS.map((stat) => (
                  <th key={stat} scope="col" aria-sort={by === stat ? "descending" : undefined}>
                    <Button
                      variant="quiet"
                      size="sm"
                      className="leaderboard-sort"
                      pressed={by === stat}
                      title={STAT_HINTS[stat] ? `Rank by ${STAT_LABELS[stat]}: ${STAT_HINTS[stat]}` : `Rank by ${STAT_LABELS[stat]}`}
                      data-testid={`leaderboard-by-${stat}`}
                      onClick={() => setParams({ by: stat }, { replace: true })}
                    >
                      {/* Narrow headings wrap between words only, never at the hyphen in "h-score". */}
                      <span className="leaderboard-sort-label">
                        {STAT_LABELS[stat].split(" ").map((word, i) => (
                          <span key={word}>
                            {i > 0 && " "}
                            <span className="leaderboard-sort-word">{word}</span>
                          </span>
                        ))}
                      </span>
                      <Icon name="down" className="leaderboard-sort-arrow" />
                    </Button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(({ rank, user, stats }) => {
                const isMe = user.id === me.id;
                return (
                  <tr
                    key={user.id}
                    data-testid="leaderboard-row"
                    data-username={user.username}
                    data-podium={rank <= 3 ? rank : undefined}
                    aria-current={isMe ? "true" : undefined}
                  >
                    <td className="leaderboard-rank">
                      <span className="leaderboard-rank-chip" data-testid="leaderboard-rank">
                        {rank}
                      </span>
                    </td>
                    <td className="leaderboard-user">
                      <Link to={`/u/${encodeURIComponent(user.username)}`} className="leaderboard-name" data-testid="lb-username">
                        @{user.username}
                      </Link>
                      {isMe && (
                        <Badge tone="primary" className="leaderboard-you">
                          You
                        </Badge>
                      )}
                    </td>
                    {LEADERBOARD_SORTS.map((stat) => (
                      <td key={stat} className="leaderboard-stat" data-sorted={by === stat || undefined}>
                        <StatFigure stats={stats} stat={stat} testId={FIGURE_TEST_IDS[stat]} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  );
}
