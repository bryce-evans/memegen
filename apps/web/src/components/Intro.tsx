import { useState, type ReactNode } from "react";
import type { IntroKind } from "../intros.ts";
import { IntroParty } from "./IntroParty.tsx";
import { NYAN_IMAGE_COUNT, NyanFlyby } from "./Nyan.tsx";

/**
 * The sign-in page's intro (see `intros.ts`) around `children`, the sign-in card. Every kind renders the same stage:
 * `data-intro` names it, `data-ready` turns true once its images have loaded and it starts, and `data-done` once it
 * has played through.
 */
export function Intro({ kind, children }: { kind: IntroKind; children: ReactNode }) {
  switch (kind) {
    case "party":
      return <IntroParty>{children}</IntroParty>;
    case "nyan":
      return <IntroNyan>{children}</IntroNyan>;
    case "basic":
      return (
        <div className="intro-stage" data-testid="intro" data-intro="basic" data-ready={true} data-done={true}>
          {children}
        </div>
      );
  }
}

/**
 * The `nyan` intro: nyan cat flies in a straight line from the screen's bottom-right corner, behind the card, and out
 * of its top-left corner, its rainbow stretched across the screen behind it.
 */
function IntroNyan({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(0);
  const [done, setDone] = useState(false);
  const onLoad = () => setLoaded((n) => n + 1);
  return (
    <div className="intro-stage" data-testid="intro" data-intro="nyan" data-ready={loaded >= NYAN_IMAGE_COUNT} data-done={done}>
      <NyanFlyby onLoad={onLoad} onFlown={() => setDone(true)} />
      {children}
    </div>
  );
}
