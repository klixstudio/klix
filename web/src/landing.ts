import { startPrism } from './prism.ts';
import { startFlow } from './flow.ts';
import { initSite, cleanRepo, cleanSite, loadWebFont } from './site.ts';
import { loadFonts, Player, THEMES, STYLES, FONTS, FORMATS, still, timeline, registerSiteFace, preloadImages, type RenderInput } from './render.ts';
import { SAMPLE, sampleFor, SITE_SAMPLES, SITES_DATE } from './sample.ts';
import { Sound } from './music.ts';

initSite();
startPrism(document.getElementById('prism') as HTMLCanvasElement);
startPrism(document.getElementById('flow-prism') as HTMLCanvasElement);
startFlow(document.getElementById('flow-lines') as HTMLCanvasElement);

// The link box takes either a repo or a website and opens the Studio in the right mode.
for (const form of document.querySelectorAll<HTMLFormElement>('[data-repo-form]')) {
  const input = form.querySelector('input')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    const repo = /^(https?:\/\/)?(www\.)?github\.com\//i.test(value) || !value.includes('.') ? cleanRepo(value) : null;
    const site = repo ? null : cleanSite(value);
    if (repo) { location.href = `/make?repo=${encodeURIComponent(repo)}`; return; }
    if (site) { location.href = `/make?site=${encodeURIComponent(site)}`; return; }
    input.focus();
    form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 320 });
    input.value = '';
    input.placeholder = 'try vitejs/vite or linear.app';
  });
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function type(el: HTMLElement, text: string, ms: number) { for (const ch of text) { el.textContent += ch; await wait(ms); } }

// Feature card: the script lines type themselves, one after another, then start over.
const lines = [...document.querySelectorAll<HTMLElement>('#vis-script .sline')];
const texts = [SAMPLE.script.hook, SAMPLE.script.beats[0].title, SAMPLE.script.cta];
async function typeScript() {
  for (;;) {
    lines.forEach((l) => { l.querySelector('span')!.textContent = ''; l.classList.remove('typing'); });
    for (let i = 0; i < lines.length; i++) {
      lines[i].classList.add('typing');
      await type(lines[i].querySelector('span')!, texts[i], 32);
      lines[i].classList.remove('typing');
      await wait(280);
    }
    await wait(2600);
  }
}

// Feature card: a brief types itself, then the settings Claude chose appear. The text is from a real run.
const briefEl = document.getElementById('vis-brief')!;
const briefOut = document.getElementById('vis-brief-out')!;
const BRIEF = 'Hype launch for Reels: vertical, fast cuts, loud music, make the words punchier';
const OUT = ['Kinetic', '9:16', 'Fast cuts', 'Drive', 'Raycast colours', 'New hook'];
async function typeBrief() {
  for (;;) {
    briefEl.textContent = '';
    briefOut.replaceChildren();
    briefEl.classList.add('typing');
    await type(briefEl, BRIEF, 28);
    briefEl.classList.remove('typing');
    await wait(500);
    for (const o of OUT) {
      const s = document.createElement('span');
      s.textContent = o;
      briefOut.append(s);
      await wait(220);
    }
    await wait(3200);
  }
}

// Feature card: the sound card's equaliser.
const eq = document.getElementById('eq-bars')!;
for (let i = 0; i < 28; i++) {
  const b = document.createElement('i');
  b.style.animationDelay = `${-((i * 0.37) % 1.3)}s`;
  b.style.animationDuration = `${0.9 + ((i * 7) % 5) / 10}s`;
  eq.append(b);
}

const fmt = (t: number) => `00:${String(Math.floor(t)).padStart(2, '0')}`;
const look = (id: string): RenderInput => sampleFor(id);
const at = (input: RenderInput, kind: string, part: number, i = 0) => {
  const sc = timeline(input).filter((x) => x.kind === kind)[i] ?? timeline(input)[0];
  return sc.start + sc.dur * part;
};

await loadFonts();
if (!reduced) { typeScript(); typeBrief(); }
else {
  lines.forEach((l, i) => { l.querySelector('span')!.textContent = texts[i]; });
  briefEl.textContent = BRIEF;
  briefOut.innerHTML = OUT.map((o) => `<span>${o}</span>`).join('');
}

// Sample monitor: plays the sample, moving to the next style each time it loops, until the visitor picks one.
const demoCanvas = document.getElementById('demo') as HTMLCanvasElement;
let current = 0;
let pinned = false;
let demoInView = false;
/** Stops the tile that is playing, if any. */
let stopTile: (() => void) | null = null;
const demo = new Player(demoCanvas, look(STYLES[0].id), 900);
let demoInput = look(STYLES[0].id);
const sound = new Sound(() => demoInput);
sound.muted = true;
demo.audio = sound;
const soundBtn = document.getElementById('demo-sound')!;
soundBtn.addEventListener('click', () => {
  sound.muted = !sound.muted;
  soundBtn.setAttribute('aria-pressed', String(!sound.muted));
  soundBtn.querySelector('span')!.textContent = sound.muted ? 'Sound on' : 'Sound off';
  if (sound.muted) sound.stop(); else if (!demo.playing) playDemo(); else sound.start(demo.time);
});
const tc = document.getElementById('demo-tc')!;
const bar = document.getElementById('demo-bar')!;
const demoName = document.getElementById('demo-name')!;
const rail = document.getElementById('demo-styles')!;
demo.onTime = (t, total) => {
  tc.textContent = `${fmt(t)} / ${fmt(total)}`;
  bar.style.width = `${(t / total) * 100}%`;
};
const showStyle = (i: number) => {
  current = i;
  demoInput = look(STYLES[i].id);
  demo.set(demoInput);
  demo.seek(0);
  demoName.textContent = `${STYLES[i].label} · ${demoInput.repo.owner}/${demoInput.repo.name}`;
  rail.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-checked', String(j === i)));
};
STYLES.forEach((st, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.textContent = st.label;
  b.addEventListener('click', () => { pinned = true; showStyle(i); playDemo(); });
  rail.append(b);
});
demo.onLoop = () => { if (!pinned) showStyle((current + 1) % STYLES.length); };
showStyle(0);
if (reduced) demo.seek(1.6);
else new IntersectionObserver(([e]) => {
  demoInView = e.isIntersecting;
  if (!demoInView) demo.pause();
  else if (!stopTile) demo.play();
}).observe(demoCanvas);

/** Starts the monitor and stops whichever tile is playing, so only one video plays at a time. */
function playDemo() {
  stopTile?.();
  stopTile = null;
  demo.play();
}

/** A still that plays, with its own score, when tapped; tapping again stops it. Only one tile plays at a time.
 *  Returns a function that swaps in a new input, for fonts that arrive later. */
function tile(grid: HTMLElement, input: RenderInput, t: number, caption: string, extra = '') {
  const fig = document.createElement('figure');
  fig.className = 'style-tile';
  const frame = document.createElement('div');
  frame.className = 'style-frame';
  const canvas = document.createElement('canvas');
  still(canvas, input, t, 540);
  frame.append(canvas);
  const cap = document.createElement('figcaption');
  cap.innerHTML = caption + extra;
  fig.append(frame, cap);
  grid.append(fig);
  let player: Player | null = null;
  const tileSound = new Sound(() => input);
  const stop = () => { fig.classList.remove('is-playing'); player?.pause(); player?.seek(t); };
  fig.addEventListener('click', () => {
    if (stopTile === stop) {
      stop();
      stopTile = null;
      if (demoInView) demo.play();
      return;
    }
    stopTile?.();
    demo.pause();
    stopTile = stop;
    fig.classList.add('is-playing');
    if (!player) { player = new Player(canvas, input, 540); player.audio = tileSound; }
    player.seek(0);
    player.play();
  });
  return (next: RenderInput) => { input = next; player?.set(next); still(canvas, next, t, 540); };
}

// Styles: one tile per style, each with its own real repo.
const grid = document.getElementById('style-grid')!;
for (const st of STYLES) {
  const input = look(st.id);
  tile(grid, input, at(input, 'name', 0.7), `<b>${st.label} <i>${input.repo.owner}/${input.repo.name}</i></b><small>${st.blurb}</small>`);
}

// Websites: eight real sites in their own colours, on the product shot. Their fonts load when Google Fonts has them.
const siteGrid = document.getElementById('site-grid')!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
document.getElementById('sites-note')!.textContent = `Snapshot from ${SITES_DATE}: each site's own copy, colours, preview image and, where Google Fonts has it, its typeface. Scripts by Claude. Trademarks belong to their owners.`;
const siteTiles = SITE_SAMPLES.map(({ input, look: l }) => {
  const swatches = [l.bg, ...l.accents].map((c) => `<i style="background:${c}"></i>`).join('');
  const t = at(input, 'shot', 0.55);
  return tile(siteGrid, input, t, `<b>${esc(input.repo.name)} <i>${esc(input.repo.owner)}</i></b>`, `<span class="swatches">${swatches}<em>${esc(l.fontFamily || 'site font')}</em></span>`);
});
SITE_SAMPLES.forEach(async ({ input, look: l }, i) => {
  await preloadImages(input);
  let next = input;
  if (l.fontFamily && await loadWebFont(l.fontFamily)) next = { ...input, font: registerSiteFace(l.fontFamily, `site-${i}`) };
  siteTiles[i](next);
});

// Feature card: one site's palette and type, cycling through the samples.
const visSite = document.getElementById('vis-site')!;
let siteIx = 0;
const showSite = () => {
  const { input, look: l } = SITE_SAMPLES[siteIx % SITE_SAMPLES.length];
  visSite.innerHTML = `<div class="vs-top"><b>${esc(input.repo.name)}</b><small>${esc(input.repo.owner)}</small></div><div class="vs-sw">${[l.bg, l.bg2, l.ink, ...l.accents].map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="vs-font"><span style="font-family:'${esc(l.fontFamily)}', var(--sans)">Aa</span><small>${esc(l.fontFamily || 'site font')}</small></div>`;
  siteIx++;
};
showSite();
if (!reduced) setInterval(showSite, 2600);

// Feature card: a fanned stack of real frames in three styles.
const stack = document.getElementById('vis-stack')!;
(['swiss', 'neon', 'cinematic'] as const).forEach((id) => {
  const c = document.createElement('canvas');
  const input = look(id);
  still(c, input, at(input, 'name', 0.7), 320);
  stack.append(c);
});

// Feature card: the same frame in all four formats.
const formats = document.getElementById('vis-formats')!;
FORMATS.forEach((f) => {
  const fig = document.createElement('figure');
  const c = document.createElement('canvas');
  const input = { ...look('editorial'), format: f.id };
  still(c, input, at(input, 'outro', 0.8), 260);
  const cap = document.createElement('figcaption');
  cap.textContent = f.ratio.join(':');
  fig.append(c, cap);
  formats.append(fig);
});

// Studio cards: the real faces and palettes.
const fontList = document.getElementById('font-list')!;
for (const f of FONTS.filter((x) => !x.id.startsWith('site'))) {
  const li = document.createElement('li');
  li.textContent = f.label;
  li.style.fontFamily = f.family;
  li.style.fontWeight = String(f.weight);
  fontList.append(li);
}
const pal = document.getElementById('pal-grid')!;
for (const th of THEMES) {
  const d = document.createElement('div');
  d.innerHTML = `<i style="background: radial-gradient(90% 120% at 0% 0%, ${th.accents[0]}, transparent 62%), radial-gradient(90% 120% at 100% 100%, ${th.accents[2]}, transparent 62%), linear-gradient(${th.bg}, ${th.bg2})"></i><small>${th.label}</small>`;
  pal.append(d);
}
