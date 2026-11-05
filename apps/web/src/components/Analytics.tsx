import { useState } from "react";
import type { AdminAnalytics } from "@memegen/shared";
import { Button, EmptyState, Panel, SegmentedControl, Spinner, Stack, Stat, StatGroup, Table, Text } from "@memegen/ui";
import { request } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import { ErrorView } from "./common.tsx";

type AnalyticsDays = "7" | "30" | "90";
const RANGE_OPTIONS: { value: AnalyticsDays; label: string; testId: string }[] = [
  { value: "7", label: "7 days", testId: "analytics-range-7" },
  { value: "30", label: "30 days", testId: "analytics-range-30" },
  { value: "90", label: "90 days", testId: "analytics-range-90" },
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
  return (
    <>
      <Panel heading="Current totals">
        <StatGroup className="analytics-totals">
          <Stat label="Users" value={data.totals.users} valueProps={{ "data-testid": "analytics-total-users" }} />
          <Stat label="Posted memes" value={data.totals.posts} valueProps={{ "data-testid": "analytics-total-posts" }} />
          <Stat label="Added templates" value={data.totals.templates} valueProps={{ "data-testid": "analytics-total-templates" }} />
          <Stat label="Drafts" value={data.totals.drafts} valueProps={{ "data-testid": "analytics-total-drafts" }} />
          <Stat label="Comments" value={data.totals.comments} valueProps={{ "data-testid": "analytics-total-comments" }} />
          <Stat label="Stored asset bytes" value={data.totals.storageBytes} valueProps={{ "data-testid": "analytics-total-storageBytes" }} />
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
          Tracking began {data.loginTrackingStartedAt} (UTC). Earlier dates are not tracked (—), and the first tracked day may be partial.
          Posts use their posting date; templates, new users, and comments use their creation date. These content counts reflect retained records.
        </Text>
        {data.daily.length === 0 ? <EmptyState data-testid="analytics-empty" title="No daily data available." /> : (
          <div className="analytics-table-scroll" tabIndex={0} role="region" aria-label="Daily analytics table" data-testid="analytics-table-scroll">
            <Table data-testid="analytics-daily">
              <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Unique sign-ins</th><th scope="col">Posts</th><th scope="col">Templates</th><th scope="col">New users</th><th scope="col">Comments</th></tr></thead>
              <tbody>{data.daily.map((day) => (
                <tr key={day.date} data-testid="analytics-day" data-date={day.date}>
                  <th scope="row">{day.date}</th>
                  <td data-testid="analytics-day-logins" aria-label={day.date < trackingDay ? "Not tracked" : undefined}>{day.date < trackingDay ? "—" : day.uniqueLogins}</td>
                  <td data-testid="analytics-day-posts">{day.posts}</td>
                  <td data-testid="analytics-day-templates">{day.templates}</td>
                  <td data-testid="analytics-day-users">{day.newUsers}</td>
                  <td data-testid="analytics-day-comments">{day.comments}</td>
                </tr>
              ))}</tbody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  );
}
