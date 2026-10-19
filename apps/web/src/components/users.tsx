import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { badgeFor, type UserStats, type UserSummary } from "@memegen/shared";
import { Icon, Stat, Table } from "@memegen/ui";
import type { Paged } from "../usePaged.ts";
import { PagedList } from "./common.tsx";

/** Names of the public user stats (leaderboard columns and sorts, profile tiles). */
export const STAT_LABELS: Record<keyof UserStats, string> = { memeCount: "Posts", highScore: "High score", hScore: "h-score" };

/** Tooltips for stats whose name needs explaining. */
export const STAT_HINTS: Partial<Record<keyof UserStats, string>> = { hScore: "h memes with a score of at least h" };

interface StatFigureProps {
  stats: UserStats;
  stat: keyof UserStats;
  testId?: string;
  /** Keep an invisible star when there's no tier, so a table column's numbers stay aligned. */
  reserve?: boolean;
}

/**
 * A stat's figure followed by a star in the color of the tier it earns (label and description in the tooltip). The
 * figure has its own element (`testId`) so it reads as a bare number.
 */
export function StatFigure({ stats, stat, testId, reserve = true }: StatFigureProps) {
  const badge = badgeFor(stats, stat);
  return (
    <span className="stat-figure">
      <span data-testid={testId}>{stats[stat]}</span>
      {badge ? (
        <Icon
          name="star"
          className="stat-star"
          data-tier={badge.tier}
          label={badge.label}
          tooltip={`${badge.label}: ${badge.description}`}
        />
      ) : (
        reserve && <Icon name="star" className="stat-star" />
      )}
    </span>
  );
}

/** A profile stat tile outlined in the color of the tier the stat earns (if any), its figure starred to match. */
export function TieredStat({ stats, stat, testId }: { stats: UserStats; stat: keyof UserStats; testId: string }) {
  return (
    <Stat
      className="tiered-stat"
      data-testid="profile-stat"
      data-stat={stat}
      data-tier={badgeFor(stats, stat)?.tier}
      label={STAT_LABELS[stat]}
      hint={STAT_HINTS[stat]}
      value={<StatFigure stats={stats} stat={stat} testId={testId} reserve={false} />}
    />
  );
}

/** A paged list of users (search results): each name linking to its profile, with starred public stats. */
export function UserList({ list, empty }: { list: Paged<UserSummary>; empty: ReactNode }) {
  return (
    <PagedList list={list} empty={empty} paging="sentinel">
      {(users) =>
        users.length > 0 && (
          <Table className="user-list" aria-busy={list.loading} data-testid="user-list">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">{STAT_LABELS.memeCount}</th>
                <th scope="col">{STAT_LABELS.highScore}</th>
                <th scope="col" title={STAT_HINTS.hScore}>
                  {STAT_LABELS.hScore}
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map(({ id, username, stats }) => (
                <tr key={id} data-testid="user-row" data-username={username}>
                  <td>
                    <Link to={`/u/${encodeURIComponent(username)}`}>@{username}</Link>
                  </td>
                  <td>
                    <StatFigure stats={stats} stat="memeCount" />
                  </td>
                  <td>
                    <StatFigure stats={stats} stat="highScore" />
                  </td>
                  <td>
                    <StatFigure stats={stats} stat="hScore" />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      }
    </PagedList>
  );
}
