import { Link } from "react-router-dom";
import { Icon, LinkButton } from "@memegen/ui";
import type { FeedbackTarget } from "@memegen/shared";

export function ReportButton({ kind, id }: FeedbackTarget) {
  return (
    <LinkButton as={Link} to={`/report/${kind}/${encodeURIComponent(id)}`} variant="quiet" size="sm"
      className="report-button" aria-label={`Report ${kind}`} title={`Report ${kind}`} data-testid="report-button">
      <Icon name="flag" />
    </LinkButton>
  );
}
