import type { IntroKind } from "./intros.ts";

declare const __MEMEGEN_MODE__: "dev" | "prod";
declare const __MEMEGEN_INTRO__: IntroKind;

/**
 * The config's `MODE`, baked in by Vite (`vite.config.ts`). Dev: username login and a skin switcher on the
 * sign-in page. Prod: an SSO placeholder and the locked `default` skin.
 */
export const DEV_MODE = __MEMEGEN_MODE__ === "dev";

/** The config's `INTRO` (default `basic`), baked in by Vite; the sign-in page's dev tools can preview the others. */
export const CONFIG_INTRO = __MEMEGEN_INTRO__;
