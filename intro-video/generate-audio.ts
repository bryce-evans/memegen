import { join } from "node:path";

// Prepare the user-selected music; picture edits and narration stay untouched.
const dir = import.meta.dir;
const timeline = await Bun.file(join(dir, "timeline.json")).json();
const source = await Bun.file(join(dir, "music/golden-bossa-breeze-source.json")).json();
const input = join(dir, "music/golden-bossa-breeze.mp3");
const duration = timeline.duration;
const sr = 48000;
async function run(args: string[]) {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (exit !== 0) throw new Error(`${args.join(" ")}\n${stderr}`);
  return stdout + stderr;
}
const fadeOut = Math.min(1.5, duration);
await run(["ffmpeg", "-y", "-i", input, "-af", `atrim=duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:d=0.15,afade=t=out:st=${duration-fadeOut}:d=${fadeOut}`, "-ar", String(sr), "-ac", "2", "-c:a", "pcm_s24le", join(dir, "music-only.wav")]);
const measure = await run(["ffmpeg", "-i", join(dir, "music-only.wav"), "-af", "loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"]);
const match = measure.match(/\{\s*"input_i"[\s\S]*?\}/);
if (!match) throw new Error("No loudness measurement from ffmpeg");
const m = JSON.parse(match[0]);
await run(["ffmpeg", "-y", "-i", join(dir, "music-only.wav"), "-af", `loudnorm=I=-16:TP=-1.5:LRA=9:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`, "-ar", String(sr), "-ac", "2", "-c:a", "pcm_s24le", join(dir, "soundtrack.wav")]);
let offset = 0;
const scenes: Record<string, {start: number; end: number}> = {};
for (const scene of timeline.scenes) {
  scenes[scene.id] = {start: offset, end: offset + scene.duration};
  offset += scene.duration;
}
await Bun.write(join(dir, "music-timing.json"), JSON.stringify({duration, sampleRate: sr, narration: false, ducking: false, track: source.title, source: source.url, sourceStart: 0, fadeIn: 0.15, fadeOut, scenes}, null, 2) + "\n");
const probe = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=sample_rate,channels,codec_name", "-of", "json", join(dir, "soundtrack.wav")]);
const checks = await run(["ffmpeg", "-i", join(dir, "soundtrack.wav"), "-af", "ebur128=peak=true", "-f", "null", "-"]);
await Bun.write(join(dir, "audio-verification.log"), probe + "\n" + checks);
console.log(probe);
console.log(checks.slice(-700));
