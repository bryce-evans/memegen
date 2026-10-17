import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { badgesFor, type UserStats, type UserSummary } from "@memegen/shared";
import { Badge, Table } from "@memegen/ui";
import type { Paged } from "../usePaged.ts";
import { PagedList } from "./common.tsx";

/** Names of the public user stats (leaderboard columns and sorts, profile tiles). */
export const STAT_LABELS: Record<keyof UserStats, string> = { memeCount: "Memes", highScore: "High score", hScore: "h-score" };

/** Tooltips for stats whose name needs explaining. */
export const STAT_HINTS: Partial<Record<keyof UserStats, string>> = { hScore: "h memes with a score of at least h" };

/**
 * The badges a user's stats earn: `compact` as bare icons after a name (leaderboard rows; label and description in
 * the tooltip), otherwise as a labelled list (profile).
 */
export function UserBadges({ stats, compact = false }: { stats: UserStats; compact?: boolean }) {
  const badges = badgesFor(stats);
  if (badges.length === 0) return null;
  if (compact) {
    return badges.map((b) => (
      <span key={b.id} className="user-badge-icon" role="img" aria-label={b.label} title={`${b.label}: ${b.description}`}>
        {b.icon}
      </span>
    ));
  }
  return (
    <ul className="user-badges" aria-label="Badges">
      {badges.map((b) => (
        <li key={b.id}>
          <Badge tone="warning" title={b.description} data-testid="profile-badge" data-badge={b.id}>
            <span aria-hidden>{b.icon}</span> {b.label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** A paged list of users (search results): each name linking to its profile, with badges and public stats. */
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
                    <UserBadges stats={stats} compact />
                  </td>
                  <td>{stats.memeCount}</td>
                  <td>{stats.highScore}</td>
                  <td>{stats.hScore}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      }
    </PagedList>
  );
}
