import { useState } from "react";
import { Link } from "react-router-dom";
import { PERIODS, type Period, type Template } from "@memegen/shared";
import { Inline, Panel, SelectField, Text } from "@memegen/ui";
import { addTemplateTags, getTemplateUsage } from "../api.ts";
import { plural } from "../format.ts";
import { useAsync } from "../useAsync.ts";
import { ErrorView, MediaView } from "./common.tsx";
import { PERIOD_LABELS } from "./feed.tsx";
import { TagEditor } from "./tagInputs.tsx";
import { TagChips } from "./tags.tsx";
import { TemplateMeta } from "./templates.tsx";

/** Under the editor stage when a template is open: its tags (anyone can add), usage, and variations. */
export function TemplateDetails({ template }: { template: Template }) {
  // Base tags come from the author and always stay; added tags sit beside them.
  const [tagged, setTagged] = useState({ tags: template.tags, baseTags: template.baseTags });

  return (
    <Panel heading={template.name} className="template-details" data-testid="template-details">
      <TemplateMeta template={template} />
      <div className="template-details-tags">
        <TagChips slugs={tagged.tags} base={tagged.baseTags} />
        <TagEditor
          tags={[]}
          label="Add tags"
          testId="template-tags-add"
          onSave={async (added) => {
            const next = await addTemplateTags(template.id, added);
            setTagged({ tags: next.tags, baseTags: next.baseTags });
          }}
        />
      </div>
      <Panel variant="inset" heading="Usage">
        <UsageChart templateId={template.id} />
      </Panel>
      {template.variations.length > 0 && (
        <Panel variant="inset" heading="Variations">
          <div className="variations">
            {template.variations.map((v) => (
              <Link
                key={v.id}
                to={`/create?template=${v.id}`}
                className="variation"
                title={`Use “${v.name}”`}
                data-testid="variation-item"
                data-template-id={v.id}
              >
                <MediaView asset={v.asset} alt={v.name} />
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </Panel>
  );
}

const CHART_WIDTH = 220;
const CHART_HEIGHT = 48;

/** Inline SVG sparkline of template uses over the period. */
function UsageChart({ templateId }: { templateId: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const { data: usage, error } = useAsync(`${templateId}:${period}`, () => getTemplateUsage(templateId, period));

  const points = usage?.points ?? [];
  const max = Math.max(1, ...points.map((p) => p.uses));
  const step = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0;
  const line = points
    .map((p, i) => `${(i * step).toFixed(1)},${(CHART_HEIGHT - 2 - (p.uses / max) * (CHART_HEIGHT - 4)).toFixed(1)}`)
    .join(" ");
  const total = points.reduce((sum, p) => sum + p.uses, 0);

  return (
    <div className="usage">
      <Inline>
        <SelectField size="sm" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Usage period">
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </SelectField>
        {usage && (
          <Text as="span" size="sm" tone="muted">
            {plural(total, "use")} · per {usage.bucket}
          </Text>
        )}
      </Inline>
      {error !== null && <ErrorView error={error} />}
      {usage && (
        <svg
          className="sparkline"
          data-testid="usage-chart"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          width="100%"
          height={CHART_HEIGHT}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${plural(total, "use")}, peak ${max} per ${usage.bucket}`}
        >
          {points.length > 1 ? (
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ) : (
            <circle cx={CHART_WIDTH / 2} cy={CHART_HEIGHT / 2} r={3} fill="currentColor" />
          )}
        </svg>
      )}
    </div>
  );
}
