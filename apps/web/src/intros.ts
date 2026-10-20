/**
 * The sign-in page's intro animations, chosen by the config's `INTRO` (baked in by `vite.config.ts`, which rejects
 * anything else): `basic`, the card alone; `party`, memes, confetti, and streamers exploding out from behind the card
 * as dat boi and nyan cat pop out of its top corners; `nyan`, nyan cat flying in a straight line from the bottom
 * right of the screen, behind the card, and out of its top-left corner, leaving its rainbow behind.
 */
export const INTROS = ["basic", "party", "nyan"] as const;
export type IntroKind = (typeof INTROS)[number];
export const DEFAULT_INTRO: IntroKind = "basic";
