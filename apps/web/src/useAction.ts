import { useCallback, useEffect, useRef, useState } from "react";

export interface Action {
  busy: boolean;
  error: unknown;
  setError: (error: unknown) => void;
  /** Runs `fn` with `busy` set and the error cleared; a throw lands in `error` and resolves to `undefined`. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

/** Busy/error state for a user-triggered mutation (a button or form submit). */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Actions often end by navigating or removing their own component; don't touch state after unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      if (mounted.current) setError(err);
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}
