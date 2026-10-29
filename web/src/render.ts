// Draws a Klix video on a canvas, frame by frame. The same code drives the live preview, the thumbnails and the export.
// A frame is built in layers: backdrop, scene content (laid out, then animated by the style), transition, overlays, HUD.
import type { RepoFacts, VideoScript } from '../../shared/script.ts';
import { renderMusic, audioContext } from './music.ts';
import { prismFrame } from './prism.ts';
import { encodeOffline } from './encode.ts';

export interface Theme {
  id: string;
  label: string;
  bg: string;
  bg2: string;
  ink: string;
  muted: string;
  accents: [string, string, string];
  light?: boolean;
}

export const THEMES: Theme[] = [
  { id: 'noir', label: 'Noir', bg: '#040404', bg2: '#121212', ink: '#f6f2ec', muted: 'rgba(246,242,236,0.56)', accents: ['#f1dcc4', '#c9b8ff', '#9cc7ff'] },
  { id: 'pearl', label: 'Pearl', bg: '#070505', bg2: '#2a1418', ink: '#f8f0e8', muted: 'rgba(248,240,232,0.6)', accents: ['#ffb38a', '#f2a7c8', '#c9a8ff'] },
  { id: 'volt', label: 'Volt', bg: '#0a0a0a', bg2: '#181818', ink: '#ffffff', muted: 'rgba(255,255,255,0.6)', accents: ['#d4ff1e', '#ff4a1c', '#f2f2f2'] },
  { id: 'teal', label: 'Blockbuster', bg: '#020507', bg2: '#06202b', ink: '#f6efe4', muted: 'rgba(246,239,228,0.6)', accents: ['#ff9a4a', '#35cfe0', '#ffd8a0'] },
  { id: 'cyber', label: 'Cyber', bg: '#05040b', bg2: '#140a2a', ink: '#f2f6ff', muted: 'rgba(242,246,255,0.6)', accents: ['#00f0ff', '#ff2bd6', '#f6ff3a'] },
  { id: 'acid', label: 'Acid', bg: '#060807', bg2: '#0d2116', ink: '#f1fff4', muted: 'rgba(241,255,244,0.6)', accents: ['#c6ff3d', '#3dffb5', '#3dc2ff'] },
  { id: 'orchid', label: 'Orchid', bg: '#0a0610', bg2: '#260d33', ink: '#fbf0ff', muted: 'rgba(251,240,255,0.62)', accents: ['#d06bff', '#ff5ca8', '#ffb36b'] },
  { id: 'ocean', label: 'Ocean', bg: '#040a12', bg2: '#0b2340', ink: '#eef6ff', muted: 'rgba(238,246,255,0.6)', accents: ['#5cc8ff', '#7b8cff', '#3dffd0'] },
  { id: 'sunset', label: 'Sunset', bg: '#0d0605', bg2: '#3a1208', ink: '#fff3ea', muted: 'rgba(255,243,234,0.62)', accents: ['#ff6a3d', '#ffb13d', '#ff3d7f'] },
  { id: 'snow', label: 'Snow', bg: '#f5f5f7', bg2: '#e6e6eb', ink: '#1d1d1f', muted: 'rgba(29,29,31,0.58)', accents: ['#0071e3', '#7d5cff', '#ff375f'], light: true },
  { id: 'paper', label: 'Paper', bg: '#f4eee3', bg2: '#e6d9c3', ink: '#17120d', muted: 'rgba(23,18,13,0.62)', accents: ['#e8431f', '#2a3bb5', '#c98a12'], light: true },
  { id: 'gold', label: 'Gold', bg: '#070605', bg2: '#1a140c', ink: '#f7efe0', muted: 'rgba(247,239,224,0.58)', accents: ['#e0b15a', '#f5dfae', '#a8763a'] },
  { id: 'silver', label: 'Silver', bg: '#080808', bg2: '#1c1c1c', ink: '#f2f2f2', muted: 'rgba(242,242,242,0.55)', accents: ['#d9d9d9', '#9a9a9a', '#ffffff'] },
  { id: 'candy', label: 'Candy', bg: '#1a0630', bg2: '#4a0f6b', ink: '#fff6fb', muted: 'rgba(255,246,251,0.66)', accents: ['#ff4fa3', '#ffd23f', '#3ee6ff'] },
  { id: 'blueprint', label: 'Blueprint', bg: '#0b2a5b', bg2: '#123a7a', ink: '#eef5ff', muted: 'rgba(238,245,255,0.62)', accents: ['#7fd3ff', '#ffffff', '#ffcf5c'] },
  { id: 'concrete', label: 'Concrete', bg: '#e9e8e4', bg2: '#d8d6d0', ink: '#111111', muted: 'rgba(17,17,17,0.6)', accents: ['#ff4d00', '#111111', '#7a7a7a'], light: true },
];

export type Format = 'square' | 'portrait' | 'vertical' | 'landscape';
export const FORMATS: { id: Format; label: string; ratio: [number, number]; note: string }[] = [
  { id: 'square', label: 'Square', ratio: [1, 1], note: 'X and LinkedIn feed' },
  { id: 'portrait', label: 'Portrait', ratio: [4, 5], note: 'Instagram feed' },
  { id: 'vertical', label: 'Vertical', ratio: [9, 16], note: 'Reels, Shorts, TikTok' },
  { id: 'landscape', label: 'Landscape', ratio: [16, 9], note: 'YouTube and wide posts' },
];
export const RESOLUTIONS = [
  { id: 720, label: '720p' },
  { id: 1080, label: '1080p' },
  { id: 1440, label: '1440p' },
  { id: 2160, label: '4K' },
];

/** Pixel size of a frame. The short side is the resolution. */
export function frameSize(format: Format, res: number): [number, number] {
  const [a, b] = (FORMATS.find((f) => f.id === format) ?? FORMATS[0]).ratio;
  const even = (n: number) => Math.round(n / 2) * 2;
  return a >= b ? [even((res * a) / b), res] : [res, even((res * b) / a)];
}

const SERIF = '"Instrument Serif", Georgia, serif';
const SANS = '"Geist", "Segoe UI", system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, Consolas, monospace';

/** Display faces. `size` evens out how large each face reads at the same pixel size. */
export interface Face { id: string; label: string; family: string; weight: number; italic: boolean; size: number; track: number }
export const FONTS: Face[] = [
  { id: 'instrument', label: 'Instrument Serif', family: SERIF, weight: 400, italic: true, size: 1, track: -0.01 },
  { id: 'playfair', label: 'Playfair Display', family: '"Playfair Display", Georgia, serif', weight: 600, italic: true, size: 0.84, track: -0.015 },
  { id: 'geist', label: 'Geist', family: SANS, weight: 600, size: 0.8, italic: false, track: -0.045 },
  { id: 'grotesk', label: 'Space Grotesk', family: '"Space Grotesk", sans-serif', weight: 700, size: 0.8, italic: false, track: -0.04 },
  { id: 'syne', label: 'Syne', family: '"Syne", sans-serif', weight: 700, size: 0.8, italic: false, track: -0.035 },
  { id: 'bebas', label: 'Bebas Neue', family: '"Bebas Neue", Impact, sans-serif', weight: 400, size: 1.08, italic: false, track: 0.005 },
  { id: 'unbounded', label: 'Unbounded', family: '"Unbounded", sans-serif', weight: 700, size: 0.68, italic: false, track: -0.03 },
  { id: 'jetbrains', label: 'JetBrains Mono', family: '"JetBrains Mono", ui-monospace, monospace', weight: 700, size: 0.7, italic: false, track: -0.03 },
];

export type Enter = 'rise' | 'fade' | 'slam' | 'type' | 'mask' | 'glitch' | 'blur' | 'flicker';
export type Transition = 'fade' | 'black' | 'wipe' | 'push' | 'zoom' | 'glitch' | 'cut';
export const TRANSITIONS: { id: Transition; label: string }[] = [
  { id: 'fade', label: 'Cross fade' },
  { id: 'black', label: 'Dip to black' },
  { id: 'wipe', label: 'Color wipe' },
  { id: 'push', label: 'Push' },
  { id: 'zoom', label: 'Zoom through' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'cut', label: 'Hard cut' },
];

/** How the cut is paced. Every shot lands on the beat of the music. */
export type Edit = 'fast' | 'balanced' | 'slow';
export const EDITS: { id: Edit; label: string; note: string }[] = [
  { id: 'fast', label: 'Fast cuts', note: 'Flash titles, one idea per shot, cut on the beat' },
  { id: 'balanced', label: 'Balanced', note: 'One scene per idea, cut on the bar' },
  { id: 'slow', label: 'Slow', note: 'Long shots that breathe, trailer pacing' },
];

/** Music made in the browser, in time with the cut. */
export interface Track { id: string; label: string; bpm: number; mood: string }
export const TRACKS: Track[] = [
  { id: 'drive', label: 'Drive', bpm: 124, mood: 'Driving house, four on the floor' },
  { id: 'retro', label: 'Retro', bpm: 108, mood: 'Synthwave arps and a big snare' },
  { id: 'break', label: 'Break', bpm: 140, mood: 'Half-time beat with stuttering hats' },
  { id: 'epic', label: 'Epic', bpm: 84, mood: 'Trailer booms, low strings, risers' },
  { id: 'glow', label: 'Glow', bpm: 112, mood: 'Warm, bright chill house' },
  { id: 'soft', label: 'Soft', bpm: 92, mood: 'Lo-fi keys and a gentle beat' },
  { id: 'pulse', label: 'Pulse', bpm: 120, mood: 'Minimal techno with bleeps' },
];
type Backdrop = 'pools' | 'beams' | 'plain' | 'stripes' | 'scan' | 'grid' | 'blocks' | 'horizon' | 'aurora' | 'mesh' | 'spot';

/** A video style: how type is set, how it enters, how scenes change and what sits behind it. */
export interface Style {
  id: string;
  label: string;
  blurb: string;
  font: string;
  body: 'sans' | 'mono';
  hook: 'display' | 'body';
  upper: boolean;
  italic: boolean;
  align: 'left' | 'center';
  enter: Enter;
  transition: Transition;
  backdrop: Backdrop;
  number: 'outline' | 'tag' | 'giant';
  radius: number;
  glow: number;
  size: number;
  /** Palette the style starts with. */
  palette: string;
  /** Shows the glass Klix prism on the title and closing shots. */
  object: boolean;
  edit: Edit;
  music: string;
  words: boolean;
  grain: boolean;
  vignette: boolean;
  letterbox: boolean;
  camera: boolean;
}

export const STYLES: Style[] = [
  { id: 'editorial', label: 'Editorial', blurb: 'Serif headlines that rise into place over soft light.', palette: 'noir', object: true, font: 'instrument', body: 'sans', hook: 'body', upper: false, italic: true, align: 'left', enter: 'rise', transition: 'fade', backdrop: 'pools', number: 'outline', radius: 34, glow: 0, size: 1, edit: 'balanced', music: 'glow', words: true, grain: true, vignette: false, letterbox: false, camera: false },
  { id: 'cinematic', label: 'Cinematic', blurb: 'Letterbox bars, slow push-in, titles that pull focus.', palette: 'teal', object: true, font: 'playfair', body: 'sans', hook: 'body', upper: false, italic: true, align: 'center', enter: 'blur', transition: 'black', backdrop: 'beams', number: 'tag', radius: 18, glow: 0.18, size: 0.92, edit: 'slow', music: 'epic', words: false, grain: true, vignette: true, letterbox: true, camera: true },
  { id: 'kinetic', label: 'Kinetic', blurb: 'Big condensed caps that slam in word by word.', palette: 'volt', object: false, font: 'bebas', body: 'sans', hook: 'display', upper: true, italic: false, align: 'left', enter: 'slam', transition: 'wipe', backdrop: 'plain', number: 'giant', radius: 0, glow: 0, size: 1.12, edit: 'fast', music: 'drive', words: true, grain: false, vignette: false, letterbox: false, camera: true },
  { id: 'minimal', label: 'Minimal', blurb: 'Quiet type, plain ground, nothing in the way.', palette: 'snow', object: true, font: 'geist', body: 'sans', hook: 'body', upper: false, italic: false, align: 'center', enter: 'fade', transition: 'fade', backdrop: 'plain', number: 'tag', radius: 22, glow: 0, size: 0.82, edit: 'balanced', music: 'soft', words: false, grain: false, vignette: false, letterbox: false, camera: false },
  { id: 'terminal', label: 'Terminal', blurb: 'Every line typed out on a glowing console.', palette: 'acid', object: false, font: 'jetbrains', body: 'mono', hook: 'body', upper: false, italic: false, align: 'left', enter: 'type', transition: 'cut', backdrop: 'scan', number: 'tag', radius: 8, glow: 0.35, size: 0.9, edit: 'balanced', music: 'pulse', words: false, grain: false, vignette: true, letterbox: false, camera: false },
  { id: 'glitch', label: 'Glitch', blurb: 'Split channels, torn frames, a grid that hums.', palette: 'cyber', object: false, font: 'grotesk', body: 'sans', hook: 'display', upper: true, italic: false, align: 'center', enter: 'glitch', transition: 'glitch', backdrop: 'grid', number: 'outline', radius: 0, glow: 0.12, size: 0.9, edit: 'fast', music: 'break', words: false, grain: true, vignette: true, letterbox: false, camera: false },
  { id: 'swiss', label: 'Swiss', blurb: 'Poster grid, heavy type, color blocks that push.', palette: 'paper', object: false, font: 'syne', body: 'sans', hook: 'display', upper: false, italic: false, align: 'left', enter: 'mask', transition: 'push', backdrop: 'blocks', number: 'giant', radius: 0, glow: 0, size: 1, edit: 'fast', music: 'drive', words: false, grain: false, vignette: false, letterbox: false, camera: false },
  { id: 'neon', label: 'Neon', blurb: 'Glowing caps over a retro horizon.', palette: 'orchid', object: true, font: 'unbounded', body: 'sans', hook: 'body', upper: true, italic: false, align: 'center', enter: 'flicker', transition: 'zoom', backdrop: 'horizon', number: 'outline', radius: 28, glow: 1, size: 0.92, edit: 'fast', music: 'retro', words: false, grain: true, vignette: true, letterbox: false, camera: false },
  { id: 'luxe', label: 'Luxe', blurb: 'Gold on black, slow reveals under a single spotlight.', palette: 'gold', object: true, font: 'playfair', body: 'sans', hook: 'body', upper: false, italic: true, align: 'center', enter: 'blur', transition: 'fade', backdrop: 'spot', number: 'tag', radius: 30, glow: 0.12, size: 0.9, edit: 'slow', music: 'epic', words: false, grain: true, vignette: true, letterbox: false, camera: true },
  { id: 'aurora', label: 'Aurora', blurb: 'Ribbons of light drifting behind clean type.', palette: 'ocean', object: true, font: 'geist', body: 'sans', hook: 'body', upper: false, italic: false, align: 'center', enter: 'rise', transition: 'fade', backdrop: 'aurora', number: 'tag', radius: 26, glow: 0, size: 0.9, edit: 'balanced', music: 'glow', words: true, grain: true, vignette: false, letterbox: false, camera: false },
  { id: 'brutal', label: 'Brutalist', blurb: 'Raw grid, heavy caps, hard cuts, no decoration.', palette: 'concrete', object: false, font: 'grotesk', body: 'mono', hook: 'display', upper: true, italic: false, align: 'left', enter: 'mask', transition: 'cut', backdrop: 'grid', number: 'giant', radius: 0, glow: 0, size: 1.05, edit: 'fast', music: 'break', words: false, grain: false, vignette: false, letterbox: false, camera: false },
  { id: 'pop', label: 'Pop', blurb: 'Loud color, chunky caps, a party in every cut.', palette: 'candy', object: false, font: 'unbounded', body: 'sans', hook: 'display', upper: true, italic: false, align: 'center', enter: 'slam', transition: 'wipe', backdrop: 'mesh', number: 'giant', radius: 40, glow: 0, size: 0.85, edit: 'fast', music: 'drive', words: true, grain: false, vignette: false, letterbox: false, camera: false },
  { id: 'blueprint', label: 'Blueprint', blurb: 'Technical drawing: grid paper, mono notes, lines that draw in.', palette: 'blueprint', object: false, font: 'grotesk', body: 'mono', hook: 'body', upper: false, italic: false, align: 'left', enter: 'mask', transition: 'push', backdrop: 'grid', number: 'outline', radius: 4, glow: 0, size: 0.9, edit: 'balanced', music: 'pulse', words: false, grain: false, vignette: true, letterbox: false, camera: false },
  { id: 'noir', label: 'Film Noir', blurb: 'Black and white, deep shadow, a title card from an old picture.', palette: 'silver', object: false, font: 'playfair', body: 'sans', hook: 'body', upper: true, italic: true, align: 'center', enter: 'blur', transition: 'black', backdrop: 'beams', number: 'tag', radius: 0, glow: 0, size: 0.82, edit: 'slow', music: 'epic', words: false, grain: true, vignette: true, letterbox: true, camera: true },
  { id: 'mesh', label: 'Mesh', blurb: 'Soft color mesh and glass, the polished product launch.', palette: 'snow', object: true, font: 'geist', body: 'sans', hook: 'body', upper: false, italic: false, align: 'center', enter: 'rise', transition: 'zoom', backdrop: 'mesh', number: 'tag', radius: 28, glow: 0, size: 0.92, edit: 'balanced', music: 'glow', words: true, grain: true, vignette: false, letterbox: false, camera: false },
  { id: 'keynote', label: 'Keynote', blurb: 'One spotlight, one object, big quiet type on stage.', palette: 'noir', object: true, font: 'geist', body: 'sans', hook: 'body', upper: false, italic: false, align: 'center', enter: 'fade', transition: 'black', backdrop: 'spot', number: 'tag', radius: 24, glow: 0, size: 0.95, edit: 'slow', music: 'soft', words: false, grain: false, vignette: true, letterbox: false, camera: false },
];

export type RepoView = Pick<RepoFacts, 'owner' | 'name' | 'url' | 'stars' | 'forks' | 'language' | 'license' | 'release' | 'image' | 'kind'>;

/** Adds a website's own display font (already loaded in the page) as a face. Returns its id. */
export function registerSiteFace(family: string, id = 'site') {
  const i = FONTS.findIndex((f) => f.id === id);
  const face: Face = { id, label: family, family: `"${family}", ${SANS}`, weight: 600, italic: false, size: 0.8, track: -0.03 };
  if (i >= 0) FONTS[i] = face; else FONTS.push(face);
  return id;
}

// Website preview images. Bundled ones load by path; others go through the server so the canvas stays exportable.
const images = new Map<string, HTMLImageElement>();
const imageUrl = (u: string) => (u.startsWith('/') ? u : `/api/image?u=${encodeURIComponent(u)}`);
function imageFor(u: string | undefined): HTMLImageElement | null {
  if (!u) return null;
  let img = images.get(u);
  if (!img) { img = new Image(); img.decoding = 'async'; img.src = imageUrl(u); images.set(u, img); }
  return img.complete && img.naturalWidth ? img : null;
}
/** Waits until the cut's images are ready, so the first frames are not drawn without them. */
export async function preloadImages(inp: { repo: RepoView }): Promise<void> {
  const u = inp.repo.image;
  if (!u) return;
  imageFor(u);
  await images.get(u)!.decode().catch(() => undefined);
}

/** Everything a viewer can change about a cut. */
export interface Options {
  style: string;
  /** Hex color that replaces the palette's first accent, or '' to keep the palette. */
  accent: string;
  /** Display face id, or 'auto' for the style's own. */
  font: string;
  /** Text size, 1 = the style's own. */
  scale: number;
  align: 'auto' | 'left' | 'center';
  case: 'auto' | 'upper' | 'asis';
  format: Format;
  /** Short side in pixels. */
  resolution: number;
  fps: number;
  edit: 'auto' | Edit;
  /** Track id, 'auto' for the style's own, or 'off'. */
  music: string;
  /** Music level, 0 to 1. */
  volume: number;
  transition: 'auto' | Transition;
  quality: 'standard' | 'high' | 'max';
  grain: boolean;
  vignette: boolean;
  letterbox: boolean;
  camera: boolean;
  hud: boolean;
  object: boolean;
  code: boolean;
  /** Off for the landing demo, which has no real repo behind it. */
  stats: boolean;
}

export interface RenderInput extends Options {
  repo: RepoView;
  script: VideoScript;
  theme: Theme;
}

export const styleOf = (id: string) => STYLES.find((x) => x.id === id) ?? STYLES[0];
export const faceOf = (id: string) => FONTS.find((x) => x.id === id) ?? FONTS[0];

/** Switch style and reset every option that belongs to it. */
export function withStyle<T extends Options>(o: T, id: string): T {
  const st = styleOf(id);
  const theme = 'theme' in o ? { theme: THEMES.find((x) => x.id === st.palette) ?? THEMES[0] } : {};
  return { ...o, ...theme, object: st.object, style: st.id, font: 'auto', align: 'auto', case: 'auto', transition: 'auto', edit: 'auto', music: 'auto', grain: st.grain, vignette: st.vignette, letterbox: st.letterbox, camera: st.camera };
}

export const DEFAULTS: Options = withStyle({
  style: 'editorial', accent: '', font: 'auto', scale: 1, align: 'auto', case: 'auto', format: 'square', resolution: 1080, fps: 60, edit: 'auto',
  music: 'auto', volume: 0.8, transition: 'auto', quality: 'high', grain: true, vignette: false, letterbox: false, camera: false, hud: false, object: true, code: true, stats: true,
}, 'editorial');

export const editOf = (inp: Options): Edit => (inp.edit === 'auto' ? styleOf(inp.style).edit : inp.edit);
/** The track that plays, or null when music is off. */
export const trackOf = (inp: Options): Track | null =>
  inp.music === 'off' ? null : TRACKS.find((x) => x.id === (inp.music === 'auto' ? styleOf(inp.style).music : inp.music)) ?? TRACKS[0];
/** Tempo of the cut. With music off it keeps the style's own tempo. */
export const bpmOf = (inp: Options) => (trackOf(inp) ?? TRACKS.find((x) => x.id === styleOf(inp.style).music) ?? TRACKS[0]).bpm;

type Kind = 'flash' | 'name' | 'intro' | 'shot' | 'beat' | 'code' | 'stats' | 'stat' | 'outro';
export interface Scene { kind: Kind; start: number; dur: number; i: number; beats: number; text?: string; invert?: boolean }

/** The repo numbers that can go on screen, in order. Only real values from GitHub. */
export function statList(repo: RepoView): { name: string; caption: string; num?: number; text?: string }[] {
  const out: { name: string; caption: string; num?: number; text?: string }[] = [
    { name: 'stars', caption: 'stars on GitHub', num: repo.stars },
    { name: 'forks', caption: 'forks and counting', num: repo.forks },
  ];
  if (repo.language) out.push({ name: 'language', caption: 'written in', text: repo.language });
  if (repo.release) out.push({ name: 'latest release', caption: 'latest release', text: repo.release });
  else if (repo.license) out.push({ name: 'license', caption: 'licensed', text: repo.license });
  return out;
}

export async function loadFonts(): Promise<void> {
  const faces = FONTS.flatMap((f) => [`${f.weight} 80px ${f.family}`, ...(f.italic ? [`italic ${f.weight} 80px ${f.family}`] : [])]);
  await Promise.all([
    ...faces.map((f) => document.fonts.load(f)),
    document.fonts.load(`400 40px ${SANS}`),
    document.fonts.load(`500 40px ${SANS}`),
    document.fonts.load(`600 40px ${SANS}`),
    document.fonts.load(`400 30px ${MONO}`),
    document.fonts.load(`400 30px "JetBrains Mono"`),
  ]).catch(() => undefined);
}

/** The shot list. Every shot is a whole number of beats, so cuts land on the music. */
export function timeline(inp: RenderInput): Scene[] {
  const beat = 60 / bpmOf(inp);
  const edit = editOf(inp);
  const out: Scene[] = [];
  let t = 0;
  const add = (kind: Kind, beats: number, extra: Partial<Scene> = {}) => {
    out.push({ kind, start: t, dur: beats * beat, i: 0, beats, ...extra });
    t += beats * beat;
  };
  const chars = inp.script.code.text.trim().length;
  const hasCode = inp.code && chars > 0;
  if (edit === 'fast') {
    add('flash', 2, { text: 'Introducing', invert: true });
    add('name', 4);
    add('intro', 6);
    if (inp.repo.image) add('shot', 4);
    inp.script.beats.forEach((b, i) => {
      add('flash', 2, { text: b.title, i, invert: i % 2 === 1 });
      add('beat', b.body.length > 70 ? 5 : 4, { i });
    });
    if (hasCode) add('code', chars > 160 ? 10 : 8);
    if (inp.stats) statList(inp.repo).slice(0, 3).forEach((_, i) => add('stat', 2, { i, invert: i === 1 }));
    add('outro', 8);
  } else {
    const slow = edit === 'slow';
    add('name', 4);
    add('intro', slow ? 4 : 5);
    if (inp.repo.image) add('shot', slow ? 6 : 5);
    inp.script.beats.forEach((b, i) => add('beat', (slow ? 4 : 5) + (b.body.length > 70 ? 1 : 0), { i }));
    if (hasCode) add('code', slow ? 7 : chars > 160 ? 9 : 8);
    if (inp.stats) add('stats', slow ? 4 : 5);
    add('outro', slow ? 6 : 7);
  }
  return out;
}

export const duration = (inp: RenderInput) => timeline(inp).reduce((s, x) => s + x.dur, 0);

export function bitrate(inp: RenderInput): number {
  const [w, h] = frameSize(inp.format, inp.resolution);
  const bpp = { standard: 0.07, high: 0.12, max: 0.2 }[inp.quality];
  const f = Math.min(inp.fps, 60) + Math.max(0, inp.fps - 60) * 0.4;
  return Math.round(Math.min(60e6, Math.max(2e6, w * h * f * bpp)));
}

/** Display tracking for the current frame's face. Applied to bold display fonts only, never to body copy. */
let TRACK: { family: string; em: number } = { family: '', em: 0 };
function setFont(ctx: CanvasRenderingContext2D, font: string) {
  ctx.font = font;
  const bold = parseInt(font.replace(/^italic /, ''), 10) >= 600 || /Instrument|Bebas/.test(font);
  const m = TRACK.em && bold && font.includes(TRACK.family) ? /([\d.]+)px/.exec(font) : null;
  ctx.letterSpacing = m ? `${(TRACK.em * parseFloat(m[1])).toFixed(2)}px` : '0px';
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest font size (down to min) at which the text fits in maxLines lines. */
function fit(ctx: CanvasRenderingContext2D, font: (px: number) => string, text: string, max: number, start: number, min: number, maxLines: number) {
  let px = start;
  for (; px > min; px -= Math.max(1, start / 60)) {
    setFont(ctx, font(px));
    const lines = wrap(ctx, text, max);
    if (lines.length <= maxLines && !lines.some((l) => ctx.measureText(l).width > max)) break;
  }
  setFont(ctx, font(px));
  return { px, lines: wrap(ctx, text, max) };
}

let grain: HTMLCanvasElement | null = null;
function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  grain = document.createElement('canvas');
  grain.width = grain.height = 256;
  const g = grain.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grain;
}

const KEYWORDS = /^(import|from|export|default|const|let|var|function|return|async|await|def|class|if|else|for|while|new|use|fn|pub|mod|impl|struct|package|func|npm|npx|pnpm|yarn|bun|pip|pipx|cargo|go|git|brew|docker|curl|install|add|run|clone)$/;

interface Tok { text: string; color: string }
function tokens(line: string, th: Theme): Tok[] {
  if (/^\s*(\/\/|--|;|#(?!!))/.test(line)) return [{ text: line, color: th.muted }];
  const out: Tok[] = [];
  for (const m of line.matchAll(/("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`[^`]*`?|\b\d[\d._]*\b|[A-Za-z_$][\w$-]*|\s+|.)/g)) {
    const t = m[0];
    let color = th.ink;
    if (/^["'`]/.test(t)) color = th.accents[1];
    else if (/^\d/.test(t)) color = th.accents[2];
    else if (KEYWORDS.test(t)) color = th.accents[0];
    else if (/^[^\w\s]$/.test(t)) color = th.muted;
    out.push({ text: t, color });
  }
  return out;
}

/** One thing on screen. Text sits on its baseline at y; a shape fills the box x, y, w, h. */
interface Item {
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
  text?: string;
  font?: string;
  fill?: string;
  grad?: boolean;
  stroke?: boolean;
  glow?: boolean;
  alpha?: number;
  enter?: Enter;
  /** Draws a shape; p is its eased entrance, 0 to 1. */
  shape?: (p: number) => void;
}

const ENTER_TIME: Record<Enter, number> = { rise: 0.9, fade: 0.8, slam: 0.42, type: 0.6, mask: 0.85, glitch: 0.55, blur: 1.3, flicker: 0.8 };

function palette(inp: RenderInput): Theme {
  if (!/^#[0-9a-f]{6}$/i.test(inp.accent)) return inp.theme;
  return { ...inp.theme, accents: [inp.accent, inp.theme.accents[1], inp.theme.accents[2]] };
}

export function drawFrame(ctx: CanvasRenderingContext2D, inp: RenderInput, time: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const s = Math.min(W, H) / 1080;
  const st = styleOf(inp.style);
  const face = faceOf(inp.font === 'auto' ? st.font : inp.font);
  TRACK = { family: face.family, em: face.track };
  const align = inp.align === 'auto' ? st.align : inp.align;
  const upper = inp.case === 'auto' ? st.upper : inp.case === 'upper';
  const transition = inp.transition === 'auto' ? st.transition : inp.transition;
  const scenes = timeline(inp);
  const total = scenes.reduce((a, x) => a + x.dur, 0);
  const t = clamp(time, 0, total - 0.0001);
  const idx = Math.max(0, scenes.findIndex((x) => t >= x.start && t < x.start + x.dur));
  const sc = scenes[idx];
  const lt = t - sc.start;
  const base = palette(inp);
  // An inverted shot swaps ground and ink: accent color behind, dark type on top.
  const th: Theme = sc.invert
    ? { ...base, bg: base.accents[0], bg2: base.accents[1], ink: base.bg, muted: base.bg + 'b0', accents: [base.bg, base.bg2, base.bg], light: !base.light }
    : base;
  const edit = editOf(inp);
  const beat = 60 / bpmOf(inp);
  /** Entrances run faster in a fast cut and slower in a slow one. */
  const q = edit === 'fast' ? 0.55 : edit === 'slow' ? 1.15 : 1;
  const M = 92 * s;
  // Transition progress. Flash shots and runs of number shots cut hard, on the beat.
  const TT = Math.min(0.4, beat * 0.7);
  const prev = scenes[idx - 1];
  const next = scenes[idx + 1];
  const hard = (a?: Scene, b?: Scene) => !a || !b || a.kind === 'flash' || b.kind === 'flash' || (a.kind === 'stat' && b.kind === 'stat');
  const inP = hard(prev, sc) ? 1 : clamp(lt / TT);
  const outP = hard(sc, next) ? 1 : clamp((sc.dur - lt) / TT);
  const bar = inp.letterbox ? (W > H ? Math.max(0, (H - W / 2.39) / 2) : H * 0.085) : 0;
  const cw = Math.min(W - M * 2 - (st.backdrop === 'blocks' ? W * 0.08 : 0), 1480 * s);
  const x0 = align === 'center' ? (W - cw) / 2 : M;
  const top = bar + M * 1.1;
  const avail = H - bar * 2 - M * 2.2;
  const cap = (x: string) => (upper ? x.toUpperCase() : x);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
  ctx.shadowBlur = 0;

  const gradient = (a: number, b: number) => {
    const g = ctx.createLinearGradient(a, 0, b, 0);
    g.addColorStop(0, th.accents[0]);
    g.addColorStop(0.55, th.accents[1]);
    g.addColorStop(1, th.accents[2]);
    return g;
  };
  const label = (text: string, x: number, y: number, color = th.muted, px = 26) => {
    setFont(ctx, `400 ${px * s}px ${MONO}`);
    ctx.letterSpacing = `${2 * s}px`;
    ctx.fillStyle = color;
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.letterSpacing = '0px';
  };
  const labelWidth = (text: string, px = 26) => {
    setFont(ctx, `400 ${px * s}px ${MONO}`);
    ctx.letterSpacing = `${2 * s}px`;
    const w = ctx.measureText(text.toUpperCase()).width;
    ctx.letterSpacing = '0px';
    return w;
  };

  backdrop();
  content();
  afterTransition();
  overlays();
  hud();
  ctx.restore();

  // Layer 1: what sits behind the words.
  function backdrop() {
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    const blob = (color: string, px: number, py: number, r: number, a: string) => {
      const g = ctx.createRadialGradient(px * W, py * H, 0, px * W, py * H, r * Math.max(W, H));
      g.addColorStop(0, color + a);
      g.addColorStop(1, color + '00');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    const shift = inOut(clamp(lt / 1.2)) + idx;
    const lineInk = th.light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    if (sc.invert) {
      // Solid accent ground with a slow sheen across it.
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, base.accents[0]);
      g.addColorStop(1, base.accents[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const sx = ((lt / sc.dur) * 1.6 - 0.3) * W;
      const sheen = ctx.createLinearGradient(sx - W * 0.3, 0, sx + W * 0.3, H * 0.4);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    switch (st.backdrop) {
      case 'pools': {
        // Studio light: one soft key from above, a faint coloured rim low on the opposite side.
        const g = ctx.createRadialGradient(W * (0.5 + 0.06 * Math.sin(t * 0.2)), -H * 0.25, 0, W * 0.5, -H * 0.25, Math.max(W, H) * 1.15);
        g.addColorStop(0, th.light ? 'rgba(255,255,255,0.9)' : 'rgba(255,248,240,0.16)');
        g.addColorStop(0.55, th.light ? 'rgba(255,255,255,0.2)' : 'rgba(255,248,240,0.03)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        blob(th.accents[1], 0.92, 1.05, 0.55, th.light ? '18' : '1c');
        blob(th.accents[0], 0.05 + 0.04 * Math.sin(shift), 1.0, 0.45, th.light ? '14' : '16');
        break;
      }
      case 'beams': {
        blob(th.bg2, 0.5, 0.5, 0.8, 'aa');
        blob(th.accents[0], 0.1 + 0.06 * Math.sin(t * 0.3), -0.05, 0.75, th.light ? '30' : '44');
        blob(th.accents[1], 1.05, 0.35 + 0.08 * Math.sin(t * 0.25 + idx), 0.6, th.light ? '22' : '30');
        ctx.save();
        ctx.globalCompositeOperation = th.light ? 'multiply' : 'screen';
        ctx.translate(W * 0.15, -H * 0.2);
        ctx.rotate(0.42);
        for (let i = 0; i < 4; i++) {
          const bx = i * 260 * s + Math.sin(t * 0.35 + i * 1.7) * 70 * s;
          const bw = (110 + 60 * hash(i)) * s;
          const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
          g.addColorStop(0, th.accents[0] + '00');
          g.addColorStop(0.5, th.accents[0] + (th.light ? '14' : '1c'));
          g.addColorStop(1, th.accents[0] + '00');
          ctx.fillStyle = g;
          ctx.fillRect(bx, 0, bw, Math.max(W, H) * 2);
        }
        ctx.restore();
        // Anamorphic flare: a thin horizontal streak through the middle with a hot core.
        const fy = H * (0.5 + 0.03 * Math.sin(t * 0.4 + idx));
        const fl = ctx.createLinearGradient(0, 0, W, 0);
        fl.addColorStop(0, 'rgba(0,0,0,0)');
        fl.addColorStop(0.5, th.accents[1] + '88');
        fl.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.globalCompositeOperation = th.light ? 'multiply' : 'screen';
        ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 1.3);
        ctx.fillStyle = fl;
        ctx.fillRect(0, fy - 2 * s, W, 4 * s);
        ctx.globalAlpha = 0.35;
        ctx.fillRect(0, fy - 18 * s, W, 36 * s);
        ctx.restore();
        blob(th.accents[2], 0.5 + 0.08 * Math.sin(t * 0.3), 0.5, 0.18, th.light ? '22' : '40');
        break;
      }
      case 'aurora': {
        // Three ribbons of light, blurred and drifting, like a polar sky.
        blob(th.bg2, 0.5, 0.2, 0.9, 'aa');
        ctx.save();
        ctx.globalCompositeOperation = th.light ? 'multiply' : 'screen';
        ctx.filter = `blur(${Math.round(46 * s)}px)`;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          for (let x = -W * 0.1; x <= W * 1.1; x += W / 24) {
            const y = H * (0.3 + 0.16 * i) + Math.sin((x / W) * 7 + t * (0.35 + i * 0.1) + i * 2) * H * 0.07 + Math.sin(t * 0.2 + i) * H * 0.04;
            if (x === -W * 0.1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          const g = ctx.createLinearGradient(0, 0, W, 0);
          g.addColorStop(0, th.accents[i % 3] + '00');
          g.addColorStop(0.5, th.accents[i % 3] + (th.light ? '55' : '77'));
          g.addColorStop(1, th.accents[(i + 1) % 3] + '00');
          ctx.strokeStyle = g;
          ctx.lineWidth = H * (0.09 - i * 0.02);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'mesh': {
        // A slow colour mesh: four soft blobs that wander.
        const pts: [string, number, number, number][] = [
          [th.accents[0], 0.2 + 0.12 * Math.sin(t * 0.21), 0.25 + 0.1 * Math.cos(t * 0.17), 0.7],
          [th.accents[1], 0.85 + 0.1 * Math.cos(t * 0.19 + 1), 0.3 + 0.12 * Math.sin(t * 0.23), 0.65],
          [th.accents[2], 0.7 + 0.12 * Math.sin(t * 0.16 + 2), 0.9 + 0.08 * Math.cos(t * 0.2), 0.7],
          [th.bg2, 0.2 + 0.1 * Math.cos(t * 0.18 + 3), 0.85, 0.6],
        ];
        for (const [c, px, py, r] of pts) blob(c, px, py, r, th.light ? '88' : '99');
        ctx.fillStyle = th.light ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.28)';
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'spot': {
        // A stage spotlight: a soft cone from above and a pool of light on the floor.
        const cx = W / 2 + Math.sin(t * 0.25) * W * 0.02;
        ctx.save();
        ctx.globalCompositeOperation = th.light ? 'multiply' : 'screen';
        ctx.filter = `blur(${Math.round(30 * s)}px)`;
        const cone = ctx.createLinearGradient(0, 0, 0, H);
        cone.addColorStop(0, th.light ? 'rgba(0,0,0,0.12)' : 'rgba(255,250,240,0.2)');
        cone.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.06, -H * 0.05);
        ctx.lineTo(cx + W * 0.06, -H * 0.05);
        ctx.lineTo(cx + W * 0.42, H * 0.95);
        ctx.lineTo(cx - W * 0.42, H * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        const pool = ctx.createRadialGradient(cx, H * 0.9, 0, cx, H * 0.9, W * 0.45);
        pool.addColorStop(0, th.light ? 'rgba(0,0,0,0.1)' : th.accents[0] + '30');
        pool.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pool;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'plain': {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, th.bg2);
        g.addColorStop(0.7, th.bg);
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        break;
      }
      case 'stripes': {
        blob(th.accents[0], 0.9, 0.1, 0.6, th.light ? '22' : '26');
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-0.38);
        const gap = 150 * s;
        const off = (t * 90 * s) % gap;
        ctx.fillStyle = th.bg2;
        ctx.globalAlpha = 0.55;
        const R = Math.hypot(W, H);
        for (let x = -R - gap + off; x < R; x += gap) ctx.fillRect(x, -R, 44 * s, R * 2);
        ctx.restore();
        break;
      }
      case 'scan':
        blob(th.bg2, 0.5, 0.5, 0.85, 'cc');
        blob(th.accents[0], 0.5, 0.45, 0.55, th.light ? '10' : '16');
        break;
      case 'grid': {
        blob(th.accents[0], 0.5, 0.5, 0.6, th.light ? '22' : '2a');
        blob(th.accents[2], 0.1, 0.95, 0.5, th.light ? '18' : '22');
        const gap = 90 * s;
        const off = (t * 14 * s) % gap;
        ctx.strokeStyle = lineInk;
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.beginPath();
        for (let x = off; x < W; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let y = off; y < H; y += gap) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
        break;
      }
      case 'blocks': {
        const e = outExpo(clamp(lt / 0.9));
        const v = hash(idx + 3);
        ctx.fillStyle = th.accents[0];
        const bandW = W * 0.075;
        ctx.fillRect(W - bandW * e, 0, bandW, H);
        ctx.beginPath();
        const r = Math.min(W, H) * (0.12 + 0.04 * v);
        ctx.arc(W - bandW - r * 0.2, H - r * 0.15 + (1 - e) * r * 1.4, r, 0, Math.PI * 2);
        ctx.fillStyle = th.accents[2];
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = th.ink;
        ctx.fillRect(M, bar + M * 0.95, (W - M * 2 - bandW) * e, 3 * s);
        ctx.strokeStyle = lineInk;
        ctx.lineWidth = Math.max(1, s);
        ctx.beginPath();
        for (let i = 1; i < 6; i++) { const x = (W / 6) * i; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        ctx.stroke();
        break;
      }
      case 'horizon': {
        const hy = H * 0.74;
        const sky = ctx.createLinearGradient(0, 0, 0, hy);
        sky.addColorStop(0, th.bg);
        sky.addColorStop(1, th.bg2);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, hy);
        const r = Math.min(W, H) * 0.24;
        const sun = ctx.createLinearGradient(0, hy - r, 0, hy);
        sun.addColorStop(0, th.accents[1]);
        sun.addColorStop(1, th.accents[0]);
        ctx.save();
        ctx.globalAlpha = th.light ? 0.3 : 0.36;
        ctx.beginPath();
        ctx.arc(W / 2, hy, r, Math.PI, 0);
        ctx.fillStyle = sun;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = th.bg2;
        for (let i = 0; i < 6; i++) { const yy = hy - r * 0.08 - i * r * 0.13; ctx.fillRect(W / 2 - r, yy, r * 2, (6 - i) * 1.6 * s); }
        ctx.restore();
        ctx.fillStyle = th.bg;
        ctx.fillRect(0, hy, W, H - hy);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, hy, W, H - hy);
        ctx.clip();
        ctx.strokeStyle = th.accents[1];
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 2 * s;
        ctx.shadowColor = th.accents[1];
        ctx.shadowBlur = 12 * s;
        ctx.beginPath();
        for (let i = -12; i <= 12; i++) { ctx.moveTo(W / 2 + i * W * 0.02, hy); ctx.lineTo(W / 2 + i * W * 0.16, H); }
        const z0 = (t * 0.35) % 1;
        for (let i = 0; i < 10; i++) { const z = (i + z0) / 10; const yy = hy + (H - hy) * z * z; ctx.moveTo(0, yy); ctx.lineTo(W, yy); }
        ctx.stroke();
        ctx.restore();
        blob(th.accents[0], 0.5, 0.74, 0.45, th.light ? '18' : '30');
        break;
      }
    }
  }

  // Layer 2: the scene, laid out to fit, then animated by the style.
  function content() {
    let built = layout(1);
    if (built.h > avail) built = layout(clamp((avail / built.h) * 0.98, 0.5, 1));
    const oy = top + Math.max(0, (avail - built.h) / 2);
    ctx.save();
    let alpha = 1;
    if (transition === 'fade' || transition === 'black') alpha = outP;
    if (transition === 'push') {
      ctx.translate((1 - outExpo(inP)) * W * 0.35 - (1 - outP) * (1 - outP) * W * 0.35, 0);
      alpha = clamp(outP * 1.6);
    }
    if (transition === 'zoom') {
      const z = (1 + (1 - outP) * (1 - outP) * 0.5) * (0.88 + 0.12 * outExpo(inP));
      ctx.translate(W / 2, H / 2);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -H / 2);
      alpha = outP * clamp(inP * 2.5);
    }
    // Title shots settle from a slight zoom, once. Nothing pulses on the beat.
    let z = 1;
    if (sc.kind === 'name') z *= 1.14 - 0.14 * outExpo(clamp(lt / (sc.dur * 0.85)));
    if (sc.kind === 'flash' || sc.kind === 'stat') z *= 1.07 - 0.07 * outExpo(clamp(lt / sc.dur));
    if (z !== 1) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -H / 2);
    }
    if (inp.camera) {
      const z = 1 + 0.045 * inOut(clamp(lt / sc.dur));
      ctx.translate(W / 2, H / 2);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.globalAlpha = alpha;
    ctx.translate(0, oy);
    for (const it of built.items) paint(it);
    ctx.restore();
  }

  function paint(it: Item) {
    let mode = it.enter ?? st.enter;
    if (mode === 'type' && !it.text) mode = 'fade';
    const raw = (lt - it.delay * q) / (ENTER_TIME[mode] * q);
    if (raw <= 0) return;
    const p = clamp(raw);
    const bx = it.x;
    const by = it.text ? it.y - it.h * 0.86 : it.y;
    const bh = it.text ? it.h * 1.12 : it.h;
    const cx = bx + it.w / 2;
    const cy = by + bh / 2;
    let text = it.text ?? '';
    let split = 0;
    let typing = false;
    ctx.save();
    ctx.globalAlpha *= it.alpha ?? 1;
    switch (mode) {
      case 'rise': {
        const e = outExpo(p);
        ctx.globalAlpha *= e;
        ctx.translate(0, (1 - e) * 46 * s);
        break;
      }
      case 'fade':
        ctx.globalAlpha *= inOut(p);
        ctx.translate(0, (1 - outExpo(p)) * 10 * s);
        break;
      case 'slam': {
        const e = outExpo(p);
        const z = 1 + (1 - e) * 0.9;
        ctx.globalAlpha *= clamp(p * 3);
        ctx.translate(cx, cy);
        ctx.scale(z, z);
        ctx.rotate((1 - e) * -0.06);
        ctx.translate(-cx, -cy);
        break;
      }
      case 'mask': {
        const e = outExpo(p);
        ctx.beginPath();
        ctx.rect(bx - 30 * s, by - 6 * s, it.w + 60 * s, bh + 12 * s);
        ctx.clip();
        ctx.translate(0, (1 - e) * (bh + 12 * s));
        break;
      }
      case 'blur': {
        const e = outExpo(p);
        ctx.globalAlpha *= e;
        if (e < 0.995) ctx.filter = `blur(${(1 - e) * 18 * s}px)`;
        const z = 1.08 - 0.08 * e;
        ctx.translate(cx, cy);
        ctx.scale(z, z);
        ctx.translate(-cx, -cy);
        break;
      }
      case 'flicker':
        if (p < 1 && hash(Math.floor(lt * 30) + it.delay * 17) < 0.5) ctx.globalAlpha *= 0.12;
        ctx.globalAlpha *= clamp(p * 4);
        break;
      case 'glitch':
        if (p < 1) {
          const n = Math.floor(lt * 40) + it.delay * 31;
          split = (1 - p) * 24 * s;
          ctx.translate((hash(n) - 0.5) * 60 * s * (1 - p), 0);
          if (hash(n + 5) < 0.3) ctx.globalAlpha *= 0.25;
        }
        ctx.globalAlpha *= clamp(p * 3);
        break;
      case 'type': {
        const n = Math.floor((lt - it.delay * q) / (0.028 * q));
        typing = n < text.length;
        text = text.slice(0, n);
        break;
      }
    }
    if (it.shape) it.shape(outExpo(p));
    else {
      setFont(ctx, it.font!);
      const fill = it.grad ? gradient(it.x, it.x + it.w) : (it.fill ?? th.ink);
      if (split) {
        ctx.save();
        ctx.globalCompositeOperation = th.light ? 'multiply' : 'screen';
        ctx.fillStyle = th.accents[2];
        ctx.fillText(text, it.x - split, it.y);
        ctx.fillStyle = th.accents[1];
        ctx.fillText(text, it.x + split, it.y);
        ctx.restore();
      }
      if (it.glow && st.glow) {
        ctx.shadowColor = th.accents[0];
        ctx.shadowBlur = st.glow * 42 * s;
      }
      if (it.stroke) {
        ctx.lineWidth = 2.2 * s;
        ctx.strokeStyle = fill;
        ctx.strokeText(text, it.x, it.y);
      } else {
        ctx.fillStyle = fill;
        ctx.fillText(text, it.x, it.y);
      }
      if (typing) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = th.accents[0];
        const w = ctx.measureText(text).width;
        ctx.fillRect(it.x + w + 4 * s, it.y - it.h * 0.72, it.h * 0.5, it.h * 0.8);
      }
    }
    ctx.restore();
  }

  /** Lays out the current scene at size factor k. Positions are relative to the top of the content block. */
  function layout(k: number): { items: Item[]; h: number } {
    const items: Item[] = [];
    const D = face.size * st.size * inp.scale * k;
    const B = inp.scale * k;
    const italic = st.italic && face.italic;
    const disp = (px: number, it = false) => `${it && face.italic ? 'italic ' : ''}${face.weight} ${px}px ${face.family}`;
    const bodyFace = st.body === 'mono' ? MONO : SANS;
    const bodyF = (px: number, w = 400) => `${w} ${st.body === 'mono' ? px * 0.86 : px}px ${bodyFace}`;
    const lineX = (w: number) => (align === 'center' ? x0 + (cw - w) / 2 : x0);
    let y = 0;

    /** Adds wrapped lines, one item per line or per word. Returns the next y. */
    const centerX = (w: number) => (W - w) / 2;
    type LineOpts = Partial<Item> & { words?: boolean; chars?: boolean; center?: boolean };
    const lines = (ls: string[], font: string, px: number, lh: number, delay: number, step: number, opts: LineOpts = {}) => {
      const { words, chars, center, ...o } = opts;
      setFont(ctx, font);
      let k2 = 0;
      ls.forEach((line, i) => {
        const base = y + px * 0.86 + i * px * lh;
        const lw = ctx.measureText(line).width;
        let x = center ? centerX(lw) : lineX(lw);
        if (chars) {
          // One item per letter, placed by measuring the prefix so kerning holds.
          const x1 = x;
          [...line].forEach((ch, j) => {
            if (ch === ' ') return;
            const cx = x1 + ctx.measureText(line.slice(0, j)).width;
            items.push({ ...o, x: cx, y: base, w: ctx.measureText(ch).width, h: px, text: ch, font, delay: delay + k2++ * step });
          });
        } else if (words) {
          for (const word of line.split(' ')) {
            const ww = ctx.measureText(word).width;
            items.push({ ...o, x, y: base, w: ww, h: px, text: word, font, delay: delay + k2++ * step * 0.5 });
            x += ctx.measureText(word + ' ').width;
          }
        } else items.push({ ...o, x, y: base, w: lw, h: px, text: line, font, delay: delay + i * step });
      });
      y += px * 0.86 + (ls.length - 1) * px * lh + px * 0.26;
    };
    /** The glass Klix prism, rendered in WebGL and settling in as it turns. Takes the palette's colours. */
    const prism = (x: number, py: number, size: number, delay: number) => {
      items.push({ x, y: py, w: size, h: size, delay, enter: 'fade', shape: (p) => {
        const z = 0.82 + 0.18 * p;
        const frame = prismFrame(size * z, t + 3, base.accents, 0.55 * Math.sin(t * 0.45) + lt * 0.25);
        if (!frame) return;
        const d = size * z;
        ctx.drawImage(frame, x + (size - d) / 2, py + (size - d) / 2, d, d);
      } });
    };
    const tag = (text: string, delay: number, color = th.muted, px = 26, center = false) => {
      const w = labelWidth(text, px);
      const x = center ? centerX(w) : lineX(w);
      const ly = y;
      items.push({ x, y: ly, w, h: px * s * 1.2, delay, shape: () => label(text, x, ly + px * s, color, px) });
      y += px * s * 1.3;
    };

    if (sc.kind === 'flash') {
      const opener = sc.text === 'Introducing';
      if (!opener) { tag(`feature ${String(sc.i + 1).padStart(2, '0')}`, 0, th.muted, 26, true); y += 22 * s * k; }
      const fl = fit(ctx, (px) => disp(px, italic), cap(sc.text ?? ''), cw, 300 * s * D, 80 * s * D, 2);
      const enter = st.enter === 'slam' || st.enter === 'glitch' || st.enter === 'flicker' || st.enter === 'type' || st.enter === 'mask' ? undefined : 'slam';
      lines(fl.lines, disp(fl.px, italic), fl.px, 0.92, 0, 0.09, { center: true, words: true, enter, glow: !sc.invert });
    }

    if (sc.kind === 'name') {
      const center = align === 'center';
      const short = Math.min(W, H);
      // Wide and square frames set the prism beside a left-aligned name; tall frames and centred styles stack it on top.
      const stack = inp.object && (center || H > W * 1.2);
      if (stack) {
        const size = short * (center ? 0.34 : 0.42) * k;
        prism(center ? W / 2 - size / 2 : x0 - size * 0.08, y - size * 0.06, size, 0);
        y += size * 1.0;
      }
      const side = inp.object && !stack;
      const nameW = side ? cw * 0.55 : cw;
      const top0 = y;
      tag(`${inp.repo.owner} /`, 0.1, th.muted, 26, center);
      y += 18 * s * k;
      const nm = fit(ctx, (px) => disp(px), cap(inp.repo.name), nameW, (inp.object && center ? 300 : 380) * s * D, 90 * s * D, 2);
      const enter = st.enter === 'rise' || st.enter === 'fade' || st.enter === 'blur' ? 'mask' : undefined;
      lines(nm.lines, disp(nm.px), nm.px, 0.9, 0.12, 0.035, { chars: true, glow: true, center, enter });
      y += 30 * s * k;
      const meta = inp.stats ? [inp.repo.language, inp.repo.stars ? `${compact(inp.repo.stars)} stars` : '', inp.repo.release].filter(Boolean).join('  ·  ') : '';
      if (meta) tag(meta, 0.8, th.ink, 24, center);
      if (side) {
        // Sits right of the widest name line, sized to the room that is left.
        setFont(ctx, disp(nm.px));
        const nameEnd = x0 + Math.max(...nm.lines.map((l) => ctx.measureText(l).width)) + 24 * s;
        const size = Math.max(short * 0.22, Math.min(short * 0.5, W - M * 0.5 - nameEnd));
        prism(Math.max(nameEnd, W - M - size * 0.9), top0 + (y - top0) / 2 - size / 2, size, 0.2);
      }
    }

    if (sc.kind === 'shot') {
      // Product shot: the site's own preview image in a glass frame, easing in from a slight zoom.
      const img = imageFor(inp.repo.image);
      const ratio = img ? img.naturalHeight / img.naturalWidth : 0.525;
      tag(`live at ${inp.repo.owner}`, 0, th.muted, 24, true);
      y += 22 * s * k;
      let fw = cw;
      let fh = fw * ratio;
      const maxH = avail * 0.72;
      if (fh > maxH) { fh = maxH; fw = fh / ratio; }
      const fx = (W - fw) / 2;
      const fy = y;
      const r = Math.max(10 * s, st.radius * 0.7 * s);
      items.push({ x: fx, y: fy, w: fw, h: fh, delay: 0.1, enter: st.enter === 'type' || st.enter === 'flicker' ? 'fade' : undefined, shape: () => {
        ctx.save();
        ctx.shadowColor = th.light ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 60 * s;
        ctx.shadowOffsetY = 24 * s;
        ctx.beginPath();
        ctx.roundRect(fx, fy, fw, fh, r);
        ctx.fillStyle = th.bg2;
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(fx, fy, fw, fh, r);
        ctx.clip();
        if (img) {
          const z = 1.08 - 0.08 * outExpo(clamp(lt / sc.dur));
          const dw = fw * z;
          const dh = fh * z;
          ctx.drawImage(img, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh);
        }
        // A sheen passing over the glass.
        const sx = fx + (clamp(lt / sc.dur) * 1.6 - 0.3) * fw;
        const sheen = ctx.createLinearGradient(sx - fw * 0.25, fy, sx + fw * 0.25, fy + fh);
        sheen.addColorStop(0, 'rgba(255,255,255,0)');
        sheen.addColorStop(0.5, 'rgba(255,255,255,0.14)');
        sheen.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(fx, fy, fw, fh);
        ctx.restore();
        ctx.beginPath();
        ctx.roundRect(fx, fy, fw, fh, r);
        ctx.lineWidth = 1.5 * s;
        ctx.strokeStyle = th.light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.18)';
        ctx.stroke();
      } });
      y += fh;
    }

    if (sc.kind === 'stat') {
      const it = statList(inp.repo)[sc.i] ?? statList(inp.repo)[0];
      tag(it.name, 0.05, th.muted, 28, true);
      y += 16 * s * k;
      const final = it.num !== undefined ? compact(it.num) : it.text ?? '';
      const v = fit(ctx, (px) => disp(px), cap(final), cw, (it.num !== undefined ? 420 : 300) * s * D, 80 * s, 1);
      const vy = y;
      const vpx = v.px;
      items.push({ x: centerX(cw), y: vy, w: cw, h: vpx, delay: 0.05, enter: st.enter === 'type' ? 'fade' : undefined, shape: () => {
        const now = it.num !== undefined ? compact(it.num * outExpo(clamp((lt - 0.05) / (sc.dur * 0.7)))) : final;
        setFont(ctx, disp(vpx));
        const str = cap(now);
        const w = ctx.measureText(str).width;
        if (st.glow && !sc.invert) { ctx.shadowColor = th.accents[0]; ctx.shadowBlur = st.glow * 50 * s; }
        ctx.fillStyle = sc.invert ? th.ink : gradient(centerX(w), centerX(w) + w);
        ctx.fillText(str, centerX(w), vy + vpx * 0.86);
        ctx.shadowBlur = 0;
      } });
      y += vpx * 1.05 + 10 * s * k;
      const capPx = 40 * s * B;
      lines([it.caption], bodyF(capPx, 500), capPx, 1.2, 0.3, 0, { center: true, fill: th.muted });
    }

    if (sc.kind === 'intro') {
      tag(`${inp.repo.owner} /`, 0.05);
      y += 14 * s * k;
      const name = fit(ctx, (px) => disp(px), cap(inp.repo.name), cw, 230 * s * D, 70 * s * D, 2);
      lines(name.lines, disp(name.px), name.px, 0.9, 0.15, 0.1, { glow: true });
      y += 16 * s * k;
      const bw = align === 'center' ? Math.min(cw, 420 * s) : cw;
      const bx = lineX(bw);
      const by = y;
      items.push({ x: bx, y: by, w: bw, h: 5 * s, delay: 0.5, enter: 'fade', shape: () => {
        const e = outExpo(clamp((lt - 0.55) / 1));
        ctx.fillStyle = gradient(bx, bx + bw);
        if (align === 'center') ctx.fillRect(bx + (bw * (1 - e)) / 2, by, bw * e, 5 * s);
        else ctx.fillRect(bx, by, bw * e, 5 * s);
      } });
      y += 5 * s + 40 * s * k;
      const hookText = st.hook === 'display' ? cap(inp.script.hook) : inp.script.hook;
      const hook = st.hook === 'display'
        ? fit(ctx, (px) => disp(px), hookText, cw, 110 * s * D, 44 * s * D, 3)
        : fit(ctx, (px) => bodyF(px, 500), hookText, cw, 58 * s * B, 34 * s * B, 3);
      lines(hook.lines, st.hook === 'display' ? disp(hook.px) : bodyF(hook.px, 500), hook.px, st.hook === 'display' ? 0.98 : 1.22, 0.75, 0.12, { words: st.words, fill: st.hook === 'display' ? th.ink : th.ink });
    }

    if (sc.kind === 'beat') {
      const beat = inp.script.beats[sc.i];
      const num = String(sc.i + 1).padStart(2, '0');
      const of = String(inp.script.beats.length).padStart(2, '0');
      if (st.number === 'outline') {
        const numPx = 120 * s * k;
        const font = disp(numPx);
        setFont(ctx, font);
        const nw = ctx.measureText(num).width;
        const lw = labelWidth(`feature ${num} of ${of}`);
        const gap = 26 * s;
        const total = nw + gap + lw;
        const nx = lineX(total);
        items.push({ x: nx, y: y + numPx * 0.82, w: nw, h: numPx, text: num, font, stroke: true, grad: true, delay: 0 });
        const ly = y + numPx * 0.78;
        items.push({ x: nx + nw + gap, y: ly - 26 * s, w: lw, h: 30 * s, delay: 0.08, shape: () => label(`feature ${num} of ${of}`, nx + nw + gap, ly) });
        y += numPx + 34 * s * k;
      } else if (st.number === 'giant') {
        const gpx = 620 * s * k;
        const font = disp(gpx);
        setFont(ctx, font);
        const gw = ctx.measureText(num).width;
        items.push({ x: W - M - gw - (st.backdrop === 'blocks' ? W * 0.06 : 0), y: gpx * 0.72, w: gw, h: gpx, text: num, font, fill: th.accents[0], alpha: th.light ? 0.16 : 0.2, delay: 0, enter: 'fade' });
        tag(`${num} / ${of}  feature`, 0.05, th.accents[0]);
        y += 20 * s * k;
      } else {
        const text = `${num} / ${of}`;
        const w = labelWidth(text, 24) + 40 * s;
        const x = lineX(w);
        const ty = y;
        items.push({ x, y: ty, w, h: 52 * s, delay: 0, shape: () => {
          ctx.beginPath();
          ctx.roundRect(x, ty, w, 52 * s, st.radius ? 26 * s : 0);
          ctx.strokeStyle = th.accents[0];
          ctx.lineWidth = 1.5 * s;
          ctx.stroke();
          label(text, x + 20 * s, ty + 35 * s, th.accents[0], 24);
        } });
        y += 52 * s + 40 * s * k;
      }
      const title = fit(ctx, (px) => disp(px, italic), cap(beat.title), cw, 150 * s * D, 60 * s * D, 3);
      lines(title.lines, disp(title.px, italic), title.px, 0.96, 0.12, 0.08, { glow: true, words: st.words && st.enter === 'slam' });
      y += 30 * s * k;
      const body = fit(ctx, (px) => bodyF(px), beat.body, align === 'center' ? cw * 0.86 : cw * 0.92, 46 * s * B, 28 * s * B, 4);
      lines(body.lines, bodyF(body.px), body.px, 1.32, 0.4, 0.07, { fill: th.muted });
    }

    if (sc.kind === 'code') {
      const code = inp.script.code.text.split('\n');
      const longest = Math.max(...code.map((l) => l.length), 20);
      const pad = 44 * s;
      setFont(ctx, `400 100px ${MONO}`);
      const adv100 = ctx.measureText('M').width;
      const px = clamp(((cw - pad * 2) / longest / adv100) * 100, 16 * s, 36 * s * inp.scale * k);
      setFont(ctx, `400 ${px}px ${MONO}`);
      const adv = ctx.measureText('M').width;
      const lh = px * 1.55;
      const cardH = 96 * s + code.length * lh + pad;
      const y0 = y;
      const r = st.radius * s;
      const enter = st.enter === 'type' || st.enter === 'glitch' || st.enter === 'flicker' ? 'fade' : undefined;
      items.push({ x: x0, y: y0, w: cw, h: cardH, delay: 0, enter, shape: () => {
        ctx.beginPath();
        ctx.roundRect(x0, y0, cw, cardH, r);
        ctx.fillStyle = th.light ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.045)';
        ctx.fill();
        ctx.lineWidth = 1.5 * s;
        ctx.strokeStyle = th.light ? 'rgba(23,18,13,0.18)' : 'rgba(255,255,255,0.14)';
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x0 + cw - pad - i * 26 * s, y0 + 40 * s, 7 * s, 0, Math.PI * 2);
          ctx.fillStyle = i === 2 ? th.accents[0] : th.light ? 'rgba(23,18,13,0.18)' : 'rgba(255,255,255,0.2)';
          ctx.fill();
        }
        ctx.fillStyle = gradient(x0, x0 + cw);
        ctx.fillRect(x0 + pad, y0 + 64 * s, 46 * s, 4 * s);
        label(inp.script.code.lang || 'code', x0 + pad, y0 + 48 * s, th.ink, 24);
      } });
      items.push({ x: x0, y: y0, w: cw, h: cardH, delay: 0, enter: 'fade', shape: () => {
        const totalChars = code.reduce((a, l) => a + l.length + 1, 0);
        let budget = Math.floor(clamp((lt - 0.5) / Math.max(0.8, sc.dur - 1.4)) * totalChars);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + pad, y0, cw - pad * 2, cardH);
        ctx.clip();
        let cx = x0 + pad;
        let cy = y0 + 96 * s + lh * 0.7;
        if (st.glow) { ctx.shadowColor = th.accents[0]; ctx.shadowBlur = st.glow * 24 * s; }
        for (const line of code) {
          cx = x0 + pad;
          for (const tok of tokens(line, th)) {
            if (budget <= 0) break;
            const shown = tok.text.slice(0, budget);
            budget -= shown.length;
            setFont(ctx, `400 ${px}px ${MONO}`);
            ctx.fillStyle = tok.color;
            ctx.fillText(shown, cx, cy);
            cx += shown.length * adv;
          }
          if (budget <= 0) break;
          budget -= 1;
          cy += lh;
        }
        if (Math.floor(lt * 2.4) % 2 === 0 || budget > 0) {
          ctx.fillStyle = th.accents[0];
          ctx.fillRect(cx + 2 * s, cy - px * 0.82, adv * 0.62, px);
        }
        ctx.restore();
      } });
      y += cardH;
    }

    if (sc.kind === 'stats') {
      const tiles: [string, () => string, boolean][] = [];
      tiles.push(['stars', () => compact(inp.repo.stars * outExpo(clamp((lt - 0.3) / 1.4))), false]);
      tiles.push(['forks', () => compact(inp.repo.forks * outExpo(clamp((lt - 0.4) / 1.4))), false]);
      if (inp.repo.language) tiles.push(['language', () => inp.repo.language, true]);
      if (inp.repo.release) tiles.push(['latest release', () => inp.repo.release, true]);
      else if (inp.repo.license) tiles.push(['license', () => inp.repo.license, true]);
      const cols = W > H * 1.2 ? Math.min(4, tiles.length) : 2;
      const gap = 24 * s;
      const tw = (cw - gap * (cols - 1)) / cols;
      const thH = (H > W * 1.3 ? 300 : 250) * s * k;
      const rows = Math.ceil(tiles.length / cols);
      const headPx = 84 * s * D;
      const head = fit(ctx, (px) => disp(px, italic), cap('By the numbers'), cw, headPx, 40 * s, 1);
      lines(head.lines, disp(head.px, italic), head.px, 1, 0, 0, { glow: true });
      y += 26 * s * k;
      const y0 = y;
      const r = st.radius * 0.85 * s;
      tiles.forEach(([name, value, isText], i) => {
        const x = x0 + (i % cols) * (tw + gap);
        const ty = y0 + Math.floor(i / cols) * (thH + gap);
        const enter = st.enter === 'type' ? 'fade' : undefined;
        items.push({ x, y: ty, w: tw, h: thH, delay: 0.15 + i * 0.1, enter, shape: () => {
          ctx.beginPath();
          ctx.roundRect(x, ty, tw, thH, r);
          ctx.fillStyle = th.light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.045)';
          ctx.fill();
          ctx.lineWidth = 1.5 * s;
          ctx.strokeStyle = th.light ? 'rgba(23,18,13,0.16)' : 'rgba(255,255,255,0.13)';
          ctx.stroke();
          label(name, x + 36 * s, ty + 58 * s);
          const v = fit(ctx, (p) => disp(p), cap(value()), tw - 72 * s, (isText ? 92 : 128) * s * face.size * k, 30 * s, 1);
          if (st.glow) { ctx.shadowColor = th.accents[0]; ctx.shadowBlur = st.glow * 30 * s; }
          ctx.fillStyle = i === 0 ? gradient(x, x + tw) : th.ink;
          ctx.fillText(v.lines[0] ?? '', x + 36 * s, ty + thH - 44 * s);
          ctx.shadowBlur = 0;
        } });
      });
      y = y0 + rows * thH + (rows - 1) * gap;
    }

    if (sc.kind === 'outro') {
      if (inp.object) {
        const size = Math.min(W, H) * 0.24 * k;
        prism(align === 'center' ? W / 2 - size / 2 : x0 - size * 0.12, y, size, 0);
        y += size * 0.92;
      }
      const tagText = cap(inp.script.tagline);
      const tg = fit(ctx, (px) => disp(px), tagText, cw, 96 * s * D, 44 * s * D, 4);
      lines(tg.lines, disp(tg.px), tg.px, 1.02, 0.05, 0.08, { glow: true, words: st.words && st.enter === 'slam' });
      y += 56 * s * k;
      const ctaPx = 40 * s * k;
      const ctaFont = `600 ${ctaPx}px ${SANS}`;
      setFont(ctx, ctaFont);
      const ctaText = inp.script.cta;
      const w = ctx.measureText(ctaText).width + 160 * s * k;
      const h = 104 * s * k;
      const x = lineX(w);
      const cy = y;
      items.push({ x, y: cy, w, h, delay: 0.5, enter: st.enter === 'type' ? 'fade' : undefined, shape: () => {
        ctx.beginPath();
        ctx.roundRect(x, cy, w, h, st.radius ? h / 2 : 0);
        ctx.fillStyle = gradient(x, x + w);
        if (st.glow) { ctx.shadowColor = th.accents[0]; ctx.shadowBlur = st.glow * 50 * s; }
        ctx.fill();
        ctx.shadowBlur = 0;
        const on = th.light ? '#fff8ee' : th.bg;
        setFont(ctx, ctaFont);
        ctx.fillStyle = on;
        ctx.fillText(ctaText, x + 52 * s * k, cy + h / 2 + ctaPx * 0.36);
        ctx.beginPath();
        const ax = x + w - 46 * s * k;
        const ay = cy + h / 2;
        ctx.moveTo(ax - 14 * s * k, ay - 12 * s * k);
        ctx.lineTo(ax, ay);
        ctx.lineTo(ax - 14 * s * k, ay + 12 * s * k);
        ctx.lineWidth = 4 * s * k;
        ctx.strokeStyle = on;
        ctx.stroke();
      } });
      y += h + 50 * s * k;
      tag(inp.repo.url.replace(/^https?:\/\//, ''), 0.75, th.ink, 28);
    }

    return { items, h: y };
  }

  // Layer 3: transitions that act on the whole frame.
  function afterTransition() {
    if (edit === 'fast' && idx > 0 && lt < 0.12) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.45 * (1 - lt / 0.12);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (transition === 'black') {
      const first = idx === 0 ? clamp(lt / 0.7) : inP;
      const a = 1 - Math.min(first, outP);
      if (a > 0) { ctx.fillStyle = '#000'; ctx.globalAlpha = a; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }
    if (transition === 'wipe') {
      const g = gradient(0, W);
      if (outP < 1) {
        const e = inOut(1 - outP);
        ctx.fillStyle = th.accents[2];
        ctx.fillRect(0, 0, W * clamp(e * 1.15), H);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W * e, H);
      }
      if (inP < 1) {
        const e = inOut(inP);
        ctx.fillStyle = g;
        ctx.fillRect(W * e, 0, W * (1 - e), H);
      }
    }
    let k = 0;
    if (transition === 'glitch') k = Math.max(outP < 1 ? 1 - outP : 0, inP < 1 ? 1 - inP : 0);
    if (st.id === 'glitch' && hash(Math.floor(t * 6)) > 0.9) k = Math.max(k, 0.2);
    if (k > 0) {
      const n = Math.floor(t * 30);
      for (let i = 0; i < 9; i++) {
        const sy = hash(n + i * 3.1) * H;
        const sh = (0.02 + hash(n + i * 7.7) * 0.07) * H;
        const dx = (hash(n + i * 1.3) - 0.5) * W * 0.18 * k;
        ctx.drawImage(ctx.canvas, 0, sy, W, sh, dx, sy, W, sh);
      }
      ctx.save();
      ctx.globalCompositeOperation = th.light ? 'multiply' : 'screen';
      ctx.globalAlpha = 0.35 * k;
      ctx.drawImage(ctx.canvas, 14 * s * k, 0);
      ctx.restore();
      ctx.fillStyle = th.accents[hash(n) > 0.5 ? 0 : 2];
      ctx.globalAlpha = 0.8 * k;
      if (k > 0.25) ctx.fillRect(0, hash(n + 9) * H, W, 4 * s);
      ctx.globalAlpha = 1;
    }
  }

  // Layer 4: lens and film.
  function overlays() {
    if (st.backdrop === 'scan') {
      ctx.fillStyle = th.light ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.22)';
      const step = Math.max(3, 4 * s);
      for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, step * 0.4);
    }
    if (inp.vignette) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.58);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, th.light ? 'rgba(40,25,10,0.22)' : 'rgba(0,0,0,0.62)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (inp.grain) {
      ctx.save();
      ctx.globalAlpha = th.light ? 0.05 : 0.08;
      ctx.globalCompositeOperation = th.light ? 'multiply' : 'overlay';
      ctx.fillStyle = ctx.createPattern(grainTile(), 'repeat')!;
      const z = Math.max(1, s * 0.9);
      ctx.scale(z, z);
      ctx.translate(-((t * 977) % 256), -((t * 613) % 256));
      ctx.fillRect(0, 0, W / z + 256, H / z + 256);
      ctx.restore();
    }
    if (bar) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    }
  }

  // Layer 5: repo label, time code, scene progress and the watermark, which stays on every frame.
  function hud() {
    ctx.globalAlpha = 1;
    const ink = bar ? 'rgba(255,255,255,0.92)' : th.ink;
    const muted = bar ? 'rgba(255,255,255,0.58)' : th.muted;
    const ty = bar ? bar / 2 + 8 * s : M * 0.75;
    const byy = bar ? H - bar / 2 + 10 * s : H - M * 0.62;
    if (inp.hud) {
      label(`${inp.repo.owner}/${inp.repo.name}`.slice(0, 40), M, ty, muted, 22);
      const secs = Math.floor(t);
      const tc = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
      label(tc, W - M - labelWidth(tc, 22), ty, muted, 22);
      const segW = 260 * s;
      const sx = W - M - segW;
      const sy = byy - 10 * s;
      const gap = 6 * s;
      const each = (segW - gap * (scenes.length - 1)) / scenes.length;
      scenes.forEach((x, i) => {
        const fill = clamp((t - x.start) / x.dur);
        ctx.fillStyle = th.light && !bar ? 'rgba(23,18,13,0.14)' : 'rgba(255,255,255,0.16)';
        ctx.fillRect(sx + i * (each + gap), sy, each, 4 * s);
        ctx.fillStyle = th.accents[0];
        ctx.fillRect(sx + i * (each + gap), sy, each * fill, 4 * s);
      });
    }
    watermark(ctx, ink, muted, th.accents[0], M, byy, s);
  }
}

/** "made with Klix" mark. Every exported video carries it. */
function watermark(ctx: CanvasRenderingContext2D, ink: string, muted: string, accent: string, x: number, y: number, s: number) {
  ctx.save();
  setFont(ctx, `400 ${22 * s}px ${MONO}`);
  ctx.letterSpacing = `${2 * s}px`;
  ctx.fillStyle = muted;
  ctx.fillText('MADE WITH', x, y);
  const w = ctx.measureText('MADE WITH ').width;
  ctx.letterSpacing = '0px';
  const mx = x + w + 6 * s;
  ctx.beginPath();
  ctx.moveTo(mx, y - 20 * s);
  ctx.lineTo(mx + 18 * s, y - 10 * s);
  ctx.lineTo(mx, y);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  setFont(ctx, `italic 400 ${36 * s}px ${SERIF}`);
  ctx.fillStyle = ink;
  ctx.fillText('klix', mx + 26 * s, y + 2 * s);
  ctx.restore();
}

/** Draws one still frame of a cut into a canvas at the given short side. */
export function still(canvas: HTMLCanvasElement, input: RenderInput, t: number, res = 540) {
  const [w, h] = frameSize(input.format, res);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  drawFrame(canvas.getContext('2d')!, input, t);
}

/** Plays a video on a canvas in real time, with seek and loop. Preview frames are drawn at most at maxRes.
 *  Give it an `audio` and the score starts, stops and jumps with the picture. */
export class Player {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private sig = '';
  time = 0;
  playing = false;
  loop = true;
  audio?: { start(t: number): void; stop(): void };
  onTime?: (t: number, total: number) => void;
  onLoop?: () => void;

  constructor(public canvas: HTMLCanvasElement, private input: RenderInput, private maxRes = 1080) {
    this.ctx = canvas.getContext('2d')!;
    this.sig = soundSig(input);
    this.resize();
    this.draw();
  }

  get total() { return duration(this.input); }

  set(input: RenderInput) {
    this.input = input;
    this.resize();
    this.time = Math.min(this.time, this.total - 0.001);
    const sig = soundSig(input);
    if (sig !== this.sig) { this.sig = sig; if (this.playing) this.audio?.start(this.time); }
    this.draw();
  }

  private resize() {
    const [w, h] = frameSize(this.input.format, Math.min(this.input.resolution, this.maxRes));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  draw() {
    drawFrame(this.ctx, this.input, this.time);
    this.onTime?.(this.time, this.total);
  }

  seek(t: number) {
    this.time = clamp(t, 0, this.total - 0.001);
    if (this.playing) this.audio?.start(this.time);
    this.draw();
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.total - 0.05) this.time = 0;
    this.playing = true;
    this.audio?.start(this.time);
    this.last = performance.now();
    const step = (now: number) => {
      if (!this.playing) return;
      this.time += Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.time >= this.total) {
        if (this.loop) { this.time = 0; this.onLoop?.(); this.audio?.start(0); }
        else { this.time = this.total - 0.001; this.playing = false; this.audio?.stop(); }
      }
      this.draw();
      if (this.playing) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  pause() { this.playing = false; cancelAnimationFrame(this.raf); this.audio?.stop(); this.draw(); }
}

/** Everything that changes the score; the player restarts the audio only when this changes. */
const soundSig = (inp: RenderInput) => JSON.stringify([trackOf(inp)?.id, inp.volume, timeline(inp).map((s) => [s.kind, s.beats])]);

const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const BIG_TYPES = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1.640034', ...TYPES];
const AUDIO_TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];
const BIG_AUDIO_TYPES = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.640034,mp4a.40.2', ...AUDIO_TYPES];

/** The best recording format this browser has, with an audio track when asked for. */
export function recordingType(w = 1080, h = 1080, audio = false): string {
  const big = w * h > 1920 * 1088;
  const list = audio ? [...(big ? BIG_AUDIO_TYPES : AUDIO_TYPES), ...(big ? BIG_TYPES : TYPES)] : big ? BIG_TYPES : TYPES;
  return list.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Renders the whole video in real time and returns the file. The tab must stay visible while it runs. */
export async function record(input: RenderInput, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: 'mp4' | 'webm'; audio: boolean }> {
  await preloadImages(input);
  // Preferred path: frame-by-frame WebCodecs export, exact at any frame rate.
  try {
    const off = await encodeOffline(input, onProgress);
    if (off) return { ...off, ext: 'mp4' };
  } catch (e) {
    console.warn('Frame-by-frame export failed, recording in real time instead.', e);
  }
  const [w, h] = frameSize(input.format, input.resolution);
  const music = renderMusic(input);
  const type = recordingType(w, h, Boolean(music));
  if (!type) throw new Error('This browser cannot record video. Try Chrome or Edge.');
  const withAudio = Boolean(music) && /mp4a|opus/.test(type);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const total = duration(input);
  drawFrame(ctx, input, 0);

  const stream = canvas.captureStream(input.fps);
  let src: AudioBufferSourceNode | null = null;
  let ac: AudioContext | null = null;
  let audio = withAudio;
  if (withAudio && music) {
    const buf = await music;
    ac = audioContext();
    // Browsers only start audio after a user gesture. If it will not start, record the picture alone.
    if (ac.state !== 'running') await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 1500))]);
    if (ac.state !== 'running') { ac = null; audio = false; }
  }
  if (audio && ac && music) {
    const buf = await music;
    const dest = ac.createMediaStreamDestination();
    src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate(input), audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });

  rec.start(250);
  // With audio, the audio clock drives the picture so the two stay locked.
  const a0 = ac ? ac.currentTime + 0.05 : 0;
  src?.start(a0);
  const t0 = performance.now();
  const now = () => (ac ? Math.max(0, ac.currentTime - a0) : (performance.now() - t0) / 1000);
  await new Promise<void>((resolve) => {
    const step = () => {
      const t = now();
      drawFrame(ctx, input, Math.min(t, total - 0.001));
      onProgress(Math.min(1, t / total));
      if (t >= total + 0.25) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  rec.stop();
  await done;
  try { src?.stop(); } catch { /* ended */ }
  stream.getTracks().forEach((tr) => tr.stop());
  canvas.remove();
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm', audio };
}
