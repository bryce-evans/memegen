import type { IntroKind } from "./intros.ts";

declare const __MEMEGEN_MODE__: "dev" | "prod";
declare const __MEMEGEN_INTRO__: IntroKind;

/**
 * The config's `MODE`, baked in by Vite (`vite.config.ts`). Dev enables sign-in page tools;
 * prod locks the `default` skin. Authentication is selected by the server at runtime.
 */
export const DEV_MODE = __MEMEGEN_MODE__ === "dev";

/** The config's `INTRO` (default `basic`), baked in by Vite; the sign-in page's dev tools can preview the others. */
export const CONFIG_INTRO = __MEMEGEN_INTRO__;
