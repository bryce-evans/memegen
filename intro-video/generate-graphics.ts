import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { justifyRows } from '../apps/web/src/justifiedRows.ts';
const root = import.meta.dir;
const repo = resolve(root, '..');
const timeline = JSON.parse(await readFile(join(root, 'timeline.json'), 'utf8'));
const thumbnails = process.argv.includes('--thumbnails');
const requested = new Set(process.argv.slice(2).filter(arg => arg !== '--thumbnails'));
if (thumbnails && requested.size) throw new Error('Thumbnail mode does not accept scene IDs');
const scenes = thumbnails ? [] : timeline.scenes.filter((s: {id: string}) => requested.size === 0 || requested.has(s.id));
if (requested.size && scenes.length !== requested.size) throw new Error('Unknown scene ID');
const painted = await readFile(join(repo, 'packages/ui/src/skins/painted.css'), 'utf8');
// Use the product's actual paint SVGs and ink colors rather than approximating its background.
const lightTokens = new Map<string, string>();
for (const match of painted.matchAll(/(--painted-(?:wash|grain|brand-paint|wordmark-gradient|ink-[\w-]+)):[^;]+;/g)) {
  if (!lightTokens.has(match[1])) lightTokens.set(match[1], match[0]);
}
const tokens = [...lightTokens.values()].join('\n');
const data = async (file: string, mime: string) => `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
const doge = await data(join(repo, 'apps/web/src/assets/intro/doge.png'), 'image/png');
const meme = await data(join(root, 'raw/meme.png'), 'image/png');
const fren = await data(join(root, 'raw/fren.png'), 'image/png');
const archivo = await data(join(repo, 'packages/ui/node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2'), 'font/woff2');
const sourceSans = await data(join(repo, 'packages/ui/node_modules/@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2'), 'font/woff2');
const catalog = JSON.parse(await readFile(join(root, 'template-assets/catalog.json'), 'utf8'));
const choices = await Promise.all(catalog.templates.map(async (t: {name: string; file: string; mime: string}) => ({name:t.name, src:await data(join(root,t.file),t.mime)})));
const css = `
@font-face{font-family:Radlush;src:local('Radlush-ExtraBold'),local('Radlush Extra Bold');font-weight:800 900;font-display:block}
@font-face{font-family:'Archivo Variable';src:url('${archivo}') format('woff2');font-weight:100 900;font-display:block}
@font-face{font-family:'Source Sans 3 Variable';src:url('${sourceSans}') format('woff2');font-weight:200 900;font-display:block}
:root{${tokens}}
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{background:transparent;color:#292929;font-family:Radlush,'Archivo Variable',Archivo,sans-serif;font-weight:900;letter-spacing:-.02em}
.full{position:relative;width:100%;height:100%;background:#e9e9e9;isolation:isolate}
.full:before{content:'';position:absolute;inset:0;z-index:-1;background-image:var(--painted-grain),var(--painted-wash);background-position:0 0,center;background-size:auto,cover;background-repeat:repeat,no-repeat;opacity:.8}
.ink{background-image:var(--painted-wordmark-gradient);background-clip:text;-webkit-background-clip:text;color:transparent}
.kicker{position:absolute;top:70px;left:100px;font-size:38px;letter-spacing:1px}
.doge{position:absolute;object-fit:contain;filter:drop-shadow(0 16px 12px #57432922)}
.hero{left:95px;bottom:-30px;width:590px;height:850px;transform:rotate(-7deg)}
.bubble{position:absolute;background:#fffffff0;border:4px solid #fff;border-radius:65px;box-shadow:0 15px 50px #8d888720;padding:60px;text-align:center}
.bubble:after{content:'';position:absolute;left:55px;top:100%;width:55px;height:38px;background:#fff;clip-path:polygon(0 0,100% 0,0 100%);pointer-events:none}
.thought{top:240px;right:95px;width:1110px;font-size:85px;line-height:1.12;transform:rotate(2deg)}
em{font-style:normal;background-image:var(--painted-wordmark-gradient);background-clip:text;-webkit-background-clip:text;color:transparent}
.aside{position:absolute;bottom:130px;right:230px;font-size:40px;transform:rotate(-5deg);color:#665129}
.reaction{left:60px;bottom:15px;width:430px;height:650px;transform:rotate(6deg)}
.meme-frame{position:absolute;right:75px;top:280px;width:1320px;padding:20px;border-radius:30px;background:#ffffffe0;box-shadow:0 16px 40px #7773;transform:rotate(-1deg)}
.meme-frame img{width:100%;display:block;border-radius:12px}
.headline{position:absolute;top:70px;left:90px;right:90px;text-align:center;font-size:80px;line-height:1.12}
.thought-small{left:42px;top:250px;width:380px;padding:25px;font-size:38px;transform:rotate(-5deg)}
.bar{position:absolute;left:46px;top:18px;padding:15px 32px;border-radius:20px;background:#fffffff2;box-shadow:0 5px 22px #9992;font-size:34px;max-width:1580px}
.bar:before{content:'';position:absolute;inset:-8px;z-index:-1;background:var(--painted-brand-paint) center/100% 100% no-repeat}
.caption{position:absolute;bottom:20px;left:265px;right:48px;text-align:center;background:#fffffff2;border:3px solid white;border-radius:28px;padding:24px 32px;color:#292929;font-size:64px;line-height:1.2;box-shadow:0 6px 28px #5552}
.author-byline{position:absolute;left:393.6px;top:96px;width:168px;height:24px;padding-left:2.4px;background-size:100% 100%;color:#6d7475;font-family:adobe-clean,'Adobe Clean','Source Sans 3 Variable',sans-serif;font-size:14.4px;font-weight:400;line-height:21.6px;letter-spacing:normal;-webkit-font-smoothing:antialiased}
.presenter{left:14px;bottom:-10px;width:224px;height:334px;transform:rotate(-5deg)}
.presenter-label{position:absolute;left:24px;bottom:320px;padding:8px 18px;font-size:23px;border-radius:18px;background:#fff;color:#665129;transform:rotate(-6deg)}
.popular-bubble{left:24px;bottom:370px;width:300px;padding:24px;font-size:34px;line-height:1.12;transform:rotate(-3deg)}
.dm-head{position:absolute;top:65px;left:100px;font-size:60px}
.slack-frame{position:absolute;top:170px;right:70px;width:1270px;height:830px;background:#fff;border:2px solid #d8d8d8;border-radius:22px;box-shadow:0 15px 40px #8882;overflow:hidden;font-family:Arial,Helvetica,sans-serif;font-weight:400;letter-spacing:0}
.slack-top{height:58px;background:#f2f2f2;border-bottom:1px solid #ddd;padding:16px 28px;font-size:24px;font-weight:700}
.slack-top span{margin-left:45px;font-size:20px;color:#616061;font-weight:400}
.slack-person{height:70px;padding:18px 30px;border-bottom:1px solid #ddd;font-size:27px;font-weight:700}
.slack-person:before{content:'';display:inline-block;width:12px;height:12px;border-radius:50%;background:#2bac76;margin-right:16px}
.slack-message{position:relative;margin:24px 32px 0 94px;font-size:25px;line-height:1.3}
.slack-avatar{position:absolute;left:-62px;top:0;width:46px;height:46px;border-radius:9px;background:#fff2ce;object-fit:contain}
.slack-message strong{display:block;font-size:24px;margin-bottom:7px}
.slack-attachment{display:block;width:1000px;height:478px;object-fit:contain;object-position:left center;margin-top:12px;border:1px solid #ddd;border-radius:10px}
.slack-reply{margin-top:24px}
.fren-avatar{background:#d8f2f5;object-fit:cover;object-position:center top}
.browse-title{position:absolute;top:60px;left:70px;right:70px;text-align:center;font-size:70px;line-height:1.1}
.template-grid{position:absolute;left:580px;top:235px;width:1240px;display:grid;grid-template-columns:repeat(3,400px);gap:20px}
.template-choice{height:300px;padding:14px;border-radius:20px;background:#fffffff0;box-shadow:0 6px 22px #7772;text-align:center;overflow:hidden}
.template-choice img{display:block;width:372px;height:232px;object-fit:contain;border-radius:10px}
.template-choice span{display:block;font-size:25px;margin-top:11px;white-space:nowrap}
.template-scan{position:absolute;left:0;top:0;width:400px;height:300px;border:8px solid #ff9500;border-radius:20px;box-shadow:0 0 0 4px #fff;pointer-events:none;animation:template-search 1.5s .275s steps(1,end) both}
@keyframes template-search{0%{translate:0 0}20%{translate:420px 0}40%{translate:840px 0}60%{translate:0 320px}80%{translate:420px 320px}100%{translate:840px 320px}}
.browse .reaction{width:430px;height:650px;bottom:65px}
.browse .thought-small{top:230px}
.searching{animation:choice-searching .05s 1.775s both}
@keyframes choice-searching{from{opacity:1}to{opacity:0}}
.picked{position:absolute;inset:25px;opacity:0;animation:text-appear .05s 1.775s both}
.aside.upload{bottom:35px;left:580px;right:100px;text-align:center;font-size:55px;transform:rotate(-2deg)}
/* Individual transforms preserve each character/bubble's original tilted layout. */
.full .doge{transform-origin:50% 100%;animation:doge-pop .46s both}
@keyframes doge-pop{
  0%{scale:.15;translate:0 110px;opacity:0}
  18%{opacity:1}
  68%{scale:1.06;translate:0 -10px;opacity:1}
  100%{scale:1;translate:0 0;opacity:1}
}
.full .bubble{transform-origin:35% 80%;animation:text-appear .1s .5s both,bubble-wobble 3.6s .5s ease-in-out infinite}
.full .aside{animation:text-appear .1s 2s both}
.full:not(.browse) .aside{animation-delay:1.5s}
.full.browse .aside{animation-delay:1s}
@keyframes text-appear{from{opacity:0}to{opacity:1}}
@keyframes bubble-wobble{0%,100%{rotate:-1.4deg}50%{rotate:1.4deg}}
.thumbnail .doge{left:-10px;top:300px;width:800px;height:auto;transform:rotate(-7deg);animation:none;z-index:2}
.thumbnail-title{position:absolute;top:38px;left:50px;right:50px;margin:0;display:flex;align-items:center;justify-content:center;gap:20px;font-size:112px;line-height:1.1;white-space:nowrap;z-index:3}
.thumbnail-logo{display:inline-block;padding:.22em .3em .28em;font-size:148px;line-height:1.1;letter-spacing:-.02em;background-image:var(--painted-grain),var(--painted-wordmark-gradient),var(--painted-brand-paint);background-position:0 0,center,center;background-size:auto,auto,100% 100%;background-repeat:repeat,no-repeat,no-repeat;background-clip:text,text,border-box;-webkit-background-clip:text,text,border-box;color:transparent}
.thumbnail-gallery{position:absolute;right:62px;top:306px;width:1120px;height:684px;overflow:hidden;border:6px solid #fff;border-radius:26px;background:#f8faf9;box-shadow:0 30px 65px #3c53663b;transform:perspective(1800px) rotateY(-7deg) rotateZ(3deg);isolation:isolate}
.thumbnail-gallery:before{content:'';position:absolute;inset:0;z-index:-1;background:var(--painted-wash) center/cover no-repeat;opacity:.5}
.gallery-toolbar{height:48px;display:flex;align-items:center;gap:8px;padding:0 18px;background:#ffffffe8;border-bottom:1px solid #dce5e6}
.gallery-toolbar i{width:9px;height:9px;border-radius:50%;background:#b9c7c8}
.gallery-toolbar span{margin-left:120px;width:420px;height:19px;border-radius:20px;background:#e5edef}
.gallery-sidebar{position:absolute;top:48px;left:0;bottom:0;width:52px;padding-top:24px;display:flex;align-items:center;flex-direction:column;gap:24px;background:#ffffff80}
.gallery-sidebar i{display:block;width:16px;height:16px;border:3px solid #9aafb2;border-radius:4px}
.gallery-sidebar i:first-child{border:0;background:var(--painted-wordmark-gradient);border-radius:50%;width:24px;height:24px}
.gallery-templates{position:absolute;top:64px;left:68px;right:16px;bottom:16px;display:flex;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:12px;--template-row-height:130px}
.gallery-templates img{display:block;flex:none;object-fit:contain;background:#fff;border-radius:9px;box-shadow:0 0 0 4px #fff,0 3px 9px #51606920}
`;
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  if (thumbnails) {
    const directory = join(root, 'thumbnails');
    await mkdir(directory, {recursive:true});
    const galleryCatalog = JSON.parse(await readFile(join(directory, 'template-assets/catalog.json'), 'utf8'));
    const templates = await Promise.all(galleryCatalog.templates.map(async (t: {name: string; file: string; mime: string}) => ({name:t.name, src:await data(join(root, t.file), t.mime)})));
    const gallery = `<div class="thumbnail-gallery" aria-label="abstract template gallery"><div class="gallery-toolbar" aria-hidden="true"><i></i><i></i><i></i><span></span></div><div class="gallery-sidebar" aria-hidden="true">${'<i></i>'.repeat(6)}</div><div class="gallery-templates">${templates.map(t => `<img src="${t.src}" alt="${t.name}">`).join('')}</div></div>`;
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>doge discovers memegen</title><style>${css}</style><body><div class="full thumbnail"><h1 class="thumbnail-title"><span class="ink">doge discovers</span><span class="thumbnail-logo">memegen</span></h1>${gallery}<img class="doge" src="${doge}" alt="doge"></div></body></html>`;
    await page.setContent(html);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(image => image.decode()));
      const title = document.querySelector('.thumbnail-title')!;
      if (title.scrollWidth > title.clientWidth) throw new Error('Thumbnail title overflows');
    });
    const box = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>('.gallery-templates')!;
      const style = getComputedStyle(grid);
      return {
        aspects: Array.from(grid.querySelectorAll('img')).map(image => image.naturalWidth / image.naturalHeight),
        width: grid.clientWidth,
        gap: parseFloat(style.columnGap),
        target: parseFloat(style.getPropertyValue('--template-row-height')),
      };
    });
    // Reuse the real page's row scaling at thumbnail zoom; no caption-width floor is needed here.
    const heights = justifyRows(box.aspects, box.width, box.gap, box.target);
    await page.evaluate(({aspects, heights}) => {
      document.querySelectorAll<HTMLImageElement>('.gallery-templates img').forEach((image, i) => {
        image.style.width = `${aspects[i] * heights[i]}px`;
        image.style.height = `${heights[i]}px`;
      });
    }, {aspects:box.aspects, heights});
    await writeFile(join(directory, 'doge-discovers-memegen.html'), await page.content());
    await page.screenshot({path:join(directory, 'doge-discovers-memegen.png')});
    console.log('Rendered doge discovers memegen thumbnail; video and timeline unchanged.');
  }
  await mkdir(join(root,'graphics'),{recursive:true});
  for(const s of scenes){
    if(!s.title)continue;
    let content: string;
    if(s.kind==='title')content=`<div class="full"><div class="kicker ink">${s.eyebrow}</div><img class="doge hero" src="${doge}"><div class="bubble thought">${s.title}</div><div class="aside">much ambition.</div></div>`;
    else if(s.kind==='meme')content=`<div class="full"><div class="headline ink">${s.title}</div><img class="doge reaction" src="${doge}"><div class="bubble thought-small">very self-aware.</div><div class="meme-frame"><img src="${meme}"></div></div>`;
    else if(s.kind==='browse')content=`<div class="full browse"><div class="browse-title ink">${s.title}</div><img class="doge reaction" src="${doge}"><div class="bubble thought-small"><span class="searching">much choice.</span><span class="picked">this one!</span></div><div class="template-grid">${choices.map((t: {name:string;src:string})=>`<div class="template-choice"><img src="${t.src}"><span>${t.name}</span></div>`).join('')}<div class="template-scan"></div></div><div class="aside upload ink">${s.caption}</div></div>`;
    else if(s.kind==='dm')content=`<div class="full"><div class="dm-head ink">${s.title}</div><img class="doge reaction" src="${doge}"><div class="bubble thought-small">for u, fren.</div><div class="slack-frame"><div class="slack-top">Work Chat <span>Direct messages</span></div><div class="slack-person">fren</div><div class="slack-message"><img class="slack-avatar" src="${doge}"><strong>Doge</strong>made this instead of working.<img class="slack-attachment" src="${meme}"></div><div class="slack-message slack-reply"><img class="slack-avatar fren-avatar" src="${fren}" alt="fren"><strong>fren</strong>you could have just tagged me.</div></div></div>`;
    else if(s.id==='11-popular'||s.id==='02-counterpoint')content=`<img class="doge presenter" src="${doge}"><div class="bubble popular-bubble">${s.title}</div>`;
    else content=`<div class="bar"><span class="ink">${s.title}</span></div><img class="doge presenter" src="${doge}"><div class="presenter-label">${s.id.includes('post')?'wow. author.':'such focus.'}</div><div class="caption">${s.caption}</div>`;
    if (s.id === '06-post') {
      // Video-only byline replacement; keep the real account and raw footage intact.
      // Sample clean paint immediately above the byline in the 1600x900 capture.
      const patch = Bun.spawn(['ffmpeg','-hide_banner','-loglevel','error','-ss',String(s.start ?? 0),'-i',join(root,s.source),'-vf','crop=140:2:328:76,scale=168:24','-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'], {stdout:'pipe',stderr:'inherit'});
      const background = Buffer.from(await new Response(patch.stdout).arrayBuffer()).toString('base64');
      if (await patch.exited !== 0) throw new Error(`Byline background extraction failed: ${s.id}`);
      content += `<div class="author-byline" style="background-image:url('data:image/png;base64,${background}')">by @doge · just now</div>`;
    }
    const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>${s.id}</title><style>${css}</style><body>${content}</body></html>`;
    await writeFile(join(root,'graphics',`${s.id}.html`),html);
    await page.setContent(html);
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.decode()));});
    if (s.kind) {
      const animationDuration = s.motionDuration;
      const frames = join(root, 'graphics', `${s.id}-frames`);
      await mkdir(frames, {recursive:true});
      // Seek a paused animation clock for every frame; rendering speed cannot drop motion frames.
      await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; } });
      for (let frame = 0; frame < Math.round(animationDuration * timeline.fps); frame++) {
        await page.evaluate((ms) => { for (const a of document.getAnimations()) a.currentTime = ms; }, frame * 1000 / timeline.fps);
        await page.screenshot({path:join(frames, `${String(frame).padStart(4,'0')}.png`)});
      }
      const encoder = Bun.spawn(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate',String(timeline.fps),'-i',join(frames,'%04d.png'),'-frames:v',String(Math.round(animationDuration * timeline.fps)),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',join(root,'graphics',`${s.id}.mp4`)], {stdout:'inherit',stderr:'inherit'});
      if (await encoder.exited !== 0) throw new Error(`Animation encoding failed: ${s.id}`);
      await page.evaluate((ms) => { for (const a of document.getAnimations()) a.currentTime = ms; }, (animationDuration - 1 / timeline.fps) * 1000);
    }
    await page.screenshot({path:join(root,'graphics',`${s.id}.png`),omitBackground:true});
    console.log(`Rendered ${s.id}${s.kind ? ' (animated)' : ''}`);
  }
} finally {await browser.close();}
