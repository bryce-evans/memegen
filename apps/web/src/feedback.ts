import { useEffect, useState } from "react";
import type { FeedbackConfig, FeedbackPayload } from "@memegen/shared";
import { request } from "./api.ts";

export function useFeedbackConfig() {
  const [config, setConfig] = useState<FeedbackConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    setError(null);
    void request<FeedbackConfig>("/api/feedback/config", { signal: controller.signal }).then(
      (value) => { if (!controller.signal.aborted) setConfig(value); },
      () => { if (!controller.signal.aborted) setError("Could not check feedback availability. Please try again."); },
    );
    return () => controller.abort();
  }, [attempt]);
  return { config, error, retry: () => setAttempt((value) => value + 1) };
}

export async function deliverFeedback(payload: FeedbackPayload, screenshots: File[] = []): Promise<void> {
  const body = new FormData();
  body.set("payload", JSON.stringify(payload));
  for (const file of screenshots) body.append("screenshots", file);
  const response = await request<{ delivered: boolean }>("/api/feedback", { method: "POST", body });
  if (response.delivered !== true) throw new Error("Feedback was not confirmed delivered. Your draft has been kept.");
}

export function feedbackError(error: unknown): string {
  return error instanceof Error ? error.message : "Feedback could not be delivered. Please try again.";
}
