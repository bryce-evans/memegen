import { Link } from "react-router-dom";
import { Chip, ChipGroup } from "@memegen/ui";

/** Tag links; slugs in `base` (a template's author-set tags) are marked `data-base="true"`. */
export function TagChips({ slugs, base = [] }: { slugs: readonly string[]; base?: readonly string[] }) {
  if (slugs.length === 0) return null;
  return (
    <ChipGroup>
      {slugs.map((slug) => (
        <Chip
          key={slug}
          as={Link}
          to={`/t/${slug}`}
          className={base.includes(slug) ? "tag-chip-base" : undefined}
          title={base.includes(slug) ? "Set by the template's author" : undefined}
          data-testid="tag-chip"
          data-tag={slug}
          data-base={base.includes(slug) ? "true" : undefined}
        >
          #{slug}
        </Chip>
      ))}
    </ChipGroup>
  );
}
