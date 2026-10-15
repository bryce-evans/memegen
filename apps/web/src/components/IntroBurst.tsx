import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import catMeme from "../assets/intro/cat-meme.png";
import cheers from "../assets/intro/cheers.png";
import datBoi from "../assets/intro/dat-boi.png";
import doge from "../assets/intro/doge.png";
import nyanCat from "../assets/intro/nyan-cat.png";
import pepe from "../assets/intro/pepe.png";
import pooh from "../assets/intro/pooh.png";
import soyjack1 from "../assets/intro/soyjack1.png";
import soyjack2 from "../assets/intro/soyjack2.png";

/**
 * Where a scattered sprite lands: its center `x`/`y` right of and below the viewport center, and its width `size`,
 * all in vmin; `spin` its resting tilt. Each one grows out of nothing at the center, behind the card.
 */
interface Landing {
  x: number;
  y: number;
  size: number;
  spin: number;
}

/** Around the card, clear of nyan cat's flight (up and left) and dat boi (top right). */
const SCATTERED: (Landing & { name: string; src: string })[] = [
  { name: "doge", src: doge, x: -34, y: 30, size: 19, spin: 4 },
  { name: "pepe", src: pepe, x: -18, y: -31, size: 15, spin: -6 },
  { name: "cat-meme", src: catMeme, x: 44, y: -6, size: 16, spin: 5 },
  { name: "cheers", src: cheers, x: -42, y: 7, size: 13, spin: -4 },
  { name: "pooh", src: pooh, x: 3, y: 31, size: 34, spin: 4 },
];

/**
 * Two soyjaks, one pointing at the other: separate images flying as one sprite, side by side with bottoms aligned.
 * Each part's `share` is its width as a fraction of the group (from the classic meme's 882 px frame: 458 px left,
 * 374 px right); `dx`/`dy` nudge it from that layout in % of the group's width, so nudges scale with `size`; `scale`
 * and `rotate` (degrees) adjust it about its center.
 */
interface Part {
  name: string;
  src: string;
  share: number;
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
}
const SOYJAKS: Landing & { parts: Part[] } = {
  x: 36,
  y: 25,
  size: 38,
  spin: 2,
  parts: [
    { name: "soyjack1", src: soyjack1, share: 458 / 882, dx: 16, dy: 17, scale: 0.8, rotate: 2 },
    { name: "soyjack2", src: soyjack2, share: 374 / 882, dx: 0, dy: 0, scale: 1, rotate: -2 },
  ],
};

function partStyle({ share, dx, dy, scale, rotate }: Part): CSSProperties {
  return {
    width: `${share * 100}%`,
    "--dx": `${dx}cqw`,
    "--dy": `${dy}cqw`,
    "--scale": scale,
    "--rotate": `${rotate}deg`,
  } as CSSProperties;
}

/** Every image, dat boi and nyan cat included; the burst starts once all have loaded (or failed), so none pops in mid-flight. */
const IMAGE_COUNT = SCATTERED.length + SOYJAKS.parts.length + 2;

function landingStyle({ x, y, size, spin }: Landing): CSSProperties {
  return {
    "--x": `${x}vmin`,
    "--y": `${y}vmin`,
    "--size": `${size}vmin`,
    "--spin": `${spin}deg`,
  } as CSSProperties;
}

/** Nyan cat flies up and to the left, this many degrees above horizontal. */
const NYAN_ANGLE_DEG = 20;
/** The image's height per unit of width: the cat on top, then its rainbow (242 × 1689 px). */
const NYAN_ASPECT = 1689 / 242;
/** The cat itself (head to feet) per unit of width: always shown whole, however little rainbow fits. */
const NYAN_CAT_ASPECT = 420 / 242;
/** Gap kept between the cat and the screen edge, in px. */
const NYAN_MARGIN = 8;

/**
 * How much of nyan cat to show, in px along its flight, from where it leaves the card (`pin`, viewport px) to the cat:
 * the whole image when it fits, else only as much rainbow as keeps the cat (a `width`-wide strip) clear of the left and
 * top edges. The cat leads, so a shorter flight trims the rainbow, never the cat.
 */
function nyanLength(pin: { x: number; y: number }, width: number): number {
  const angle = (NYAN_ANGLE_DEG * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The far corners are `length` along (-cos, -sin) from the pin, ± half the width across it.
  const toLeft = (pin.x - NYAN_MARGIN - (width / 2) * sin) / cos;
  const toTop = (pin.y - NYAN_MARGIN - (width / 2) * cos) / sin;
  return Math.max(width * NYAN_CAT_ASPECT, Math.min(width * NYAN_ASPECT, toLeft, toTop));
}

/**
 * Sign-in intro around `children` (the sign-in card), all at once: memes explode out of the center from behind the
 * card and settle around the page, dat boi pops up behind its top-right corner, and nyan cat shoots out of its
 * top-left corner.
 */
export function IntroBurst({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(0);
  const [done, setDone] = useState(false);
  const onLoad = () => setLoaded((n) => n + 1);
  const ready = loaded >= IMAGE_COUNT;
  const nyan = useRef<HTMLDivElement>(null);

  // Size nyan cat's flight before the first paint, and again whenever the window or the card moves its pin.
  useLayoutEffect(() => {
    const box = nyan.current;
    const stage = box?.parentElement;
    if (!box || !stage) return;
    const fit = () => {
      // Unrotated layout: the box is centered on `left` (translate -50%) with its bottom fixed, so its pin (the
      // rotation origin, bottom center) is offsetLeft across and offsetTop + offsetHeight down from the stage.
      const rect = stage.getBoundingClientRect();
      const pin = { x: rect.left + box.offsetLeft, y: rect.top + box.offsetTop + box.offsetHeight };
      box.style.setProperty("--nyan-length", `${nyanLength(pin, box.offsetWidth)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div className="intro-stage" data-testid="intro-burst" data-ready={ready} data-done={done}>
      <div className="intro-scatter" aria-hidden="true">
        {SCATTERED.map((s) => (
          <img
            key={s.name}
            className="intro-sprite"
            data-testid="intro-image"
            data-sprite={s.name}
            src={s.src}
            alt=""
            style={landingStyle(s)}
            onLoad={onLoad}
            onError={onLoad}
          />
        ))}
        <div className="intro-sprite intro-group" data-sprite="soyjaks" style={landingStyle(SOYJAKS)}>
          {SOYJAKS.parts.map((p) => (
            <img
              key={p.name}
              data-testid="intro-image"
              data-sprite={p.name}
              src={p.src}
              alt=""
              style={partStyle(p)}
              onLoad={onLoad}
              onError={onLoad}
            />
          ))}
        </div>
      </div>
      <div className="intro-dat-boi" aria-hidden="true">
        <img src={datBoi} alt="" data-testid="intro-image" data-sprite="dat-boi" onLoad={onLoad} onError={onLoad} />
      </div>
      <div ref={nyan} className="intro-nyan" aria-hidden="true" data-testid="intro-nyan" style={{ "--nyan-angle": `${NYAN_ANGLE_DEG}deg` } as CSSProperties}>
        <img
          src={nyanCat}
          alt=""
          data-testid="intro-image"
          data-sprite="nyan-cat"
          onLoad={onLoad}
          onError={onLoad}
          onAnimationEnd={() => setDone(true)}
        />
      </div>
      {children}
    </div>
  );
}
