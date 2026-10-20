import { useState, type CSSProperties, type ReactNode } from "react";
import butterfly from "../assets/intro/butterfly.png";
import catMeme from "../assets/intro/cat-meme.png";
import chad from "../assets/intro/chad.png";
import coffeeMug from "../assets/intro/coffee-mug.png";
import cheers from "../assets/intro/cheers.png";
import confettiCircle from "../assets/intro/confetti-circle.svg";
import confettiRect from "../assets/intro/confetti-rect.svg";
import confettiSquiggle from "../assets/intro/confetti-squiggle.svg";
import confettiStar from "../assets/intro/confetti-star.svg";
import confettiTriangle from "../assets/intro/confetti-triangle.svg";
import datBoi from "../assets/intro/dat-boi.png";
import doge from "../assets/intro/doge.png";
import pepe from "../assets/intro/pepe.png";
import pooh from "../assets/intro/pooh.png";
import soyjack1 from "../assets/intro/soyjack1.png";
import soyjack2 from "../assets/intro/soyjack2.png";
import streamerCurl from "../assets/intro/streamer-curl.svg";
import streamerWave from "../assets/intro/streamer-wave.svg";
import thisIsFine from "../assets/intro/this-is-fine.png";
import thisIsFineFire from "../assets/intro/this-is-fine-fire.png";
import { NYAN_IMAGE_COUNT, NyanCorner } from "./Nyan.tsx";

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
  { name: "cheers", src: cheers, x: -45, y: 3, size: 13, spin: -4 },
  { name: "pooh", src: pooh, x: 3, y: 31, size: 34, spin: 4 },
  { name: "chad", src: chad, x: 61, y: -21, size: 24, spin: -6 },
  { name: "butterfly", src: butterfly, x: -41, y: -38, size: 11, spin: -8 },
  { name: "coffee-mug", src: coffeeMug, x: 72, y: 21, size: 18, spin: 3 },
];

/**
 * Separate images flying as one sprite, side by side with bottoms aligned, later parts painted over earlier ones.
 * Each part's `share` is its width as a fraction of the group; `dx`/`dy` nudge it from that layout in % of the
 * group's width, so nudges scale with `size`; `scale` and `rotate` (degrees) adjust it about its center.
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
const GROUPS: (Landing & { name: string; parts: Part[] })[] = [
  /** Two soyjaks, one pointing at the other (the classic meme's 882 px frame: 458 px left, 374 px right). */
  {
    name: "soyjaks",
    x: 36,
    y: 25,
    size: 38,
    spin: 2,
    parts: [
      { name: "soyjack1", src: soyjack1, share: 458 / 882, dx: 16, dy: 17, scale: 0.8, rotate: 2 },
      { name: "soyjack2", src: soyjack2, share: 374 / 882, dx: 0, dy: 0, scale: 1, rotate: -2 },
    ],
  },
  /** This is fine: the dog in front, its fire just left of and behind him, overlapping a little (315 px + 300 px). */
  {
    name: "this-is-fine",
    x: -67,
    y: 23,
    size: 30,
    spin: -3,
    parts: [
      { name: "this-is-fine-fire", src: thisIsFineFire, share: 315 / 615, dx: 26, dy: -30, scale: 1.2, rotate: 0 },
      { name: "this-is-fine-dog", src: thisIsFine, share: 300 / 615, dx: 0, dy: 0, scale: 1, rotate: 0 },
    ],
  },
];

function partStyle({ share, dx, dy, scale, rotate }: Part): CSSProperties {
  return {
    width: `${share * 100}%`,
    "--dx": `${dx}cqw`,
    "--dy": `${dy}cqw`,
    "--scale": scale,
    "--rotate": `${rotate}deg`,
  } as CSSProperties;
}

/**
 * Every meme image, dat boi, and nyan cat's two. The burst starts once these, the confetti, and streamers have all
 * loaded (or failed), so none pops in mid-flight.
 */
const IMAGE_COUNT = SCATTERED.length + GROUPS.reduce((n, g) => n + g.parts.length, 0) + 1 + NYAN_IMAGE_COUNT;

function landingStyle({ x, y, size, spin }: Landing, motion: CSSProperties | undefined): CSSProperties {
  return {
    "--x": `${x}vmin`,
    "--y": `${y}vmin`,
    "--size": `${size}vmin`,
    "--spin": `${spin}deg`,
    ...motion,
  } as CSSProperties;
}

/** Each bouncing sprite (scattered, groups, dat boi) starts up to this many seconds late, so they don't bounce in unison. */
const MAX_DELAY_S = 0.08;

/**
 * Each bouncing sprite's random motion, by name, drawn once per mount so re-renders never shift a running animation:
 * its start `--delay`, and a wobble of 0.7–1.125° either way over a 7–14 s period, starting anywhere in its cycle.
 * Dat boi wobbles just 0.25°: big and pivoting far below his wheel, any more swings him wildly.
 */
function randomMotion(): Map<string, CSSProperties> {
  const names = [
    ...SCATTERED.map((s) => s.name),
    ...GROUPS.flatMap((g) => [g.name, ...g.parts.map((p) => p.name)]),
    "dat-boi",
  ];
  return new Map(
    names.map((name) => {
      const period = random(7, 14);
      const motion = {
        "--delay": `${random(0, MAX_DELAY_S)}s`,
        "--wobble": `${name === "dat-boi" ? 0.25 : random(0.7, 1.125)}deg`,
        "--wobble-period": `${period}s`,
        "--wobble-delay": `${-random(0, period)}s`,
      } as CSSProperties;
      return [name, motion];
    }),
  );
}

/** Confetti and streamers explode out of the center with the memes, painted behind them. */
const CONFETTI_COUNT = 270;
const STREAMER_COUNT = 11;

/** A particle image and its width relative to its kind's random `size`. */
interface ParticleSource {
  src: string;
  scale: number;
}
type Sources = [ParticleSource, ...ParticleSource[]];
/** The rectangle reads as big beside the other shapes at the same width, so it's drawn smaller. */
const CONFETTI: Sources = [
  { src: confettiRect, scale: 0.6 },
  { src: confettiCircle, scale: 1 },
  { src: confettiSquiggle, scale: 1 },
  { src: confettiStar, scale: 1 },
  { src: confettiTriangle, scale: 1 },
];
const STREAMERS: Sources = [
  { src: streamerWave, scale: 1 },
  { src: streamerCurl, scale: 1 },
];

interface Particle {
  kind: "confetti" | "streamer";
  src: string;
  style: CSSProperties;
}

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Confetti and streamers, drawn once per mount: each flies from the center to a random landing spread over the whole
 * viewport (out to just past its edges, sparse near the center, where the card hides them), tinted by a random hue,
 * then flutters back and forth every `flutter` seconds (half a cycle). Confetti lands at any `spin`; streamers point
 * along their flight, straight out from the center, `spin` only nudging them off it.
 */
function randomParticles(): Particle[] {
  const make = (
    kind: Particle["kind"],
    sources: Sources,
    size: [number, number],
    spin: number,
    flutter: [number, number],
  ): Particle => {
    const angle = random(0, 2 * Math.PI);
    // sqrt: even density by area, out to 105% of the half-viewport.
    const reach = Math.sqrt(random(0.06, 1.1));
    const source = sources[Math.floor(Math.random() * sources.length)] ?? sources[0];
    return {
      kind,
      src: source.src,
      style: {
        "--x": `${Math.cos(angle) * reach * 50}vw`,
        "--y": `${Math.sin(angle) * reach * 50}vh`,
        "--size": `${random(...size) * source.scale}vmin`,
        "--spin": `${random(-spin, spin)}deg`,
        "--hue": `${random(0, 360)}deg`,
        "--duration": `${random(0.8, 1.3)}s`,
        "--delay": `${random(0, 0.12)}s`,
        "--flutter": `${random(...flutter)}s`,
        "--flutter-delay": `${-random(0, flutter[1])}s`,
      } as CSSProperties,
    };
  };
  return [
    ...Array.from({ length: STREAMER_COUNT }, () => make("streamer", STREAMERS, [3, 5], 12, [1.4, 2.6])),
    ...Array.from({ length: CONFETTI_COUNT }, () => make("confetti", CONFETTI, [1.2, 2.4], 304, [5.6, 10.4])),
  ];
}

/**
 * The `party` sign-in intro around `children` (the sign-in card), all at once: memes explode out of the center from
 * behind the card and settle around the page in a shower of confetti and streamers, dat boi pops up behind the card's
 * top-right corner, and nyan cat shoots out of its top-left corner.
 */
export function IntroParty({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(0);
  const [done, setDone] = useState(false);
  const onLoad = () => setLoaded((n) => n + 1);
  const [motion] = useState(randomMotion);
  const [particles] = useState(randomParticles);
  const ready = loaded >= IMAGE_COUNT + particles.length;

  return (
    <div className="intro-stage" data-testid="intro" data-intro="party" data-ready={ready} data-done={done}>
      <div className="intro-scatter" aria-hidden="true">
        {particles.map((p, i) => (
          <img
            key={`${p.kind}-${i}`}
            className={`intro-particle intro-${p.kind}`}
            data-testid="intro-particle"
            src={p.src}
            alt=""
            style={p.style}
            onLoad={onLoad}
            onError={onLoad}
          />
        ))}
        {SCATTERED.map((s) => (
          <img
            key={s.name}
            className="intro-sprite"
            data-testid="intro-image"
            data-sprite={s.name}
            src={s.src}
            alt=""
            style={landingStyle(s, motion.get(s.name))}
            onLoad={onLoad}
            onError={onLoad}
          />
        ))}
        {GROUPS.map((g) => (
          <div key={g.name} className="intro-sprite intro-group" data-sprite={g.name} style={landingStyle(g, motion.get(g.name))}>
            {g.parts.map((p) => (
              <img
                key={p.name}
                data-testid="intro-image"
                data-sprite={p.name}
                src={p.src}
                alt=""
                style={{ ...partStyle(p), ...motion.get(p.name) }}
                onLoad={onLoad}
                onError={onLoad}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="intro-dat-boi" aria-hidden="true">
        <img
          src={datBoi}
          alt=""
          data-testid="intro-image"
          data-sprite="dat-boi"
          style={motion.get("dat-boi")}
          onLoad={onLoad}
          onError={onLoad}
        />
      </div>
      <NyanCorner onLoad={onLoad} onFlown={() => setDone(true)} />
      {children}
    </div>
  );
}
