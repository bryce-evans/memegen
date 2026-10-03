/** Built-in skins, in switcher order. React-free so tooling (e.g. the e2e suite) can import it. */
export const SKIN_IDS = ["default", "apple", "matte", "google", "studio", "spectrum"] as const;
export type BuiltinSkinId = (typeof SKIN_IDS)[number];
