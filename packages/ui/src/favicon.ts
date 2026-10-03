import { useEffect } from "react";
import { useSkin } from "./skin.tsx";

const SIZE = 64;

/** Every color in a computed `background-image` gradient, in order (`rgb(...)`/`rgba(...)` after computation). */
function gradientStops(backgroundImage: string): string[] {
  if (!backgroundImage.includes("gradient(")) return [];
  return backgroundImage.match(/rgba?\([^)]*\)/g) ?? [];
}

const isTransparent = (color: string) => color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);

/**
 * Draws `letter` as the active skin's wordmark draws its first letter (font, weight, case, color or gradient)
 * on the skin's page background, as a PNG data URL. Canvas, not SVG: an SVG favicon can't use the page's web fonts.
 */
async function drawWordmarkLetter(letter: string): Promise<string> {
  // A detached copy of the wordmark's first letter picks up every skin rule that styles the real one.
  const mark = document.createElement("span");
  mark.className = "ui-wordmark";
  mark.setAttribute("aria-hidden", "true");
  mark.style.cssText = "position:fixed;left:-9999px;top:0;pointer-events:none";
  const glyph = document.createElement("span");
  glyph.className = "ui-wordmark-letter";
  glyph.textContent = letter;
  mark.append(glyph);
  document.body.append(mark);
  try {
    const markStyle = getComputedStyle(mark);
    const style = getComputedStyle(glyph);
    const font = `${style.fontStyle} ${style.fontWeight} ${SIZE * 0.78}px ${style.fontFamily}`;
    await document.fonts.load(font, letter);
    const text =
      style.textTransform === "uppercase" ? letter.toUpperCase() : style.textTransform === "lowercase" ? letter.toLowerCase() : letter;

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");

    const root = getComputedStyle(document.documentElement);
    ctx.fillStyle = root.getPropertyValue("--ui-color-bg").trim() || "#000";
    ctx.beginPath();
    ctx.roundRect(0, 0, SIZE, SIZE, SIZE * 0.22);
    ctx.fill();

    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(text);
    const glyphHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const baseline = (SIZE - glyphHeight) / 2 + m.actualBoundingBoxAscent;

    // Gradient wordmarks paint the background through the text (on the letter or the whole mark).
    const stops = gradientStops(style.backgroundImage).length ? gradientStops(style.backgroundImage) : gradientStops(markStyle.backgroundImage);
    if (stops.length > 1) {
      const half = m.width / 2;
      const gradient = ctx.createLinearGradient(SIZE / 2 - half, 0, SIZE / 2 + half, 0);
      stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = isTransparent(style.color) ? root.getPropertyValue("--ui-color-text").trim() : style.color;
    }
    ctx.fillText(text, SIZE / 2, baseline);
    return canvas.toDataURL("image/png");
  } finally {
    mark.remove();
  }
}

/**
 * Keeps the page favicon in sync with the active skin: `letter` (e.g. the wordmark's first letter) drawn in that
 * skin's wordmark style. Call once inside `<SkinProvider>`.
 */
export function useSkinFavicon(letter: string): void {
  const { skin } = useSkin();
  useEffect(() => {
    let cancelled = false;
    void drawWordmarkLetter(letter).then(
      (href) => {
        if (cancelled) return;
        let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
        if (!link) {
          link = document.createElement("link");
          link.rel = "icon";
          document.head.append(link);
        }
        link.type = "image/png";
        link.href = href;
        link.dataset.skin = skin;
      },
      () => undefined, // keep the previous icon
    );
    return () => {
      cancelled = true;
    };
  }, [skin, letter]);
}
