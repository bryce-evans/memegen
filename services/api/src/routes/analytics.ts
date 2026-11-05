import { adminAnalyticsQuerySchema, type AdminAnalytics, type AdminAnalyticsDay } from "@memegen/shared";
import { parse, type Sql } from "@memegen/server-kit";
import { requireAdmin, type ApiApp } from "../access.ts";

interface AnalyticsRow {
  from: string;
  to: string;
  login_tracking_started_at: Date;
  totals: AdminAnalytics["totals"];
  daily: AdminAnalyticsDay[];
}

export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/admin/analytics", async (c) => {
    c.header("Cache-Control", "no-store");
    requireAdmin(c);
    const { days } = parse(adminAnalyticsQuerySchema, c.req.query());
    // One statement gives totals and daily buckets a consistent database snapshot.
    // Explicit UTC bounds avoid dependence on the connection's session timezone.
    const [row] = await sql<AnalyticsRow[]>`
      with bounds as (
        select (now() at time zone 'UTC')::date as today,
          (now() at time zone 'UTC')::date - (${days}::int - 1) as first_day
      ), date_window as (
        select *, first_day::timestamp at time zone 'UTC' as starts_at,
          (today + 1)::timestamp at time zone 'UTC' as ends_at from bounds
      ), events as (
        select l.date, 'login' as kind from daily_user_logins l, date_window w
          where l.date between w.first_day and w.today
        union all
        select (m.posted_at at time zone 'UTC')::date, 'post' from memes m, date_window w
          where m.posted_at >= w.starts_at and m.posted_at < w.ends_at
        union all
        select (t.created_at at time zone 'UTC')::date, 'template'
          from templates t join users u on u.id = t.owner_id cross join date_window w
          where lower(u.username) <> 'memegen' and t.created_at >= w.starts_at and t.created_at < w.ends_at
        union all
        select (u.created_at at time zone 'UTC')::date, 'user' from users u, date_window w
          where lower(u.username) <> 'memegen' and u.created_at >= w.starts_at and u.created_at < w.ends_at
        union all
        select (c.created_at at time zone 'UTC')::date, 'comment' from comments c, date_window w
          where c.deleted_at is null and c.created_at >= w.starts_at and c.created_at < w.ends_at
      ), counts as (
        select date, count(*) filter (where kind = 'login') as logins,
          count(*) filter (where kind = 'post') as posts,
          count(*) filter (where kind = 'template') as templates,
          count(*) filter (where kind = 'user') as users,
          count(*) filter (where kind = 'comment') as comments
        from events group by date
      ), daily as (
        select w.first_day + offset_day as date, coalesce(c.logins, 0) as logins,
          coalesce(c.posts, 0) as posts, coalesce(c.templates, 0) as templates,
          coalesce(c.users, 0) as users, coalesce(c.comments, 0) as comments
        from date_window w cross join generate_series(0, ${days}::int - 1) as offset_day
        left join counts c on c.date = w.first_day + offset_day
      )
      select w.first_day::text as "from", w.today::text as "to", metadata.login_tracking_started_at,
        json_build_object(
          'users', (select count(*) from users where lower(username) <> 'memegen'),
          'posts', (select count(*) from memes where posted_at is not null),
          'templates', (select count(*) from templates t join users u on u.id = t.owner_id where lower(u.username) <> 'memegen'),
          'drafts', (select count(*) from memes where posted_at is null),
          'comments', (select count(*) from comments where deleted_at is null),
          'storageBytes', (select coalesce(sum(size_bytes), 0) from assets)
        ) as totals,
        (select json_agg(json_build_object(
          'date', date::text, 'uniqueLogins', logins, 'posts', posts, 'templates', templates,
          'newUsers', users, 'comments', comments
        ) order by date) from daily) as daily
      from date_window w cross join analytics_metadata metadata`;
    return c.json({
      timezone: "UTC", from: row!.from, to: row!.to,
      loginTrackingStartedAt: row!.login_tracking_started_at.toISOString(),
      totals: row!.totals, daily: row!.daily,
    } satisfies AdminAnalytics);
  });
}
