import type { ComponentPropsWithRef, ElementType, ReactNode } from "react";

/** Joins truthy class names; `undefined` when empty so no `class=""` is rendered. */
export function cx(...parts: (string | false | null | undefined)[]): string | undefined {
  const joined = parts.filter(Boolean).join(" ");
  return joined || undefined;
}

/** Props of a component rendered as `as` (e.g. react-router's `Link`), plus its own props. */
export type PolymorphicProps<C extends ElementType, Own> = Own & { as?: C } & Omit<ComponentPropsWithRef<C>, keyof Own | "as">;

/** What a skin override for a polymorphic component receives: its own props plus whatever `as` accepts. */
export type LoosePolymorphicProps<Own> = Own & { as?: ElementType; className?: string; children?: ReactNode } & {
  [prop: string]: unknown;
};

export type ControlSize = "sm" | "md";
