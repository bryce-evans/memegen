import { useState, type CSSProperties } from "react";
import catMeme from "../assets/intro/cat-meme.png";
import cheers from "../assets/intro/cheers.png";
import coffeeMug from "../assets/intro/coffee-mug.png";
import datBoi from "../assets/intro/dat-boi.png";
import doge from "../assets/intro/doge.png";
import nyanCat from "../assets/intro/nyan-cat.png";
import pepe from "../assets/intro/pepe.png";

/**
 * Where a sprite lands: its center `x`/`y` left of and above the lower-right corner, and its width
 * `size`, all in vmin; `spin` its resting tilt, `delay` its stagger in ms. Every sprite launches
 * from one point below the bottom edge (`--ox`/`--oy` on `.intro-burst`).
 */
interface Landing {
  x: number;
  y: number;
  size: number;
  spin: number;
  delay: number;
}

/** Back to front: they pile up overlapping in the corner like a meme collage. */
const SPRITES: (Landing & { name: string; src: string })[] = [
  { name: "pepe", src: pepe, x: 50, y: 37, size: 15, spin: -6, delay: 0 },
  { name: "doge", src: doge, x: 40, y: 29, size: 21, spin: 3, delay: 50 },
  { name: "cheers", src: cheers, x: 11, y: 31, size: 14, spin: 6, delay: 100 },
  { name: "cat-meme", src: catMeme, x: 30, y: 13, size: 18, spin: -4, delay: 150 },
  { name: "coffee-mug", src: coffeeMug, x: 10, y: 12, size: 18, spin: 3, delay: 200 },
];

/** Lands last and on top of the pile; nyan cat shoots out of his side once he has landed (see `.intro-nyan`). */
const DAT_BOI: Landing = { x: 24, y: 39, size: 22, spin: -2, delay: 260 };

/** Every image, nyan cat included; the burst starts once all have loaded (or failed), so none pops in mid-flight. */
const IMAGE_COUNT = SPRITES.length + 2;

function landingStyle({ x, y, size, spin, delay }: Landing): CSSProperties {
  return {
    "--x": `${-x}vmin`,
    "--y": `${-y}vmin`,
    "--size": `${size}vmin`,
    "--spin": `${spin}deg`,
    "--delay": `${delay}ms`,
  } as CSSProperties;
}

/** Sign-in intro: meme sprites explode from the lower-right corner, fan out, and settle with a bounce behind the sign-in panel. */
export function IntroBurst() {
  const [settled, setSettled] = useState(0);
  const [done, setDone] = useState(false);
  const onSettle = () => setSettled((n) => n + 1);

  return (
    <div
      className="intro-burst"
      aria-hidden="true"
      data-testid="intro-burst"
      data-ready={settled >= IMAGE_COUNT}
      data-done={done}
    >
      {SPRITES.map((s) => (
        <img
          key={s.name}
          className="intro-sprite"
          src={s.src}
          alt=""
          style={landingStyle(s)}
          onLoad={onSettle}
          onError={onSettle}
        />
      ))}
      <div className="intro-sprite intro-dat-boi" style={landingStyle(DAT_BOI)}>
        <div className="intro-nyan">
          <img src={nyanCat} alt="" onLoad={onSettle} onError={onSettle} onAnimationEnd={() => setDone(true)} />
        </div>
        <img src={datBoi} alt="" onLoad={onSettle} onError={onSettle} />
      </div>
    </div>
  );
}
