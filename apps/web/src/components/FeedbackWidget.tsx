import { useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { FEEDBACK_LIMITS, type FeedbackKind } from "@memegen/shared";
import { Button, Dialog, FileButton, Icon, IconButton, Inline, Stack, Text, TextArea } from "@memegen/ui";
import { useAuth } from "../auth.tsx";
import { deliverFeedback, feedbackError, useFeedbackConfig } from "../feedback.ts";

type ComposerKind = Exclude<FeedbackKind, "report">;
const LABELS: Record<ComposerKind, string> = { bug: "Bug", suggestion: "Suggestion", hug: "Hug" };
interface Screenshot { file: File; url: string; automatic: boolean }

/** Capture only the page, never credentials, editable fields, private settings, or feedback itself. */
async function captureScreenshot(): Promise<File> {
  let timer: number | undefined;
  try {
    const blob = await Promise.race([
      toBlob(document.documentElement, {
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: 1,
        skipFonts: true,
        style: { transform: `translateY(-${window.scrollY}px)`, transformOrigin: "top left" },
        filter: (node) => !(node instanceof Element) || !node.matches(
          '[data-feedback-ui], [data-feedback-private], [data-testid="ai-agents"], input, textarea, select, [contenteditable], iframe',
        ),
      }),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Screenshot capture timed out.")), 15_000);
      }),
    ]);
    if (!blob || blob.size === 0) throw new Error("The browser could not capture this page.");
    if (blob.size > FEEDBACK_LIMITS.screenshotBytes) throw new Error("The automatic screenshot exceeds 2 MiB.");
    return new File([blob], "page-screenshot.png", { type: "image/png" });
  } finally {
    clearTimeout(timer);
  }
}

export function FeedbackWidget() {
  const { user } = useAuth();
  const availability = useFeedbackConfig();
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [kind, setKind] = useState<ComposerKind | null>(null);
  const [message, setMessage] = useState("");
  const [path, setPath] = useState("");
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const generation = useRef(0);
  const urls = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => {
    generation.current++;
    busy.current = false;
    setCapturing(false);
    setSending(false);
    setOpen(false);
    setKind(null);
    setMessage("");
    setPath("");
    setScreenshots([]);
    setCaptureError(null);
    setUploadError(null);
    setError(null);
    setDelivered(false);
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    return () => {
      generation.current++;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [user?.id]);

  async function openComposer() {
    if (busy.current) return;
    if (!user || !availability.config?.enabled || path) {
      setOpen(true);
      return;
    }
    const current = ++generation.current;
    busy.current = true;
    setCapturing(true);
    setPath(window.location.pathname);
    setDelivered(false);
    // The menu/dialog is not mounted until capture finishes. The persistent button is filtered out too.
    try {
      const file = await captureScreenshot();
      if (current !== generation.current) return;
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      setScreenshots([{ file, url, automatic: true }]);
    } catch (err) {
      if (current === generation.current) setCaptureError(`${feedbackError(err)} Upload your own screenshot below, or send without one.`);
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setCapturing(false);
        setOpen(true);
      }
    }
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files);
    if (screenshots.length + incoming.length > FEEDBACK_LIMITS.screenshotCount) {
      setUploadError("Attach at most 2 screenshots. Remove one before adding another.");
      return;
    }
    if (incoming.some((file) => file.size > FEEDBACK_LIMITS.screenshotBytes)) {
      setUploadError("Each screenshot must be 2 MiB or smaller.");
      return;
    }
    if (incoming.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size)) {
      setUploadError("Choose a non-empty PNG, JPEG, or WebP screenshot.");
      return;
    }
    setUploadError(null);
    setScreenshots((previous) => [...previous, ...incoming.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return { file, url, automatic: false };
    })]);
  }

  async function submit() {
    if (!kind || !user || !message.trim() || sending || !availability.config?.enabled) return;
    const current = generation.current;
    setSending(true);
    setError(null);
    try {
      await deliverFeedback({ kind, message: message.trim(), path }, screenshots.map(({ file }) => file));
      if (current !== generation.current) return;
      setDelivered(true);
      setMessage("");
      setScreenshots([]);
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    } catch (err) {
      if (current === generation.current) setError(feedbackError(err));
    } finally {
      if (current === generation.current) setSending(false);
    }
  }

  function close() {
    if (sending) return;
    setOpen(false);
    if (delivered) {
      setPath("");
      setKind(null);
      setCaptureError(null);
      setUploadError(null);
    }
  }

  return (
    <div data-feedback-ui>
      <IconButton
        className="feedback-launcher" variant="primary" label={capturing ? "Capturing page screenshot…" : "Send feedback"}
        disabled={capturing || Boolean(user && !availability.config && !availability.error)}
        onClick={() => void openComposer()} data-testid="feedback-open" aria-busy={capturing}
      ><Icon name="sparkle" /></IconButton>
      <Dialog open={open} onClose={close} heading={kind ? `Send ${LABELS[kind].toLowerCase()}` : "Send feedback"}
        className={kind ? "feedback-dialog" : "feedback-dialog feedback-choice"} data-feedback-ui data-testid="feedback-dialog">
        {!user ? (
          <Text data-testid="feedback-sign-in">Sign in to send feedback. No screenshot has been captured.</Text>
        ) : availability.error ? (
          <Stack><Text role="alert" tone="danger">{availability.error}</Text><Button onClick={() => { setOpen(false); availability.retry(); }}>Try again</Button></Stack>
        ) : !availability.config ? (
          <Text role="status">Checking feedback availability…</Text>
        ) : !availability.config.enabled ? (
          <Text data-testid="feedback-unavailable">Feedback is unavailable: this server has no delivery destination configured.</Text>
        ) : delivered ? (
          <Stack><Text role="status" data-testid="feedback-success">Thank you! Your feedback was delivered.</Text><Button onClick={close}>Done</Button></Stack>
        ) : !kind ? (
          <Stack>
            <Text size="sm" tone="muted">What would you like to share?</Text>
            <Inline>{(Object.keys(LABELS) as ComposerKind[]).map((value) => (
              <Button key={value} data-testid={`feedback-kind-${value}`} onClick={() => setKind(value)}>{LABELS[value]}</Button>
            ))}</Inline>
          </Stack>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <Stack>
              <TextArea label="Your feedback" value={message} onChange={(event) => setMessage(event.target.value)}
                required maxLength={FEEDBACK_LIMITS.messageLength} rows={5} disabled={sending} data-testid="feedback-message" />
              <Text size="sm" tone="muted" data-testid="feedback-privacy">
                Review before sending. A screenshot of the page before this menu opened is attached when capture succeeds.
                Form fields, API key settings, and feedback controls are excluded, but other visible personal information may remain.
                Remove any screenshot you do not want to share. Nothing is sent until you choose Send feedback.
              </Text>
              {captureError && <Text role="alert" tone="danger" data-testid="feedback-capture-error">{captureError}</Text>}
              <div className="feedback-screenshots">
                {screenshots.map((shot, index) => (
                  <div className="feedback-screenshot" key={shot.url} data-testid="feedback-screenshot" data-source={shot.automatic ? "automatic" : "upload"}>
                    <img src={shot.url} data-testid="feedback-screenshot-image" alt={shot.automatic ? "Automatic page screenshot" : `Uploaded screenshot: ${shot.file.name}`} />
                    <Text size="sm">{shot.automatic ? "Page screenshot" : shot.file.name}</Text>
                    <Button size="sm" disabled={sending} data-testid="feedback-remove-screenshot" aria-label={`Remove ${shot.automatic ? "page screenshot" : shot.file.name}`}
                      onClick={() => {
                        URL.revokeObjectURL(shot.url);
                        urls.current.delete(shot.url);
                        setScreenshots((previous) => previous.filter((_, position) => position !== index));
                        setUploadError(null);
                      }}>Remove</Button>
                  </div>
                ))}
              </div>
              <FileButton accept="image/png,image/jpeg,image/webp" multiple disabled={sending} icon={<Icon name="upload" />}
                data-testid="feedback-upload" onChange={(event) => { upload(event.target.files); event.target.value = ""; }}>Upload screenshot</FileButton>
              <Text size="sm" tone="muted">Up to 2 screenshots, 2 MiB each. PNG, JPEG, or WebP.</Text>
              {uploadError && <Text role="alert" tone="danger" data-testid="feedback-upload-error">{uploadError}</Text>}
              {error && <Text role="alert" tone="danger" data-testid="feedback-error">{error} Your draft has been kept.</Text>}
              <Inline>
                <Button type="submit" variant="primary" disabled={sending || !message.trim()} data-testid="feedback-submit">{sending ? "Sending…" : "Send feedback"}</Button>
                <Button disabled={sending} onClick={() => setKind(null)}>Change kind</Button>
              </Inline>
            </Stack>
          </form>
        )}
      </Dialog>
    </div>
  );
}
