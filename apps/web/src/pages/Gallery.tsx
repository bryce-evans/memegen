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
