import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const root = import.meta.dir;
const timeline = JSON.parse(await readFile(join(root, 'timeline.json'), 'utf8'));
const assemble = process.argv.includes('--assemble');
const requested = new Set(process.argv.slice(2).filter(arg => arg !== '--assemble'));
const scenes = timeline.scenes.filter((s: {id: string}) => requested.size === 0 || requested.has(s.id));
if (requested.size && scenes.length !== requested.size) throw new Error('Unknown scene ID');
if (timeline.scenes.some((s: {duration: number; motionDuration: number; endHold?: number}) => Math.abs(s.duration - s.motionDuration - (s.endHold ?? timeline.endHold)) > 0.001)) throw new Error('Every shot must end with its configured still hold');
if (Math.abs(timeline.scenes.reduce((sum: number, s: {duration: number}) => sum + s.duration, 0) - timeline.duration) > 0.001) throw new Error('Timeline duration mismatch');
async function run(args: string[]) {
  const p = Bun.spawn(args, {cwd: root, stdout: 'inherit', stderr: 'inherit'});
  if (await p.exited !== 0) throw new Error(`Command failed: ${args.join(' ')}`);
}
const encode = ['-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','256k','-movflags','+faststart'];
let offset = 0;
const sceneStarts = new Map<string, number>();
for (const scene of timeline.scenes) {
  sceneStarts.set(scene.id, offset);
  offset += scene.duration;
}
await mkdir(join(root, 'scenes'), {recursive: true});
for (const s of scenes) {
  const args = ['ffmpeg','-hide_banner','-loglevel','warning','-y'];
  let filter: string;
  if (s.kind) {
    args.push('-i',`graphics/${s.id}.mp4`);
    filter = '[0:v]scale=1920:1080,setsar=1,fps=30[v]';
  } else {
    args.push('-ss',String(s.start ?? 0),'-i',s.source);
    const trim = s.sourceDuration ? `trim=duration=${s.sourceDuration},` : '';
    const crop = s.crop ? `crop=${s.crop},` : '';
    const base = `${trim}setpts=${s.speed ?? 1}*(PTS-STARTPTS),${crop}scale=1920:1080,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${s.motionDuration}`;
    if(s.title) {
      args.push('-loop','1','-i',`graphics/${s.id}.png`);
      filter = `[0:v]${base}[base];[1:v]scale=1920:1080,format=rgba[caption];[base][caption]overlay=0:0:shortest=1[v]`;
    } else filter = `[0:v]${base}[v]`;
  }
  filter = filter.replace(/\[v\]$/, `[motion];[motion]trim=end_frame=${Math.round(s.motionDuration * timeline.fps)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${Math.round((s.endHold ?? timeline.endHold) * timeline.fps)}[v]`);
  const audioInput = s.kind || !s.title ? 1 : 2;
  args.push('-ss',String(sceneStarts.get(s.id)),'-i','soundtrack.wav');
  args.push('-filter_complex',filter,'-map','[v]','-map',`${audioInput}:a`,'-t',String(s.duration),...encode,`scenes/${s.id}.mp4`);
  await run(args);
}
if (!assemble) {
  console.log(`Rendered individual clips: ${scenes.map((s: {id: string}) => s.id).join(', ')}. Combined export unchanged.`);
  process.exit(0);
}
await writeFile(join(root,'scene-list.txt'),timeline.scenes.map((s: {id: string})=>`file 'scenes/${s.id}.mp4'`).join('\n')+'\n');
await run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','concat','-safe','0','-i','scene-list.txt','-an','-c:v','copy','-movflags','+faststart','picture-only.mp4']);
// Replace only frame zero; the rest of the edit and soundtrack retain their existing timestamps.
await run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-i','picture-only.mp4','-i','soundtrack.wav','-i','thumbnails/doge-discovers-memegen.png','-filter_complex',`[0:v][2:v]overlay=enable='lt(t,${0.5 / timeline.fps})'[v]`,'-map','[v]','-map','1:a','-map','2:v','-c:v:0','libx264','-preset','fast','-crf','18','-pix_fmt:v:0','yuv420p','-c:v:1','copy','-disposition:v:1','attached_pic','-c:a','aac','-b:a','256k','-t',String(timeline.duration),'-movflags','+faststart','memegen-intro.mp4']);
console.log('Rendered memegen-intro.mp4 with thumbnail as frame zero and cover art; edit duration and soundtrack timing preserved.');
