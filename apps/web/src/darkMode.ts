import { useCallback, useEffect } from "react";
import { useSkin } from "@memegen/ui";

/** The user's dark mode choice, kept in this browser only (localStorage, per memegen user). Off unless set. */
const storageKey = (userId: string) => `memegen.darkMode.${userId}`;

function readDarkMode(userId: string): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) === "true";
  } catch {
    return false;
  }
}

/** Applies the signed-in user's stored choice to the skin; signed out, dark mode is off. Mount once, above the routes. */
export function useStoredDarkMode(userId: string | null): void {
  const { setDark } = useSkin();
  useEffect(() => {
    setDark(userId !== null && readDarkMode(userId));
  }, [userId, setDark]);
}

/** The setting: whether dark mode is on for `userId`, and a setter that stores the choice and applies it. */
export function useDarkModeSetting(userId: string): { on: boolean; set: (on: boolean) => void } {
  const { setDark, dark } = useSkin();
  const set = useCallback(
    (on: boolean) => {
      try {
        localStorage.setItem(storageKey(userId), String(on));
      } catch {
        // Storage can be unavailable (privacy mode); the choice then lasts for this page only.
      }
      setDark(on);
    },
    [userId, setDark],
  );
  return { on: dark, set };
}
