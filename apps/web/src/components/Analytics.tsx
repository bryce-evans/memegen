import { useState } from "react";
import { formatMB, type AdminAnalytics } from "@memegen/shared";
import { Button, EmptyState, LineChart, Panel, SegmentedControl, Spinner, Stack, Stat, StatGroup, Text, type LineChartSeries } from "@memegen/ui";
import { request } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import { ErrorView } from "./common.tsx";

type AnalyticsDays = "7" | "30" | "90";
const RANGE_OPTIONS: { value: AnalyticsDays; label: string; testId: string }[] = [
  { value: "7", label: "7 days", testId: "analytics-range-7" },
  { value: "30", label: "30 days", testId: "analytics-range-30" },
  { value: "90", label: "90 days", testId: "analytics-range-90" },
];
const ACTIVITY_SERIES: LineChartSeries[] = [
  { key: "uniqueLogins", label: "Unique sign-ins" },
  { key: "posts", label: "Posts" },
  { key: "templates", label: "Templates" },
  { key: "newUsers", label: "New users" },
  { key: "comments", label: "Comments" },
];

export function Analytics() {
  const [days, setDays] = useState<AnalyticsDays>("30");
  const [attempt, setAttempt] = useState(0);
  const { data, error, loading } = useAsync(`${days}:${attempt}`, () =>
    request<AdminAnalytics>(`/api/admin/analytics?days=${days}`, { cache: "no-store" }),
  );
  return (
    <Stack className="analytics" data-testid="analytics-panel" aria-busy={loading}>
      <Panel heading="Site analytics" headingActions={
        <SegmentedControl aria-label="Analytics date range" value={days} onChange={setDays} options={RANGE_OPTIONS} />
      }>
        <Text tone="muted">Daily activity uses UTC calendar days, including today. Today is still in progress.</Text>
      </Panel>
      {loading ? <Spinner data-testid="analytics-loading" label="Loading analytics…" /> : error !== null ? (
        <Stack>
          <ErrorView error={error} testId="analytics-error" />
          <Button data-testid="analytics-retry" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
        </Stack>
      ) : data ? <AnalyticsData data={data} /> : null}
    </Stack>
  );
}

function AnalyticsData({ data }: { data: AdminAnalytics }) {
  const trackingDay = data.loginTrackingStartedAt.slice(0, 10);
  const storageBytes = data.totals.storageBytes;
  const storageSize = storageBytes >= 1024 ** 3
    ? `${(storageBytes / 1024 ** 3).toFixed(1)} GB`
    : storageBytes >= 1024 ** 2 ? formatMB(storageBytes) : `${(storageBytes / 1024).toFixed(1)} KB`;
  return (
    <>
      <Panel heading="Current totals">
        <StatGroup className="analytics-totals">
          <Stat label="Users" value={data.totals.users} valueProps={{ "data-testid": "analytics-total-users" }} />
          <Stat label="Posted memes" value={data.totals.posts} valueProps={{ "data-testid": "analytics-total-posts" }} />
          <Stat label="Added templates" value={data.totals.templates} valueProps={{ "data-testid": "analytics-total-templates" }} />
          <Stat label="Drafts" value={data.totals.drafts} valueProps={{ "data-testid": "analytics-total-drafts" }} />
          <Stat label="Comments" value={data.totals.comments} valueProps={{ "data-testid": "analytics-total-comments" }} />
          <Stat label="Stored assets" value={storageSize} valueProps={{ "data-testid": "analytics-total-storageBytes", title: `${storageBytes.toLocaleString()} bytes` }} />
        </StatGroup>
        <Text size="sm" tone="muted" data-testid="analytics-content-note">
          Totals are site-wide, not limited to the selected dates. Content counts reflect records still retained, not lifetime creation totals.
          Posts include public and unlisted posted memes, with drafts counted separately. Templates include variations and unlisted templates,
          excluding the built-in @memegen library. User counts exclude @memegen. Comments exclude soft-deleted comments.
          Storage includes the bytes of all stored assets, including assets left after content deletion.
        </Text>
      </Panel>
      <Panel heading="Daily activity">
        <Text data-testid="analytics-date-range">{data.from} – {data.to} (UTC)</Text>
        <Text size="sm" tone="muted" data-testid="analytics-tracking-note">
          Unique sign-ins count each user once per UTC day after a successful sign-in, not session checks or page views; @memegen is excluded.
          Tracking began {data.loginTrackingStartedAt} (UTC). Earlier dates are not tracked and appear as gaps; the first tracked day may be partial.
          Posts use their posting date; templates, new users, and comments use their creation date. These content counts reflect retained records.
        </Text>
        {data.daily.length === 0 ? <EmptyState data-testid="analytics-empty" title="No daily data available." /> : (
          <LineChart
            data-testid="analytics-chart"
            label="Daily activity chart"
            axisLabel="UTC calendar days"
            series={ACTIVITY_SERIES}
            data={data.daily.map((day) => ({
              label: day.date,
              values: {
                uniqueLogins: day.date < trackingDay ? null : day.uniqueLogins,
                posts: day.posts,
                templates: day.templates,
                newUsers: day.newUsers,
                comments: day.comments,
              },
            }))}
          />
        )}
      </Panel>
    </>
  );
}
