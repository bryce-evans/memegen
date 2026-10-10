import { useSearchParams } from "react-router-dom";
import { GalleryFeed } from "../components/feed.tsx";

export function Popular() {
  return (
    <section>
      <GalleryFeed kind="popular" title="Popular" />
    </section>
  );
}

export function Recent() {
  return (
    <section>
      <GalleryFeed kind="recent" title="Recent" />
    </section>
  );
}

/** `/search?q=`: listed memes whose title, template name, tags, or author match `q`. */
export function Search() {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  return (
    <section data-testid="search-results" data-query={q}>
      <GalleryFeed kind="search" q={q} title={q ? `Search: ${q}` : "Search"} />
    </section>
  );
}
