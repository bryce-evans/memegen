import { z } from "zod";

export const FEEDBACK_LIMITS = {
  messageLength: 4000,
  screenshotCount: 2,
  screenshotBytes: 2097152,
  requestBytes: 6291456,
} as const;

export const feedbackKindSchema = z.enum(["bug", "suggestion", "hug", "report"]);
export type FeedbackKind = z.output<typeof feedbackKindSchema>;
export const feedbackReasonSchema = z.enum(["sex", "drugs", "violence", "gore", "other"]);
export type FeedbackReason = z.output<typeof feedbackReasonSchema>;
export const feedbackTargetSchema = z.object({ kind: z.enum(["meme", "template"]), id: z.uuid() }).strict();
export type FeedbackTarget = z.output<typeof feedbackTargetSchema>;

const pathSchema = z.string().min(1).max(2048).refine((path) => {
  try {
    const decoded = decodeURIComponent(path);
    return decoded.startsWith("/") && !decoded.startsWith("//") && !/[\\?#\u0000-\u0020\u007f]/.test(decoded);
  } catch { return false; }
}, "must be a local pathname without query, fragment, or credentials");
const messageSchema = z.string().trim().max(FEEDBACK_LIMITS.messageLength);
export const feedbackPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bug"), message: messageSchema.min(1), path: pathSchema }).strict(),
  z.object({ kind: z.literal("suggestion"), message: messageSchema.min(1), path: pathSchema }).strict(),
  z.object({ kind: z.literal("hug"), message: messageSchema.min(1), path: pathSchema }).strict(),
  z.object({
    kind: z.literal("report"), message: messageSchema.default(""), path: pathSchema,
    target: feedbackTargetSchema, reason: feedbackReasonSchema,
  }).strict(),
]);
export type FeedbackPayload = z.output<typeof feedbackPayloadSchema>;
export interface FeedbackConfig { enabled: boolean }
