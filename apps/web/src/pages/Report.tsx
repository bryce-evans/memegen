import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FEEDBACK_LIMITS, type FeedbackReason, type FeedbackTarget } from "@memegen/shared";
import { Button, Inline, LinkButton, PageHeader, Panel, SelectField, Stack, Text, TextArea } from "@memegen/ui";
import { useAuth } from "../auth.tsx";
import { deliverFeedback, feedbackError, useFeedbackConfig } from "../feedback.ts";

const REASONS: Record<FeedbackReason, string> = { sex: "Sex", drugs: "Drugs", violence: "Violence", gore: "Gore", other: "Other" };

export function Report() {
  const { kind, id } = useParams();
  if ((kind !== "meme" && kind !== "template") || !id) {
    return <Panel heading="Report"><Text role="alert" tone="danger">This report link does not identify a meme or template.</Text></Panel>;
  }
  return <ReportForm key={`${kind}:${id}`} target={{ kind, id }} />;
}

function ReportForm({ target }: { target: FeedbackTarget }) {
  const { user } = useAuth();
  const availability = useFeedbackConfig();
  const [reason, setReason] = useState<FeedbackReason | "">("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetPath = target.kind === "meme" ? `/m/${encodeURIComponent(target.id)}` : `/create?template=${encodeURIComponent(target.id)}`;

  async function submit() {
    if (!user || !reason || sending || !availability.config?.enabled) return;
    setSending(true);
    setError(null);
    try {
      await deliverFeedback({ kind: "report", target, reason, message: message.trim(), path: window.location.pathname });
      setDelivered(true);
    } catch (err) {
      setError(feedbackError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="report-page" data-feedback-private data-testid="report-page">
      <PageHeader title={`Report ${target.kind}`} />
      <Panel>
        <Stack>
          <Text data-testid="report-target">Reporting {target.kind}: <Link to={targetPath}>{target.id}</Link></Text>
          {!user ? <Text>Sign in to submit a report.</Text> : availability.error ? (
            <Stack><Text role="alert" tone="danger">{availability.error}</Text><Button onClick={availability.retry}>Try again</Button></Stack>
          ) : !availability.config ? <Text role="status">Checking report availability…</Text> : !availability.config.enabled ? (
            <Text data-testid="report-unavailable">Reporting is unavailable: this server has no delivery destination configured.</Text>
          ) : delivered ? (
            <Stack><Text role="status" data-testid="report-success">Your report was delivered. Thank you for helping keep the community safe.</Text>
              <LinkButton as={Link} to={targetPath}>Back to {target.kind}</LinkButton>
            </Stack>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <Stack>
                <SelectField label="Reason" value={reason} required disabled={sending} data-testid="report-reason"
                  onChange={(event) => setReason(event.target.value as FeedbackReason | "")}>
                  <option value="">Choose a reason</option>
                  {(Object.keys(REASONS) as FeedbackReason[]).map((value) => <option key={value} value={value}>{REASONS[value]}</option>)}
                </SelectField>
                <TextArea label="Additional details (optional)" value={message} rows={5} disabled={sending}
                  maxLength={FEEDBACK_LIMITS.messageLength} onChange={(event) => setMessage(event.target.value)} data-testid="report-message" />
                <Text size="sm" tone="muted">Your account, the content reference, reason, and any details will be sent to this site's configured feedback destination. No screenshot is attached.</Text>
                {error && <Text role="alert" tone="danger" data-testid="report-error">{error} Your report has been kept so you can try again.</Text>}
                <Inline>
                  <Button type="submit" variant="primary" disabled={sending || !reason} data-testid="report-submit">{sending ? "Sending…" : "Submit report"}</Button>
                  <LinkButton as={Link} to={targetPath}>Cancel</LinkButton>
                </Inline>
              </Stack>
            </form>
          )}
        </Stack>
      </Panel>
    </section>
  );
}
