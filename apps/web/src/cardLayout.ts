import { useCallback, useState } from "react";
import { useSkin } from "@memegen/ui";

/**
 * How meme feed cards show their title, author, votes and actions: `below` the image (Google-style), or over it on
 * `hover` (a dark gradient for contrast; always shown on touch screens). Kept in this browser only (localStorage, per
 * memegen user). Defaults to `below` for Google and `hover` for other skins unless explicitly set.
 */
export const CARD_LAYOUTS = ["below", "hover"] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];

const storageKey = (userId: string) => `memegen.cardLayout.${userId}`;

function readCardLayout(userId: string): CardLayout | undefined {
  try {
    const stored = localStorage.getItem(storageKey(userId));
    return CARD_LAYOUTS.find((l) => l === stored);
  } catch {
    return undefined;
  }
}

/** The setting for `userId`, read when the component mounts, and a setter that stores it. */
export function useCardLayout(userId: string): { layout: CardLayout; set: (layout: CardLayout) => void } {
  const { skin } = useSkin();
  const [layout, setLayout] = useState(() => readCardLayout(userId));
  const set = useCallback(
    (next: CardLayout) => {
      try {
        localStorage.setItem(storageKey(userId), next);
      } catch {
        // Storage can be unavailable (privacy mode); the choice then lasts until this view unmounts.
      }
      setLayout(next);
    },
    [userId],
  );
  return { layout: layout ?? (skin === "google" ? "below" : "hover"), set };
}
