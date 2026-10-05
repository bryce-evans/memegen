import { leaderboardQuerySchema, pageQuerySchema, sessionSchema, type User, type UserProfile } from "@memegen/shared";
import { page, parse, parseJson, requireInternal, toUser, type Sql, type UserRow } from "@memegen/server-kit";
import { findUserByName, requireUser, type ApiApp } from "../access.ts";
import {
  memeListed,
  memeSelect,
  memeVisibleTo,
  templateSelect,
  templateVisibleTo,
  toMeme,
  withVariations,
  type MemeRow,
  type TemplateRow,
} from "../rows.ts";
import { leaderboard, publicStats, userStats } from "../stats.ts";

const pageQuery = pageQuerySchema();

/** Public stats plus how many public templates (variations included) the user added. */
async function profile(sql: Sql, user: User): Promise<UserProfile> {
  const [stats, [count]] = await Promise.all([
    userStats(sql, user.id),
    sql<{ n: number }[]>`select count(*)::int as n from templates where owner_id = ${user.id} and is_public`,
  ]);
  return { user, stats: publicStats(stats), templateCount: count!.n };
}

/** Session, profiles, the signed-in user's lists, stats, and the leaderboard. */
export function register(app: ApiApp, sql: Sql): void {
  /** DEV login: find-or-create by username. Replace with a real AuthProvider flow. */
  app.post("/api/session", async (c) => {
    const { username } = await parseJson(c, sessionSchema);
    const [row] = await sql<UserRow[]>`
      with ins as (
        insert into users (username) values (${username})
        on conflict (lower(username)) do nothing
        returning id, username, created_at
      )
      select * from ins
      union all
      select id, username, created_at from users where lower(username) = lower(${username})
      limit 1`;
    return c.json({ user: toUser(row!) });
  });

  app.get("/api/me", async (c) => c.json(await profile(sql, requireUser(c))));

  app.get("/api/users/:username", async (c) => {
    return c.json(await profile(sql, await findUserByName(sql, c.req.param("username"))));
  });

  app.get("/api/users/:username/memes", async (c) => {
    const owner = await findUserByName(sql, c.req.param("username"));
    const { offset, limit } = parse(pageQuery, c.req.query());
    const viewer = c.get("user");
    const rows = await sql<MemeRow[]>`${memeSelect(sql, viewer?.id ?? null)}
      where m.owner_id = ${owner.id}
      ${viewer?.id === owner.id ? sql`` : sql`and ${memeListed(sql)}`}
      order by coalesce(m.posted_at, m.created_at) desc, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });

  /** Templates the user added (variations included), newest first; the owner also sees private ones. */
  app.get("/api/users/:username/templates", async (c) => {
    const owner = await findUserByName(sql, c.req.param("username"));
    const { offset, limit } = parse(pageQuery, c.req.query());
    const viewerId = c.get("user")?.id ?? null;
    const rows = await sql<TemplateRow[]>`${templateSelect(sql)}
      where t.owner_id = ${owner.id} and ${templateVisibleTo(sql, viewerId)}
      order by t.created_at desc, t.id
      offset ${offset} limit ${limit + 1}`;
    const { items, nextOffset } = page(rows, offset, limit);
    return c.json({ items: await withVariations(sql, items, viewerId), nextOffset });
  });

  app.get("/internal/users/:username/stats", async (c) => {
    requireInternal(c);
    const user = await findUserByName(sql, c.req.param("username"));
    return c.json(await userStats(sql, user.id));
  });

  app.get("/api/leaderboard", async (c) => {
    const { by, limit } = parse(leaderboardQuerySchema, c.req.query());
    return c.json(await leaderboard(sql, by, limit));
  });

  /** Recent activity: every meme the signed-in user voted on (`myVote` says which way) that they can still see, newest vote first. */
  app.get("/api/me/activity", async (c) => {
    const user = requireUser(c);
    const { offset, limit } = parse(pageQuery, c.req.query());
    const rows = await sql<MemeRow[]>`${memeSelect(sql, user.id)}
      where v.user_id is not null and ${memeVisibleTo(sql, user.id)}
      order by v.created_at desc, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });

  /** The signed-in user's starred memes that they can still see, most recently starred first. */
  app.get("/api/me/favorites", async (c) => {
    const user = requireUser(c);
    const { offset, limit } = parse(pageQuery, c.req.query());
    const rows = await sql<MemeRow[]>`${memeSelect(sql, user.id)}
      join favorites f on f.meme_id = m.id and f.user_id = ${user.id}
      where ${memeVisibleTo(sql, user.id)}
      order by f.created_at desc, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });
}
