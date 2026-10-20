import { useEffect, useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";
import nyanCat from "../assets/intro/nyan-cat.png";
import nyanRainbow from "../assets/intro/nyan-rainbow.png";

/**
 * Nyan cat is two images, so its rainbow can run any length and stay put while the cat flies on: the cat alone
 * (242 × 426 px), and a rainbow tile (242 × 215 px, one wave) repeated behind it. Each strip reports both to `onLoad`.
 */
export const NYAN_IMAGE_COUNT = 2;
/** The cat (head to feet) per unit of width: always shown whole, however little rainbow fits. */
const NYAN_CAT_ASPECT = 426 / 242;
/** The longest flight past the card per unit of width: the cat and about five waves of rainbow. */
const NYAN_OUT_ASPECT = 1689 / 242;
/** `party`'s flight leaves the card's top-left corner up and to the left, this many degrees above horizontal. */
const NYAN_CORNER_ANGLE = (20 * Math.PI) / 180;
/** `nyan`'s flight crosses the screen up and to the left, this many degrees above horizontal. */
const NYAN_FLYBY_ANGLE = (20 * Math.PI) / 180;
/** Gap kept between the cat and the screen edge, in px. */
const NYAN_MARGIN = 8;

interface StripProps {
  stripRef: RefObject<HTMLDivElement | null>;
  className: string;
  testId: string;
  style?: CSSProperties;
  onLoad: () => void;
  /** When the flight ends. */
  onFlown?: () => void;
}

/**
 * A rotated strip (sized and placed by its class and `--nyan-length`) that nyan cat flies through from its base to its
 * far end. The rainbow is fixed to the strip and revealed behind the cat as it goes, so the cat moves and leaves the
 * rainbow where it was laid down. A strip shorter than the cat shows the cat whole and no rainbow.
 */
function NyanStrip({ stripRef, className, testId, style, onLoad, onFlown }: StripProps) {
  // The rainbow is a CSS background, which has no load event: load it once here so the intro waits for it too.
  useEffect(() => {
    const tile = new Image();
    tile.onload = tile.onerror = onLoad;
    tile.src = nyanRainbow;
    // `onLoad` only counts loads; the first one is enough.
  }, []);
  return (
    <div ref={stripRef} className={`intro-nyan ${className}`} aria-hidden="true" data-testid={testId} style={style}>
      <div className="intro-nyan-trail" style={{ backgroundImage: `url(${nyanRainbow})` }} />
      <img
        className="intro-nyan-cat"
        src={nyanCat}
        alt=""
        data-testid="intro-image"
        data-sprite="nyan-cat"
        onLoad={onLoad}
        onError={onLoad}
        onAnimationEnd={onFlown}
      />
    </div>
  );
}

/** Calls `fit` before the first paint, and again whenever the window or the intro stage around the card resizes. */
function useFit(strip: RefObject<HTMLDivElement | null>, fit: (box: HTMLDivElement, stage: HTMLElement) => void): void {
  useLayoutEffect(() => {
    const box = strip.current;
    const stage = box?.closest<HTMLElement>(".intro-stage");
    if (!box || !stage) return;
    const refit = () => fit(box, stage);
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(stage);
    window.addEventListener("resize", refit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", refit);
    };
    // `fit` is a pure layout rule; refitting on resize is all it needs.
  }, []);
}

/**
 * How far nyan cat flies on from where it leaves the card's top-left corner (`pin`, viewport px), up and to the left
 * at `angle` (radians above horizontal): the cat and its longest rainbow when they fit, else only as much rainbow as
 * keeps the cat (a `width`-wide strip) clear of the left and top edges. The cat leads, so a shorter flight trims the
 * rainbow, never the cat.
 */
function outLength(pin: { x: number; y: number }, angle: number, width: number): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The far corners are `length` along (-cos, -sin) from the pin, ± half the width across it.
  const toLeft = (pin.x - NYAN_MARGIN - (width / 2) * sin) / cos;
  const toTop = (pin.y - NYAN_MARGIN - (width / 2) * cos) / sin;
  return Math.max(width * NYAN_CAT_ASPECT, Math.min(width * NYAN_OUT_ASPECT, toLeft, toTop));
}

/** `party`: nyan cat shoots out of the card's top-left corner, up and to the left, its rainbow trailing back into the card. */
export function NyanCorner({ onLoad, onFlown }: { onLoad: () => void; onFlown: () => void }) {
  const strip = useRef<HTMLDivElement>(null);
  useFit(strip, (box, stage) => {
    // Unrotated layout: the box is centered on `left` (translate -50%) with its bottom fixed, so its pin (the
    // rotation origin, bottom center) is offsetLeft across and offsetTop + offsetHeight down from the stage.
    const rect = stage.getBoundingClientRect();
    const pin = { x: rect.left + box.offsetLeft, y: rect.top + box.offsetTop + box.offsetHeight };
    box.style.setProperty("--nyan-length", `${outLength(pin, NYAN_CORNER_ANGLE, box.offsetWidth)}px`);
  });
  return (
    <NyanStrip
      stripRef={strip}
      className="intro-nyan-corner"
      testId="intro-nyan"
      style={{ "--nyan-angle": `${NYAN_CORNER_ANGLE}rad` } as CSSProperties}
      onLoad={onLoad}
      onFlown={onFlown}
    />
  );
}

/**
 * `nyan`: nyan cat flies in a straight line at `NYAN_FLYBY_ANGLE`, from wherever that line through the card's (the
 * stage's last child) top-left corner enters the screen on its bottom or right edge, behind the card, and out of
 * the corner, coming to rest up and to the left of it as in `party`. Behind the card it vanishes: the flight is
 * clipped to everything outside the card's rounded rectangle, so a translucent card never shows it through.
 */
export function NyanFlyby({ onLoad, onFlown }: { onLoad: () => void; onFlown: () => void }) {
  const sky = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useFit(strip, (box, stage) => {
    const card = stage.lastElementChild as HTMLElement;
    const rect = card.getBoundingClientRect();
    // The card's corner radius in viewport px (the card is zoomed; its computed radius isn't).
    const r = parseFloat(getComputedStyle(card).borderTopLeftRadius) * (rect.width / card.offsetWidth) || 0;
    // Out through the middle of the rounded top-left corner, not the empty point past it.
    const inset = r * (1 - Math.SQRT1_2);
    const corner = { x: rect.left + inset, y: rect.top + inset };
    const cos = Math.cos(NYAN_FLYBY_ANGLE);
    const sin = Math.sin(NYAN_FLYBY_ANGLE);
    // Back from the corner, down and to the right, to the first screen edge it meets, plus a strip's width so the
    // rainbow's tail starts off screen.
    const width = box.offsetWidth;
    const back = Math.max(0, Math.min((window.innerWidth - corner.x) / cos, (window.innerHeight - corner.y) / sin)) + width;
    box.style.setProperty("--nyan-x", `${corner.x + back * cos}px`);
    box.style.setProperty("--nyan-y", `${corner.y + back * sin}px`);
    box.style.setProperty("--nyan-length", `${back + outLength(corner, NYAN_FLYBY_ANGLE, width)}px`);
    box.style.setProperty("--nyan-angle", `${NYAN_FLYBY_ANGLE}rad`);
    const { left: x, top: y, right, bottom } = rect;
    sky.current!.style.clipPath =
      `path(evenodd, "M0 0 H${window.innerWidth} V${window.innerHeight} H0 Z ` +
      `M${x + r} ${y} H${right - r} A${r} ${r} 0 0 1 ${right} ${y + r} V${bottom - r} A${r} ${r} 0 0 1 ${right - r} ${bottom} ` +
      `H${x + r} A${r} ${r} 0 0 1 ${x} ${bottom - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z")`;
  });
  return (
    <div ref={sky} className="intro-nyan-sky">
      <NyanStrip stripRef={strip} className="intro-nyan-flyby" testId="intro-nyan-flyby" onLoad={onLoad} onFlown={onFlown} />
    </div>
  );
}
