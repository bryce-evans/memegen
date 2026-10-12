import { useCallback, useEffect, useState } from "react";
import type { DecodedMedia } from "@memegen/render";

export interface Playback {
  frame: number;
  playing: boolean;
  /** Show frame `f`, stopping playback. */
  seek: (f: number) => void;
  toggle: () => void;
}

/** The editor's current frame; playing advances it by each frame's own duration, looping (stills never play). */
export function usePlayback(media: DecodedMedia): Playback {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const animated = media.kind !== "image";

  useEffect(() => {
    if (!playing || !animated) return;
    const ms = Math.max(10, (media.durations[frame] ?? 0.1) * 1000);
    const timer = setTimeout(() => setFrame((f) => (f + 1) % media.times.length), ms);
    return () => clearTimeout(timer);
  }, [playing, animated, frame, media]);

  const seek = useCallback((f: number) => {
    setPlaying(false);
    setFrame(f);
  }, []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);

  return { frame, playing, seek, toggle };
}
