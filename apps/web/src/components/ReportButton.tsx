import { useState } from "react";
import { Icon, IconButton } from "@memegen/ui";
import type { FeedbackTarget } from "@memegen/shared";
import { useAuth } from "../auth.tsx";
import { ReportDialog } from "./ReportDialog.tsx";

export function ReportButton({ kind, id }: FeedbackTarget) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const label = kind === "meme" ? "Flag post" : "Flag template";
  return (
    <>
      <IconButton variant="quiet" size="sm" label={label} title={label} data-testid="report-button"
        aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="flag" />
      </IconButton>
      <ReportDialog key={`${kind}:${id}:${user?.id ?? ""}`} target={{ kind, id }} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
