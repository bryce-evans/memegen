import { useCallback, useState } from "react";
import { INTROS, type IntroKind } from "./intros.ts";
import { CONFIG_INTRO, DEV_MODE } from "./mode.ts";

/** Dev only: the intro picked in the sign-in page's dev tools, kept in this browser. Prod always plays `INTRO`. */
const STORAGE_KEY = "memegen.intro";

function storedIntro(): IntroKind | null {
  if (!DEV_MODE) return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return INTROS.find((kind) => kind === stored) ?? null;
  } catch {
    return null;
  }
}

/** The sign-in intro to play, and (dev) a setter that stores a preview choice over the config's. */
export function useIntroChoice(): { intro: IntroKind; setIntro: (intro: IntroKind) => void } {
  const [intro, set] = useState(() => storedIntro() ?? CONFIG_INTRO);
  const setIntro = useCallback((next: IntroKind) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (privacy mode); the choice then lasts for this page only.
    }
    set(next);
  }, []);
  return { intro, setIntro };
}
