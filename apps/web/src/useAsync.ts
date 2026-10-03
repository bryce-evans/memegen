import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

export interface Async<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Local updates to the loaded value (e.g. a mutation returned its new version). */
  setData: Dispatch<SetStateAction<T | null>>;
}

interface Settled<T> {
  /** The key this result belongs to; null while a load is in flight. */
  key: string | null;
  data: T | null;
  error: unknown;
}

/**
 * Runs `load()` whenever `key` changes (`key` must name everything `load` depends on). A key change hides the
 * previous data and error at once, unless `keepStale` keeps showing the old data until the new result lands
 * (for refreshes, where blanking would make the screen jump). A result that arrives after the key moved on is
 * dropped either way.
 */
export function useAsync<T>(key: string, load: () => Promise<T>, { keepStale = false } = {}): Async<T> {
  const [state, setState] = useState<Settled<T>>({ key: null, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ key: null, data: keepStale ? s.data : null, error: null }));
    load().then(
      (data) => !cancelled && setState({ key, data, error: null }),
      (error: unknown) => !cancelled && setState({ key, data: null, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setData = useCallback<Dispatch<SetStateAction<T | null>>>(
    (next) => setState((s) => ({ ...s, data: next instanceof Function ? next(s.data) : next })),
    [],
  );

  // Right after a key change React commits once before the effect runs; that must not read as loaded.
  const settled = state.key === key;
  return {
    data: settled || keepStale ? state.data : null,
    error: settled ? state.error : null,
    loading: !settled,
    setData,
  };
}
