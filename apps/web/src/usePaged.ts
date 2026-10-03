import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "@memegen/shared";

export interface Paged<T extends { id: string }> {
  items: T[];
  setItems: (update: (items: T[]) => T[]) => void;
  /** Swap in a newer version of a listed item (matched by id). */
  replace: (item: T) => void;
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/** Offset-paginated list; `key` changes reset it (e.g. new filters). */
export function usePaged<T extends { id: string }>(key: string, load: (offset: number) => Promise<Page<T>>): Paged<T> {
  const [items, setItemsState] = useState<T[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloads, setReloads] = useState(0);
  // The key whose first page has settled. Until it matches `key`, the list is stale: right after a key change
  // React commits once with the old items before the reset effect runs, and that must not read as loaded.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fetchPage = useCallback(async (offset: number, gen: number, forKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await loadRef.current(offset);
      if (gen !== generation.current) return;
      setItemsState((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
      setNextOffset(page.nextOffset);
    } catch (err) {
      if (gen === generation.current) setError(err);
    } finally {
      if (gen === generation.current) {
        setLoading(false);
        setSettledKey(forKey);
      }
    }
  }, []);

  useEffect(() => {
    const gen = ++generation.current;
    setItemsState([]);
    setNextOffset(null);
    void fetchPage(0, gen, key);
  }, [key, reloads, fetchPage]);

  const current = settledKey === key;
  return {
    items: current ? items : [],
    setItems: setItemsState,
    replace: (item) => setItemsState((prev) => prev.map((x) => (x.id === item.id ? item : x))),
    loading: loading || !current,
    error,
    hasMore: current && nextOffset !== null,
    loadMore: () => {
      if (current && nextOffset !== null && !loading) void fetchPage(nextOffset, generation.current, key);
    },
    reload: () => setReloads((n) => n + 1),
  };
}
