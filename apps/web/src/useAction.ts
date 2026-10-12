import { useCallback, useEffect, useRef, useState } from "react";

export interface Action {
  busy: boolean;
  error: unknown;
  setError: (error: unknown) => void;
  /**
   * Runs `fn` with `busy` set and the error cleared; a throw lands in `error` and resolves to `undefined`. `signal`
   * aborts on `cancel()` or unmount, and whatever a canceled run throws is not an error.
   */
  run: <T>(fn: (signal: AbortSignal) => Promise<T>) => Promise<T | undefined>;
  /** Abort the run in flight, if any. */
  cancel: () => void;
}

/** Busy/error state for a user-triggered mutation (a button or form submit). */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const current = useRef<AbortController | null>(null);
  // Actions often end by navigating or removing their own component; leaving aborts the run in flight, and state is
  // never touched after unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.current?.abort();
    };
  }, []);

  const run = useCallback(async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const ac = new AbortController();
    current.current = ac;
    setBusy(true);
    setError(null);
    try {
      return await fn(ac.signal);
    } catch (err) {
      if (mounted.current && !ac.signal.aborted) setError(err);
      return undefined;
    } finally {
      if (current.current === ac) current.current = null;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => current.current?.abort(), []);

  return { busy, error, setError, run, cancel };
}
