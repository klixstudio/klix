import type { ScriptResponse, VideoScript } from '../../shared/script.ts';
import { LIMITS } from '../../shared/script.ts';
import { initSite, cleanRepo, loadWebFont } from './site.ts';
import {
  loadFonts, Player, record, recordingType, still, timeline, duration, bitrate, frameSize, withStyle, styleOf, faceOf,
  THEMES, STYLES, FONTS, FORMATS, RESOLUTIONS, TRANSITIONS, TRACKS, EDITS, trackOf, editOf, registerSiteFace, preloadImages, type Options, type RenderInput, type RepoView, type Theme,
} from './render.ts';
import { SAMPLE, SAMPLES_DATE, sampleFor } from './sample.ts';
import { Sound, renderMusic } from './music.ts';

initSite();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state: RenderInput & { real: boolean; fullName: string; by: string } = {
  ...structuredClone(SAMPLE),
  real: false,
  fullName: '',
  by: '',
};

// Settings survive a reload. Script and repo do not; they come from the server.
const SAVED = 'klix-settings';
const OPTION_KEYS: (keyof Options)[] = ['style', 'accent', 'font', 'scale', 'align', 'case', 'format', 'resolution', 'fps', 'edit', 'music', 'volume', 'transition', 'quality', 'grain', 'vignette', 'letterbox', 'camera', 'hud', 'object', 'code'];
try {
  const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null') as (Partial<Options> & { theme?: string }) | null;
  if (saved) {
    for (const k of OPTION_KEYS) if (k in saved) (state as unknown as Record<string, unknown>)[k] = saved[k];
    state.theme = THEMES.find((t) => t.id === saved.theme) ?? state.theme;
    // Older saves had 24 and 30 fps; the floor is now 60.
    if (![60, 90, 120].includes(state.fps)) state.fps = 60;
  }
} catch { /* first visit or storage blocked */ }
const save = () => {
  try {
    const out: Record<string, unknown> = { theme: state.theme.id };
    for (const k of OPTION_KEYS) out[k] = state[k];
    localStorage.setItem(SAVED, JSON.stringify(out));
  } catch { /* storage blocked */ }
};

const status = $('status');
const say = (html: string, err = false) => { status.innerHTML = html; status.classList.toggle('err', err); };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '39' } as Record<string, string>)[c]};`);
const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

await loadFonts();

// Tabs
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    if (tab.dataset.tab === 'style') drawThumbs();
  });
}

// Preview
const screen = $('screen');
const player = new Player($<HTMLCanvasElement>('preview'), state);
const sound = new Sound(() => state);
player.audio = sound;
const muteBtn = $('mute');
try { sound.muted = localStorage.getItem('klix-muted') === '1'; } catch { /* storage blocked */ }
muteBtn.setAttribute('aria-pressed', String(sound.muted));
muteBtn.addEventListener('click', () => {
  sound.muted = !sound.muted;
  muteBtn.setAttribute('aria-pressed', String(sound.muted));
  try { localStorage.setItem('klix-muted', sound.muted ? '1' : '0'); } catch { /* storage blocked */ }
  if (sound.muted) sound.stop(); else if (player.playing) sound.start(player.time);
});
player.loop = false;
const scrub = $<HTMLInputElement>('scrub');
const sceneBox = $('scenes');
let wasPlaying = false;
let lastPlaying = false;
player.onTime = (t, total) => {
  $('time').textContent = `${fmt(t)} / ${fmt(total)}`;
  scrub.value = String(Math.round((t / total) * 1000));
  scrub.style.setProperty('--p', `${(t / total) * 100}%`);
  if (player.playing !== lastPlaying) {
    lastPlaying = player.playing;
    screen.classList.toggle('playing', player.playing);
    document.body.classList.toggle('playing-state', player.playing);
  }
  // The big play button only invites the first play; after that the transport bar does the job.
  if (player.playing) screen.classList.add('started');
  for (const chip of sceneBox.children as HTMLCollectionOf<HTMLElement>) {
    const a = Number(chip.dataset.start);
    const d = Number(chip.dataset.dur);
    chip.classList.toggle('on', t >= a && t < a + d);
    chip.style.setProperty('--f', `${Math.min(1, Math.max(0, (t - a) / d)) * 100}%`);
  }
};
const toggle = () => (player.playing ? player.pause() : player.play());
$('play').addEventListener('click', toggle);
$('big-play').addEventListener('click', toggle);
$('preview').addEventListener('click', toggle);
scrub.addEventListener('pointerdown', () => { wasPlaying = player.playing; player.pause(); });
scrub.addEventListener('input', () => player.seek((Number(scrub.value) / 1000) * player.total));
scrub.addEventListener('change', () => { if (wasPlaying) player.play(); });
addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  if (e.code === 'Space' && !typing) { e.preventDefault(); toggle(); }
});

function renderScenes() {
  const names: Record<string, string> = { name: 'Title', intro: 'Hook', shot: 'Product', code: 'Code', stats: 'Numbers', stat: 'Number', outro: 'Close', flash: 'Flash' };
  const total = duration(state);
  sceneBox.replaceChildren(...timeline(state).map((sc) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scene';
    b.dataset.start = String(sc.start);
    b.dataset.dur = String(sc.dur);
    b.style.flexGrow = String(sc.dur / total);
    b.innerHTML = `<b>${sc.kind === 'beat' ? `Feature ${sc.i + 1}` : sc.kind === 'flash' && sc.text === 'Introducing' ? 'Open' : names[sc.kind]}</b><small>${sc.dur.toFixed(1)}s</small>`;
    b.addEventListener('click', () => player.seek(sc.start + Math.min(sc.dur * 0.6, 1.8)));
    return b;
  }));
}

let thumbTimer = 0;
const refresh = () => {
  player.set(state);
  clearExport();
  renderScenes();
  syncReadouts();
  player.draw();
  save();
  void renderMusic(state);
  clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(drawThumbs, 250);
};

// Script fields
const hook = $<HTMLInputElement>('f-hook');
const tagline = $<HTMLTextAreaElement>('f-tagline');
const cta = $<HTMLInputElement>('f-cta');
const lang = $<HTMLInputElement>('f-lang');
const code = $<HTMLTextAreaElement>('f-code');
const beats = $('beats');

function counter(name: 'hook' | 'tagline' | 'cta', value: string) {
  const el = document.querySelector<HTMLElement>(`[data-count="${name}"]`)!;
  const max = LIMITS[name];
  el.textContent = `${value.length}/${max}`;
  el.classList.toggle('over', value.length > max);
}

function renderBeats() {
  beats.replaceChildren();
  state.script.beats.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = 'beat';
    const head = document.createElement('div');
    head.className = 'beat-head';
    head.append(`Feature ${String(i + 1).padStart(2, '0')}`);
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Remove';
    del.disabled = state.script.beats.length <= 1;
    del.addEventListener('click', () => { state.script.beats.splice(i, 1); renderBeats(); refresh(); });
    head.append(del);
    const title = document.createElement('input');
    title.value = b.title;
    title.maxLength = 40;
    title.setAttribute('aria-label', `Feature ${i + 1} title`);
    title.addEventListener('input', () => { b.title = title.value; refresh(); });
    const body = document.createElement('textarea');
    body.rows = 2;
    body.value = b.body;
    body.maxLength = 120;
    body.setAttribute('aria-label', `Feature ${i + 1} text`);
    body.addEventListener('input', () => { b.body = body.value; refresh(); });
    card.append(head, title, body);
    beats.append(card);
  });
  $<HTMLButtonElement>('add-beat').disabled = state.script.beats.length >= LIMITS.beatsMax;
}

function fillFields(s: VideoScript) {
  hook.value = s.hook;
  tagline.value = s.tagline;
  cta.value = s.cta;
  lang.value = s.code.lang;
  code.value = s.code.text;
  counter('hook', s.hook);
  counter('tagline', s.tagline);
  counter('cta', s.cta);
  renderBeats();
}

hook.addEventListener('input', () => { state.script.hook = hook.value; counter('hook', hook.value); refresh(); });
tagline.addEventListener('input', () => { state.script.tagline = tagline.value; counter('tagline', tagline.value); refresh(); });
cta.addEventListener('input', () => { state.script.cta = cta.value; counter('cta', cta.value); refresh(); });
lang.addEventListener('input', () => { state.script.code.lang = lang.value; refresh(); });
code.addEventListener('input', () => { state.script.code.text = code.value; refresh(); });
$('add-beat').addEventListener('click', () => {
  if (state.script.beats.length >= LIMITS.beatsMax) return;
  state.script.beats.push({ title: 'New feature', body: 'Say what it does in one line.' });
  renderBeats();
  refresh();
});

// Style: one card per style, each with a live still of the current script.
const styleBox = $('styles');
const thumbs: { canvas: HTMLCanvasElement; id: string }[] = [];
for (const st of STYLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'style-card';
  b.dataset.v = st.id;
  const canvas = document.createElement('canvas');
  const name = document.createElement('b');
  name.textContent = st.label;
  const blurb = document.createElement('small');
  blurb.textContent = st.blurb;
  b.append(canvas, name, blurb);
  b.addEventListener('click', () => {
    Object.assign(state, withStyle(state, st.id));
    syncControls();
    refresh();
  });
  b.addEventListener('pointerenter', () => drawThumb(canvas, st.id, true));
  styleBox.append(b);
  thumbs.push({ canvas, id: st.id });
}
function drawThumb(canvas: HTMLCanvasElement, id: string, beat = false) {
  const input = state.real ? { ...withStyle({ ...state, format: 'square' as const }, id), accent: '' } : { ...sampleFor(id), format: 'square' as const };
  const scenes = timeline(input);
  const t = beat ? scenes[1].start + scenes[1].dur * 0.7 : scenes[0].start + scenes[0].dur * 0.75;
  still(canvas, input, t, 320);
}
function drawThumbs() {
  if (document.querySelector<HTMLElement>('[data-panel="style"]')!.hidden) return;
  for (const x of thumbs) drawThumb(x.canvas, x.id);
}

const themeBox = $('themes');
for (const th of THEMES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'theme';
  b.dataset.v = th.id;
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background = `radial-gradient(90% 120% at 0% 0%, ${th.accents[0]}, transparent 62%), radial-gradient(90% 120% at 100% 100%, ${th.accents[2]}, transparent 62%), linear-gradient(${th.bg}, ${th.bg2})`;
  b.append(sw, th.label);
  b.addEventListener('click', () => { state.theme = th; syncControls(); refresh(); });
  themeBox.append(b);
}

const accent = $<HTMLInputElement>('f-accent');
accent.addEventListener('input', () => { state.accent = accent.value; syncControls(); refresh(); });
$('accent-reset').addEventListener('click', () => { state.accent = ''; syncControls(); refresh(); });

const transitionSel = $<HTMLSelectElement>('f-transition');
transitionSel.append(new Option('Style default', 'auto'), ...TRANSITIONS.map((x) => new Option(x.label, x.id)));
transitionSel.addEventListener('change', () => { state.transition = transitionSel.value as Options['transition']; refresh(); });

// Type
const fontBox = $('fonts');
for (const f of [{ id: 'auto', label: 'Style default', family: '', weight: 400 }, ...FONTS]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'font-card';
  b.dataset.v = f.id;
  const sample = document.createElement('span');
  sample.textContent = 'Aa';
  const name = document.createElement('small');
  name.textContent = f.label;
  b.append(sample, name);
  b.addEventListener('click', () => { state.font = f.id; syncControls(); refresh(); });
  fontBox.append(b);
}
const scale = $<HTMLInputElement>('f-scale');
scale.addEventListener('input', () => { state.scale = Number(scale.value) / 100; syncControls(); refresh(); });

// Output
const aspectBox = $('aspects');
for (const f of FORMATS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'aspect';
  b.dataset.v = f.id;
  const shape = document.createElement('span');
  shape.className = 'aspect-shape';
  const [a, c] = f.ratio;
  shape.style.aspectRatio = `${a} / ${c}`;
  shape.style[a >= c ? 'width' : 'height'] = '34px';
  b.append(shape);
  b.insertAdjacentHTML('beforeend', `<b>${f.label}</b><small>${f.ratio.join(':')} · ${f.note}</small>`);
  b.addEventListener('click', () => { state.format = f.id; syncControls(); refresh(); });
  aspectBox.append(b);
}
const resSeg = document.querySelector<HTMLElement>('[data-seg="resolution"]')!;
for (const r of RESOLUTIONS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.v = String(r.id);
  b.textContent = r.label;
  resSeg.append(b);
}
for (const seg of document.querySelectorAll<HTMLElement>('[data-seg]')) {
  const key = seg.dataset.seg as keyof Options;
  seg.setAttribute('role', 'radiogroup');
  for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      (state as unknown as Record<string, unknown>)[key] = seg.hasAttribute('data-num') ? Number(b.dataset.v) : b.dataset.v;
      syncControls();
      refresh();
    });
  }
}

// Sound: one card per track, plus the style's own and off.
const trackBox = $('tracks');
for (const tr of [{ id: 'auto', label: 'Style default', bpm: 0, mood: 'The track picked for this style' }, ...TRACKS, { id: 'off', label: 'No music', bpm: 0, mood: 'Picture only, silent file' }]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'track';
  b.dataset.v = tr.id;
  b.innerHTML = `<span class="eq"><i></i><i></i><i></i></span><b>${tr.label}</b><small>${tr.mood}</small>${tr.bpm ? `<span class="bpm">${tr.bpm} BPM</span>` : ''}`;
  b.addEventListener('click', () => {
    state.music = tr.id;
    syncControls();
    refresh();
    if (tr.id !== 'off' && !player.playing) { if (sound.muted) muteBtn.click(); player.play(); }
  });
  trackBox.append(b);
}
const volume = $<HTMLInputElement>('f-volume');
volume.addEventListener('change', () => { state.volume = Number(volume.value) / 100; syncControls(); refresh(); });
volume.addEventListener('input', () => { $('volume-val').textContent = `${volume.value}%`; volume.style.setProperty('--p', `${volume.value}%`); });

// Toggles: scenes and effects
for (const box of document.querySelectorAll<HTMLInputElement>('[data-opt]')) {
  box.addEventListener('change', () => {
    const key = box.dataset.opt as 'code' | 'stats' | 'grain' | 'vignette' | 'letterbox' | 'camera' | 'hud' | 'object';
    state[key] = box.checked;
    refresh();
  });
}
$('reset-style').addEventListener('click', () => { Object.assign(state, withStyle(state, state.style)); syncControls(); refresh(); });

/** Puts every control in step with the state. */
function syncControls() {
  const st = styleOf(state.style);
  const pick = (box: Element, v: string) => box.querySelectorAll<HTMLElement>('[data-v]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.v === v)));
  pick(styleBox, state.style);
  pick(themeBox, state.theme.id);
  pick(fontBox, state.font);
  pick(aspectBox, state.format);
  for (const seg of document.querySelectorAll<HTMLElement>('[data-seg]')) pick(seg, String(state[seg.dataset.seg as keyof Options]));
  for (const box of document.querySelectorAll<HTMLInputElement>('[data-opt]')) box.checked = Boolean(state[box.dataset.opt as keyof Options]);
  const statsBox = document.querySelector<HTMLInputElement>('[data-opt="stats"]')!;
  statsBox.disabled = false;
  $('stats-note').hidden = true;
  $('style-name').textContent = st.label;
  $('font-name').textContent = state.font === 'auto' ? `${faceOf(st.font).label}, from ${st.label}` : faceOf(state.font).label;
  transitionSel.value = state.transition;
  pick(trackBox, state.music);
  const tr = trackOf(state);
  $('track-name').textContent = tr ? `${tr.label}, ${tr.bpm} BPM` : 'Off';
  volume.value = String(Math.round(state.volume * 100));
  volume.style.setProperty('--p', `${volume.value}%`);
  $('volume-val').textContent = `${volume.value}%`;
  $('edit-note').textContent = EDITS.find((x) => x.id === editOf(state))!.note + '.';
  transitionSel.options[0].text = `Style default (${TRANSITIONS.find((x) => x.id === st.transition)!.label})`;
  scale.value = String(Math.round(state.scale * 100));
  scale.style.setProperty('--p', `${((state.scale * 100 - 80) / 50) * 100}%`);
  $('scale-val').textContent = `${Math.round(state.scale * 100)}%`;
  accent.value = state.accent || state.theme.accents[0];
  $('accent-hex').textContent = state.accent ? state.accent.toUpperCase() : 'Palette';
  screen.dataset.format = state.format;
  for (const b of fontBox.querySelectorAll<HTMLElement>('.font-card')) {
    const f = faceOf(b.dataset.v === 'auto' ? st.font : b.dataset.v!);
    const span = b.querySelector('span')!;
    span.style.fontFamily = f.family;
    span.style.fontWeight = String(f.weight);
  }
}

/** Numbers that follow from the settings: size, length, bitrate. */
function syncReadouts() {
  const [w, h] = frameSize(state.format, state.resolution);
  const secs = duration(state);
  const mbps = bitrate(state) / 1e6;
  const mb = (mbps * secs) / 8;
  const fmtName = FORMATS.find((f) => f.id === state.format)!;
  $('dims').textContent = `${w} x ${h}`;
  $('meta-style').textContent = `${styleOf(state.style).label} · ${state.theme.label}`;
  $('meta-spec').textContent = `${w} x ${h} · ${state.fps} fps · ${secs.toFixed(1)} s`;
  $('spec').innerHTML = [
    ['Frame', `${w} x ${h} (${fmtName.ratio.join(':')})`],
    ['Length', `${secs.toFixed(1)} seconds, ${timeline(state).length} scenes`],
    ['Bitrate', `${mbps.toFixed(1)} Mbps`],
    ['File', `about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`],
  ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
  $('export-spec').textContent = `${styleOf(state.style).label}, ${w} x ${h}, ${state.fps} fps, ${secs.toFixed(1)} s, about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const type = recordingType(w, h, Boolean(trackOf(state)));
  const note = $('export-note');
  const frameByFrame = typeof VideoEncoder !== 'undefined';
  if (frameByFrame) note.textContent = `Rendered frame by frame on your machine, exact at ${state.fps} fps. You can switch tabs while it works.`;
  else if (!type) note.textContent = 'This browser cannot record video. Open Klix in Chrome or Edge.';
  else if (!type.startsWith('video/mp4')) note.textContent = 'This browser saves WebM. X needs MP4, which Chrome and Edge save.';
  else note.textContent = `Recorded in real time, so the frame rate is capped by your screen (usually 60). Use Chrome or Edge for exact ${state.fps} fps.`;
  $('export-label').textContent = exporting ? $('export-label').textContent : `Export ${frameByFrame || type.startsWith('video/mp4') ? 'MP4' : type ? 'WebM' : ''}`.trim();
}

// Server
fetch('/api/health').then((r) => r.json()).then((h: { mode: string; model: string }) => {
  const m = $('mode');
  m.textContent = h.mode === 'claude' ? 'Claude online' : 'Test mode';
  m.classList.toggle('live', h.mode === 'claude');
  m.title = h.mode === 'claude' ? `Scripts by ${h.model}` : 'No API key on the server. Scripts come from simple rules.';
}).catch(() => { $('mode').textContent = 'Server offline'; });

const panel = document.querySelector('.panel')!;
const repoInput = $<HTMLInputElement>('repo');

/** What the server needs to know about the options, so Claude can only pick ones that exist. */
const catalog = () => ({
  styles: STYLES.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb })),
  palettes: [...(siteTheme ? [{ id: 'site', label: `${siteTheme.label} (the website's own colours)` }] : []), ...THEMES.map((t) => ({ id: t.id, label: t.label }))],
  fonts: FONTS.map((f) => ({ id: f.id, label: f.label })),
  tracks: TRACKS.map((t) => ({ id: t.id, label: t.label, mood: t.mood })),
  transitions: TRANSITIONS.map((t) => ({ id: t.id, label: t.label })),
});

function busy(on: boolean) {
  panel.classList.toggle('busy', on);
  for (const id of ['go', 'rewrite', 'direct']) $<HTMLButtonElement>(id).disabled = on;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `Server answered ${r.status}`);
  return data;
}

function loaded(data: ScriptResponse, label: string, query: string) {
  const view: RepoView = data.repo;
  const site = data.repo.kind === 'site';
  Object.assign(state, { repo: view, script: data.script, real: true, fullName: data.repo.fullName, by: data.by, stats: !site, code: site ? false : state.code });
  $('rewrite').hidden = data.by !== 'claude';
  $('source-meta').textContent = label;
  history.replaceState(null, '', `/make?${query}`);
}

async function generate(repo: string, fresh = false) {
  busy(true);
  say(`Reading <b>${esc(repo)}</b> and writing the script…`);
  try {
    const data = await post<ScriptResponse>('/api/script', { repo, fresh });
    loaded(data, data.repo.fullName, `repo=${encodeURIComponent(data.repo.fullName)}`);
    fillFields(state.script);
    syncControls();
    const who = data.by === 'claude' ? 'Claude' : 'simple rules (test mode, no Claude)';
    say(`<b>${esc(data.repo.fullName)}</b> loaded. Script by ${who}${data.cached ? ', from cache' : ''}. Edit anything, pick a style, or describe the video you want.`);
    player.seek(0);
    refresh();
    player.play();
  } catch (e) {
    say(esc((e as Error).message), true);
  } finally {
    busy(false);
  }
}

// Website mode: the words come from the page, the colours and font from the site's own CSS.
let siteTheme: Theme | null = null;

function siteSwatch() {
  let b = document.getElementById('site-theme') as HTMLButtonElement | null;
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.id = 'site-theme';
    b.className = 'theme theme-site';
    b.dataset.v = 'site';
    b.addEventListener('click', () => { if (siteTheme) { state.theme = siteTheme; syncControls(); refresh(); } });
    themeBox.prepend(b);
  }
  const th = siteTheme!;
  b.innerHTML = `<span class="swatch" style="background: radial-gradient(90% 120% at 0% 0%, ${th.accents[0]}, transparent 62%), radial-gradient(90% 120% at 100% 100%, ${th.accents[1]}, transparent 62%), linear-gradient(${th.bg}, ${th.bg2})"></span>From ${esc(state.repo.owner)}`;
}

function siteFontCard(family: string) {
  let b = fontBox.querySelector<HTMLButtonElement>('[data-v="site"]');
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'font-card';
    b.dataset.v = 'site';
    b.addEventListener('click', () => { state.font = 'site'; syncControls(); refresh(); });
    fontBox.append(b);
  }
  b.innerHTML = `<span>Aa</span><small>${esc(family)} (site)</small>`;
}

async function generateSite(url: string, fresh = false) {
  busy(true);
  say(`Reading <b>${esc(url)}</b>, its colours and fonts, and writing the script…`);
  try {
    const data = await post<ScriptResponse>('/api/site', { url, fresh, catalog: catalog() });
    loaded(data, data.repo.owner, `site=${encodeURIComponent(url)}`);
    const look = data.look;
    let fontNote = '';
    if (look) {
      Object.assign(state, withStyle(state, look.style));
      siteTheme = { id: 'site', label: data.repo.name, bg: look.bg, bg2: look.bg2, ink: look.ink, muted: look.ink + (look.light ? 'a0' : '99'), accents: look.accents, light: look.light };
      state.theme = siteTheme;
      state.accent = '';
      state.stats = false;
      state.code = false;
      siteSwatch();
      state.font = look.nearestFont || 'auto';
      fontNote = `closest font ${faceOf(state.font).label}`;
      if (look.fontFamily && await loadWebFont(look.fontFamily)) {
        registerSiteFace(look.fontFamily);
        siteFontCard(look.fontFamily);
        state.font = 'site';
        fontNote = `its own font ${look.fontFamily}`;
      }
    }
    await preloadImages(state);
    fillFields(state.script);
    syncControls();
    const who = data.by === 'claude' ? 'Claude' : 'simple rules (test mode, no Claude)';
    say(`<b>${esc(data.repo.owner)}</b> loaded in its own colours, ${esc(fontNote)}${data.repo.image ? ', with its preview image as the product shot' : ''}. Script by ${who}${data.cached ? ', from cache' : ''}.`);
    player.seek(0);
    refresh();
    player.play();
  } catch (e) {
    say(esc((e as Error).message), true);
  } finally {
    busy(false);
  }
}

let kind: 'repo' | 'site' = 'repo';
function setKind(k: 'repo' | 'site') {
  kind = k;
  document.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === k)));
  $('source-prefix').textContent = k === 'repo' ? 'github.com/' : 'https://';
  repoInput.placeholder = k === 'repo' ? 'owner/repo' : 'yoursite.com';
  repoInput.setAttribute('aria-label', k === 'repo' ? 'GitHub repo' : 'Website address');
}
document.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.addEventListener('click', () => { setKind(b.dataset.kind as 'repo' | 'site'); repoInput.focus(); }));

$('repo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (kind === 'site') {
    const url = repoInput.value.trim().replace(/^https?:\/\//i, '');
    if (!/^[^\s/]+\.[^\s/]{2,}/.test(url)) return say('Paste a website address, for example linear.app.', true);
    return generateSite(url);
  }
  const repo = cleanRepo(repoInput.value);
  if (!repo) return say('Use the form owner/repo, for example vitejs/vite.', true);
  repoInput.value = repo;
  generate(repo);
});
$('rewrite').addEventListener('click', () => {
  if (!state.fullName) return;
  if (state.repo.kind === 'site') generateSite(state.repo.url, true); else generate(state.fullName, true);
});

// Describe: the visitor writes what they want; Claude sets the options and, if asked, rewrites the words.
interface Direction { notes: string; settings: Record<string, unknown>; script: Omit<VideoScript, 'code'> | null }
const DIRECTED: (keyof Options)[] = ['music', 'edit', 'transition', 'format', 'fps', 'resolution', 'align', 'case', 'scale', 'accent', 'grain', 'vignette', 'letterbox', 'camera', 'object', 'hud', 'code', 'stats'];

async function directVideo(brief: string) {
  busy(true);
  say('Claude is reading your description and setting up the video…');
  try {
    const settings: Record<string, unknown> = { style: state.style, palette: state.theme.id, font: state.font };
    for (const k of DIRECTED) settings[k] = state[k];
    const r = state.repo;
    const facts = { kind: r.kind ?? 'repo', name: r.name, owner: r.owner, url: r.url, stars: r.stars, forks: r.forks, language: r.language, release: r.release };
    const d = await post<Direction>('/api/direct', { brief, catalog: catalog(), current: { script: state.script, facts, settings } });
    const s = d.settings;
    const theme = state.theme;
    const font = state.font;
    Object.assign(state, withStyle(state, String(s.style)));
    state.theme = s.palette === 'keep' ? theme : s.palette === 'site' && siteTheme ? siteTheme : THEMES.find((t) => t.id === s.palette) ?? state.theme;
    state.font = s.font === 'keep' ? font : String(s.font);
    for (const k of DIRECTED) if (k in s) (state as unknown as Record<string, unknown>)[k] = s[k];
    if (d.script) { state.script = { ...d.script, code: state.script.code }; fillFields(state.script); }
    syncControls();
    say(`<b>Claude:</b> ${esc(d.notes)}`);
    player.seek(0);
    refresh();
    player.play();
  } catch (e) {
    say(esc((e as Error).message), true);
  } finally {
    busy(false);
  }
}

const brief = $<HTMLTextAreaElement>('brief');
$('brief-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = brief.value.trim();
  if (text.length < 4) { brief.focus(); return say('Describe the video you want in a sentence or two.', true); }
  directVideo(text);
});
for (const chip of $('brief-chips').querySelectorAll('button')) chip.addEventListener('click', () => { brief.value = chip.textContent ?? ''; brief.focus(); });

// Export
let exporting = false;
let fileUrl = '';
let file: File | null = null;
function clearExport() {
  if (!fileUrl) return;
  URL.revokeObjectURL(fileUrl);
  fileUrl = '';
  file = null;
  $('done').hidden = true;
}

$('export').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('export');
  const [w, h] = frameSize(state.format, state.resolution);
  if (typeof VideoEncoder === 'undefined' && !recordingType(w, h, Boolean(trackOf(state)))) return;
  clearExport();
  player.pause();
  btn.disabled = true;
  exporting = true;
  $('progress').hidden = false;
  const bar = $('progress-bar');
  const { real: _r, fullName: _f, by: _b, ...input } = state;
  const snapshot: RenderInput = structuredClone(input);
  try {
    const { blob, ext: e, audio } = await record(snapshot, (p) => {
      bar.style.width = `${p * 100}%`;
      $('export-label').textContent = `Rendering ${Math.round(p * 100)}%`;
    });
    fileUrl = URL.createObjectURL(blob);
    const a = $<HTMLAnchorElement>('download');
    a.href = fileUrl;
    a.download = `${(state.real ? state.repo.name : 'klix-sample').replace(/[^\w.-]/g, '-')}-${state.style}-${w}x${h}.${e}`;
    file = new File([blob], a.download, { type: blob.type });
    $('size').textContent = `${e.toUpperCase()}, ${w} x ${h}, ${audio ? 'with sound' : 'no sound'}, ${(blob.size / 1e6).toFixed(1)} MB`;
    $('done').hidden = false;
  } catch (err) {
    say(esc((err as Error).message), true);
  } finally {
    exporting = false;
    btn.disabled = false;
    $('progress').hidden = true;
    bar.style.width = '0';
    syncReadouts();
  }
});

/** The words for the post: hook, tagline, the link, and a credit to Klix on X. */
const postText = () => `${state.script.hook}\n\n${state.script.tagline}\n\n${state.repo.url}\n\nMade with @useklix`;

// Share to X. On a phone the share sheet carries the MP4 itself, so it lands in the X app attached.
// On a computer X has no way to receive a file from another site: the MP4 downloads, and X opens with the text filled in.
$('share-x').addEventListener('click', async () => {
  if (file && matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: postText() });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  $<HTMLAnchorElement>('download').click();
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(postText())}`, '_blank', 'noopener');
  say('X is open in a new tab with your post text. Drag in the MP4 that just downloaded.');
});

$('copy-post').addEventListener('click', async () => {
  const text = postText();
  await navigator.clipboard.writeText(text);
  const b = $('copy-post');
  b.textContent = 'Copied';
  setTimeout(() => (b.textContent = 'Copy post text'), 1600);
});

// Start: the sample, or the repo from ?repo=
state.stats = true;
say(`Showing <b>${esc(state.repo.owner)}/${esc(state.repo.name)}</b> as a sample, with GitHub numbers from ${SAMPLES_DATE}. Paste a public repo to make yours.`);
fillFields(state.script);
syncControls();
refresh();
player.seek(timeline(state)[0].dur * 0.8);
// Links from the landing page: ?mode=site opens website mode, ?focus=describe jumps to the Describe box.
const params = new URLSearchParams(location.search);
if (params.get('mode') === 'site') { setKind('site'); repoInput.focus(); }
if (params.get('focus') === 'describe') { brief.focus(); brief.scrollIntoView({ block: 'center' }); }
const fromSite = new URLSearchParams(location.search).get('site');
if (fromSite) { setKind('site'); repoInput.value = fromSite; generateSite(fromSite); }
const fromUrl = cleanRepo(new URLSearchParams(location.search).get('repo') ?? '');
if (fromUrl) {
  repoInput.value = fromUrl;
  generate(fromUrl);
}
