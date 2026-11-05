import { z } from "zod";

export const adminAnalyticsQuerySchema = z.object({
  days: z.enum(["7", "30", "90"]).default("30").transform(Number),
});

export interface AdminAnalyticsDay {
  /** UTC calendar date, YYYY-MM-DD. */
  date: string;
  uniqueLogins: number;
  posts: number;
  templates: number;
  newUsers: number;
  comments: number;
}

export interface AdminAnalytics {
  timezone: "UTC";
  /** Inclusive UTC calendar dates, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Installation-wide ISO timestamp; earlier login counts were not tracked. */
  loginTrackingStartedAt: string;
  /** Current retained records, independent of the selected daily window. */
  totals: {
    users: number;
    posts: number;
    templates: number;
    drafts: number;
    comments: number;
    storageBytes: number;
  };
  daily: AdminAnalyticsDay[];
}
