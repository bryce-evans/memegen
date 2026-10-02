import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "@memegen/shared";

export interface Paged<T> {
  items: T[];
  setItems: (update: (items: T[]) => T[]) => void;
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/** Offset-paginated list; `key` changes reset it (e.g. new filters). */
export function usePaged<T>(key: string, load: (offset: number) => Promise<Page<T>>): Paged<T> {
  const [items, setItemsState] = useState<T[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloads, setReloads] = useState(0);
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fetchPage = useCallback(async (offset: number, gen: number) => {
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
      if (gen === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const gen = ++generation.current;
    setItemsState([]);
    setNextOffset(null);
    void fetchPage(0, gen);
  }, [key, reloads, fetchPage]);

  return {
    items,
    setItems: setItemsState,
    loading,
    error,
    hasMore: nextOffset !== null,
    loadMore: () => {
      if (nextOffset !== null && !loading) void fetchPage(nextOffset, generation.current);
    },
    reload: () => setReloads((n) => n + 1),
  };
}
