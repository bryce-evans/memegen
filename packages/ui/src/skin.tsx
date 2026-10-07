import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ElementType,
  type ReactNode,
} from "react";
import type { LoosePolymorphicProps, Polymorphic } from "./cx.ts";
import type { ComponentOverrides } from "./overrides.ts";
import type { BuiltinSkinId } from "./skin-ids.ts";

export { SKIN_IDS, type BuiltinSkinId } from "./skin-ids.ts";

/**
 * Augment to add skin ids beyond the built-ins:
 * `declare module "@memegen/ui" { interface CustomSkinIds { brand: true } }`.
 */
export interface CustomSkinIds {}
export type SkinId = BuiltinSkinId | Extract<keyof CustomSkinIds, string>;

/** Structural hints a skin gives the app; the app decides what each placement means. */
export interface SkinLayout {
  /** Where page-level view controls (sort, period) live: the sidebar, or the page header beside the title. */
  filters: "sidebar" | "header";
}

export interface Skin {
  id: SkinId;
  label: string;
  /** Replacement implementations; each receives exactly the props of the component it replaces. */
  components?: Partial<ComponentOverrides>;
  layout?: Partial<SkinLayout>;
  /**
   * Classes added to `<html>` while the skin is active, for design-system CSS that scopes its tokens to classes
   * (e.g. Spectrum's `spectrum spectrum--dark spectrum--medium`).
   */
  rootClassName?: string;
}

export const DEFAULT_LAYOUT: SkinLayout = { filters: "sidebar" };

/** `localStorage` key holding the chosen skin id. */
export const SKIN_STORAGE_KEY = "memegen.skin";
const SKIN_PARAM = "skin";

const registry = new Map<SkinId, Skin>();
let snapshot: readonly Skin[] = [];
const listeners = new Set<() => void>();

/** Adds a skin, or replaces the definition of an already registered id (e.g. to give a built-in overrides). */
export function registerSkin(skin: Skin): void {
  registry.set(skin.id, skin);
  snapshot = [...registry.values()];
  for (const listener of listeners) listener();
}

/** The registered definition for `id`, e.g. to extend a built-in: `registerSkin({ ...getSkin("matte")!, components })`. */
export function getSkin(id: SkinId): Skin | undefined {
  return registry.get(id);
}

for (const skin of [
  { id: "default", label: "Default" },
  { id: "apple", label: "Apple", layout: { filters: "header" } },
  { id: "matte", label: "Matte" },
  { id: "google", label: "Google", layout: { filters: "header" } },
  { id: "studio", label: "Studio", layout: { filters: "header" } },
  {
    id: "spectrum",
    label: "Spectrum",
    layout: { filters: "header" },
    rootClassName: "spectrum spectrum--dark spectrum--medium",
  },
  {
    id: "painted",
    label: "Painted",
    layout: { filters: "header" },
    rootClassName: "spectrum spectrum--light spectrum--medium",
  },
] satisfies Skin[]) {
  registerSkin(skin);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

function readStorage(): string | null {
  try {
    return localStorage.getItem(SKIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(id: SkinId): void {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable (privacy mode); the choice then lasts for the session only.
  }
}

const isRegistered = (id: string | null): id is SkinId => id !== null && registry.has(id as SkinId);

/** `?skin=` wins, then the stored choice, then `fallback`. */
function initialSkin(fallback: SkinId): SkinId {
  const fromUrl = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(SKIN_PARAM);
  if (isRegistered(fromUrl)) return fromUrl;
  const stored = readStorage();
  return isRegistered(stored) ? stored : fallback;
}

export interface SkinContextValue {
  /** Active skin id (also set as `data-skin` on `<html>`). */
  skin: SkinId;
  setSkin: (id: SkinId) => void;
  /** Every registered skin, in registration order. */
  skins: readonly Skin[];
  /** The active skin's definition. */
  definition: Skin;
  /** The active skin's layout hints, with defaults filled in. */
  layout: SkinLayout;
}

const SkinContext = createContext<SkinContextValue | null>(null);

/**
 * `locked` pins the skin: `?skin=` and the stored choice are ignored, nothing is persisted, and `setSkin` does
 * nothing. Without it the skin comes from `?skin=`, then storage, then `fallback`.
 */
export function SkinProvider({
  children,
  fallback = "default",
  locked,
}: {
  children: ReactNode;
  fallback?: SkinId;
  locked?: SkinId;
}) {
  const skins = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [skin, setSkinState] = useState<SkinId>(() => locked ?? initialSkin(fallback));

  const rootClassName = skins.find((s) => s.id === skin)?.rootClassName;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = skin;
    const classes = rootClassName?.split(/\s+/).filter(Boolean) ?? [];
    root.classList.add(...classes);
    return () => root.classList.remove(...classes);
  }, [skin, rootClassName]);

  // Persist the initial pick too, so a `?skin=` link sticks after navigating away from it.
  useEffect(() => {
    if (!locked) writeStorage(skin);
  }, [skin, locked]);

  const setSkin = useCallback(
    (id: SkinId) => {
      if (locked) return;
      setSkinState(id);
      // Keep a `?skin=` in the address bar in sync, or a reload would switch back.
      const url = new URL(window.location.href);
      if (url.searchParams.has(SKIN_PARAM)) {
        url.searchParams.set(SKIN_PARAM, id);
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [locked],
  );

  const value = useMemo<SkinContextValue>(() => {
    const definition = skins.find((s) => s.id === skin) ?? { id: skin, label: skin };
    return { skin, setSkin, skins, definition, layout: { ...DEFAULT_LAYOUT, ...definition.layout } };
  }, [skin, setSkin, skins]);

  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

export function useSkin(): SkinContextValue {
  const value = useContext(SkinContext);
  if (!value) throw new Error("useSkin() must be used inside <SkinProvider>");
  return value;
}

/**
 * Wraps a default implementation so the active skin can replace it. Outside a `SkinProvider` the default renders.
 * Every exported component goes through this, so `Skin.components` can swap any of them.
 */
export function skinnable<K extends keyof ComponentOverrides>(name: K, base: ComponentOverrides[K]): ComponentOverrides[K] {
  const Base = base as ComponentType<object>;
  function Skinned(props: object) {
    const override = useContext(SkinContext)?.definition.components?.[name] as ComponentType<object> | undefined;
    const Impl = override ?? Base;
    return <Impl {...props} />;
  }
  Skinned.displayName = name;
  return Skinned as unknown as ComponentOverrides[K];
}

/**
 * `skinnable` for a component with an `as` prop: typed at call sites by what `as` accepts, rendering `D` by default.
 * `Own` is the component's own props (the override receives `LoosePolymorphicProps<Own>`).
 */
export function skinnablePolymorphic<D extends ElementType, Own>(
  name: keyof ComponentOverrides,
  base: ComponentType<LoosePolymorphicProps<Own>>,
): Polymorphic<D, Own> {
  return skinnable(name, base as ComponentOverrides[typeof name]) as unknown as Polymorphic<D, Own>;
}
