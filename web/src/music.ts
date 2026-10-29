// Music and sound effects, synthesized in the browser so every cut has its own score and nothing needs a license.
// The track is rendered offline from the shot list: drums on the grid, a drop where the title lands,
// impacts and whooshes on the cuts. The same buffer plays in the preview and is mixed into the export.
import { timeline, duration, trackOf, TRACKS, type RenderInput, type Scene, type Track } from './render.ts';

const SR = 44100;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const hash = (n: number) => { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x); };

// Am F C G, voiced around middle C, with bass roots two octaves down.
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
const ROOTS = [33, 29, 36, 31];
const KEY: Record<string, number> = { drive: 0, retro: 2, break: -3, epic: -2, glow: 3, soft: 0, pulse: -5 };

const cache = new Map<string, Promise<AudioBuffer>>();

/** The score for a cut, or null when music is off. Cached by everything that changes the sound. */
export function renderMusic(inp: RenderInput): Promise<AudioBuffer> | null {
  const track = trackOf(inp);
  if (!track) return null;
  const scenes = timeline(inp);
  const key = JSON.stringify([track.id, inp.volume, scenes.map((s) => [s.kind, s.beats])]);
  let hit = cache.get(key);
  if (!hit) {
    hit = build(track, scenes, duration(inp), inp.volume);
    cache.set(key, hit);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

/** A hand-cut edit: drums only inside `full`, a drop with a riser at each of `drops`, a last chord from `ring`. */
export interface ScorePlan { full: [number, number][]; drops: number[]; ring: number }

/** The score for a custom edit that is not built from one style's timeline. */
export function renderPlan(trackId: string, end: number, volume: number, plan: ScorePlan): Promise<AudioBuffer> {
  const track = TRACKS.find((x) => x.id === trackId) ?? TRACKS[0];
  return build(track, [], end, volume, plan);
}

async function build(tr: Track, scenes: Scene[], end: number, volume: number, plan?: ScorePlan): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (end + 0.2)), SR);
  const B = 60 / tr.bpm;
  const shift = KEY[tr.id] ?? 0;

  // Buses: drums and music into a glue compressor; music ducks under the kick; shared reverb and delay.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.85 * volume, 0);
  master.gain.setValueAtTime(0.85 * volume, Math.max(0, end - 0.9));
  master.gain.linearRampToValueAtTime(0, end);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  master.connect(comp).connect(ctx.destination);
  const drums = ctx.createGain();
  drums.gain.value = 0.9;
  drums.connect(master);
  const music = ctx.createGain();
  music.connect(master);
  const fx = ctx.createGain();
  fx.gain.value = 0.9;
  fx.connect(master);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 2.6, 2.8);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.32;
  verb.connect(verbOut).connect(master);

  const delay = ctx.createDelay(2);
  delay.delayTime.value = B * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const dlp = ctx.createBiquadFilter();
  dlp.type = 'lowpass';
  dlp.frequency.value = 2800;
  delay.connect(dlp).connect(fb).connect(delay);
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.5;
  dlp.connect(delayOut).connect(master);

  const noiseBuf = ctx.createBuffer(1, SR * 4, SR);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = hash(i * 0.731) * 2 - 1;

  const send = (node: AudioNode, amount: number, to: AudioNode) => { const g = ctx.createGain(); g.gain.value = amount; node.connect(g).connect(to); };
  const env = (t: number, peak: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  };
  const noise = (t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, out: AudioNode, wet = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = env(t, peak, attack, decay);
    src.connect(f).connect(g).connect(out);
    if (wet) send(g, wet, verb);
    src.start(t, hash(t) * 1.5, Math.min(dur, 2));
    return f;
  };
  const osc = (t: number, type: OscillatorType, freq: number, dur: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  };

  // Sidechain: music dips on each kick and swells back over half a beat.
  const duck = (t: number, depth = 0.4) => {
    music.gain.setValueAtTime(depth, t);
    music.gain.linearRampToValueAtTime(1, t + B * 0.5);
  };

  // Instruments
  const kick = (t: number, v = 1, f0 = 150) => {
    const o = osc(t, 'sine', f0, 0.5);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    o.connect(env(t, v, 0.003, 0.42)).connect(drums);
    noise(t, 0.02, 'highpass', 2500, 0.7, 0.25 * v, 0.001, 0.012, drums);
    duck(t);
  };
  const snare = (t: number, v = 0.55, wet = 0.35) => {
    noise(t, 0.3, 'bandpass', 1900, 0.8, v, 0.002, 0.2, drums, wet);
    const o = osc(t, 'triangle', 210, 0.15);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(env(t, v * 0.6, 0.002, 0.1)).connect(drums);
  };
  const clap = (t: number, v = 0.5) => {
    for (const d of [0, 0.011, 0.023]) noise(t + d, 0.05, 'bandpass', 1300, 1.1, v * 0.7, 0.001, 0.02, drums);
    noise(t + 0.03, 0.3, 'bandpass', 1300, 0.9, v, 0.002, 0.17, drums, 0.4);
  };
  const hat = (t: number, v = 0.16, open = false) => noise(t, open ? 0.3 : 0.06, 'highpass', 7600, 0.6, v, 0.001, open ? 0.2 : 0.035, drums);
  const tom = (t: number, v = 0.7) => {
    const o = osc(t, 'sine', 120, 0.7);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.3);
    o.connect(env(t, v, 0.004, 0.6)).connect(drums);
    noise(t, 0.2, 'lowpass', 900, 0.5, v * 0.3, 0.002, 0.15, drums, 0.3);
  };
  const bass = (t: number, m: number, dur: number, v = 0.26, bright = 1) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(260 * bright, t);
    f.frequency.linearRampToValueAtTime(900 * bright, t + 0.02);
    f.frequency.exponentialRampToValueAtTime(240 * bright, t + Math.min(dur, 0.3));
    const g = env(t, v, 0.005, dur);
    f.connect(g).connect(music);
    osc(t, 'sawtooth', mtof(m), dur).connect(f);
    const sub = osc(t, 'sine', mtof(m - 12), dur);
    sub.connect(env(t, v * 0.9, 0.005, dur)).connect(music);
  };
  const pad = (t: number, notes: number[], dur: number, v = 0.03, cutoff = 1500) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + Math.min(0.5, dur * 0.3));
    g.gain.setValueAtTime(v, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    f.connect(g).connect(music);
    send(g, 0.8, verb);
    for (const m of notes) for (const d of [-7, 7]) {
      const o = osc(t, 'sawtooth', mtof(m), dur + 0.4);
      o.detune.value = d;
      o.connect(f);
    }
  };
  const pluck = (t: number, m: number, v = 0.09, type: OscillatorType = 'square', echo = 0.4) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    const g = env(t, v, 0.003, 0.24);
    osc(t, type, mtof(m), 0.3).connect(f).connect(g).connect(music);
    send(g, echo, delay);
  };
  const keys = (t: number, notes: number[], dur: number, v = 0.06) => {
    for (const m of notes) {
      const g = env(t, v, 0.01, dur);
      osc(t, 'sine', mtof(m), dur).connect(g).connect(music);
      const g2 = env(t, v * 0.25, 0.005, dur * 0.4);
      osc(t, 'triangle', mtof(m + 12), dur).connect(g2).connect(music);
      send(g, 0.5, verb);
    }
  };
  const bleep = (t: number, m: number, v = 0.05) => {
    const g = env(t, v, 0.002, 0.07);
    osc(t, 'square', mtof(m), 0.1).connect(g).connect(music);
    send(g, 0.5, delay);
  };

  // Sound effects on the cut
  const boom = (t: number, v = 1) => {
    const o = osc(t, 'sine', 62, 2);
    o.frequency.exponentialRampToValueAtTime(27, t + 1.4);
    o.connect(env(t, v, 0.005, 1.9)).connect(fx);
    noise(t, 1.5, 'lowpass', 220, 0.6, v * 0.55, 0.004, 1.1, fx, 0.4);
    duck(t, 0.15);
  };
  const crash = (t: number, v = 0.16) => noise(t, 2, 'highpass', 4800, 0.5, v, 0.002, 1.6, fx, 0.5);
  const hit = (t: number, v = 0.7) => { kick(t, v, 180); noise(t, 0.3, 'bandpass', 2400, 0.6, v * 0.5, 0.001, 0.14, fx, 0.4); };
  const riser = (t0: number, t1: number, v = 0.2) => {
    if (t1 - t0 < 0.2) return;
    const f = noise(t0, t1 - t0, 'bandpass', 300, 1.4, 0.0002, 0.001, 0.001, fx);
    f.frequency.setValueAtTime(300, t0);
    f.frequency.exponentialRampToValueAtTime(7000, t1);
    // Replace the envelope noise() made with a swell up to the drop.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t1 - 0.02);
    g.gain.linearRampToValueAtTime(0.0001, t1);
    src.connect(f).connect(g).connect(fx);
    send(g, 0.4, verb);
    src.start(t0, 0, Math.min(2, t1 - t0));
    if (t1 - t0 > 2) { const s2 = ctx.createBufferSource(); s2.buffer = noiseBuf; s2.connect(f); s2.start(t0 + 2, 0, t1 - t0 - 2); }
  };
  const whoosh = (t: number, dur: number, v = 0.14) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(fx);
    src.start(t, hash(t * 3) * 1.5, Math.min(2, dur));
  };

  // Arrangement: a build until the title lands, the groove under the features, a breakdown on the close.
  const name = scenes.find((s) => s.kind === 'name');
  const firstBeat = scenes.find((s) => s.kind === 'beat');
  const outro = scenes.find((s) => s.kind === 'outro');
  const drop = plan ? plan.drops[0] ?? 0 : name && name.start > 0 ? name.start : firstBeat?.start ?? B * 8;
  const grooveEnd = plan ? plan.ring : outro!.start + B * 4;
  const beats = Math.ceil(end / B);
  const soft = tr.id === 'soft' || tr.id === 'glow';

  for (let b = 0; b < beats; b++) {
    const t = b * B;
    if (t >= end - 0.05) break;
    const bar = Math.floor(b / 4);
    const bi = b % 4;
    const chord = CHORDS[bar % 4].map((m) => m + shift);
    const root = ROOTS[bar % 4] + shift;
    const main = plan ? plan.full.some(([a, z]) => t >= a - 0.001 && t < z - 0.001) : t >= drop - 0.001 && t < grooveEnd;
    const pre = plan ? !main : t < drop;

    if (bi === 0 && tr.id !== 'pulse') {
      const len = Math.min(4 * B, end - t + 0.6);
      pad(t, tr.id === 'epic' ? [chord[0] - 12, ...chord] : chord, len, tr.id === 'epic' ? 0.034 : soft ? 0.022 : 0.026, tr.id === 'epic' ? 900 : pre ? 700 : 1600);
    }

    switch (tr.id) {
      case 'drive':
        if (main) {
          kick(t);
          if (bi % 2 === 1) clap(t);
          hat(t + B / 2, 0.14, true);
          hat(t + B / 4, 0.05);
          hat(t + (B * 3) / 4, 0.05);
          bass(t + B / 2, root + 12, B * 0.4);
          if (bi === 3) bass(t + B * 0.75, root + 24, B * 0.2, 0.16);
          if (bar % 2 === 1) for (let k = 0; k < 4; k++) pluck(t + (k * B) / 4, chord[(b * 4 + k) % 3] + 12, 0.05);
        } else if (pre) hat(t + B / 2, 0.06);
        break;
      case 'retro':
        if (main) {
          if (bi % 2 === 0) kick(t, 0.95);
          else snare(t, 0.6, 0.7);
          hat(t, 0.07);
          hat(t + B / 2, 0.09);
          bass(t, root + 12, B * 0.45, 0.2, 1.3);
          bass(t + B / 2, root + 24, B * 0.45, 0.16, 1.3);
        }
        for (let k = 0; k < 4; k++) pluck(t + (k * B) / 4, chord[(b * 4 + k) % 3] + (k % 2 ? 12 : 24), pre ? 0.03 : 0.045, 'sawtooth', 0.45);
        break;
      case 'break':
        if (main) {
          if (bi === 0) kick(t, 1, 120);
          if (bi === 1) kick(t + B * 0.75, 0.8, 120);
          if (bi === 2) snare(t, 0.7, 0.4);
          for (let k = 0; k < 4; k++) {
            const r = hash(b * 4 + k);
            hat(t + (k * B) / 4, k % 2 ? 0.05 : 0.09);
            if (r > 0.82) for (let j = 1; j < 3; j++) hat(t + (k * B) / 4 + (j * B) / 12, 0.04);
            if (r < 0.22) bleep(t + (k * B) / 4, chord[k % 3] + 24, 0.035);
          }
          if (bi === 0) bass(t, root + 12, B * 1.6, 0.26, 0.6);
        } else if (pre) hat(t + B / 2, 0.05);
        break;
      case 'epic':
        if (main) {
          if (bi === 0 || bi === 2) tom(t, bi === 0 ? 0.8 : 0.5);
          if (bi === 3) tom(t + B / 2, 0.35);
          bass(t, root + 12, B * 0.45, 0.14, 0.7);
          bass(t + B / 2, root + 12, B * 0.45, 0.1, 0.7);
        }
        if (bi === 0 && !pre) pluck(t, chord[2] + 12, 0.04, 'triangle', 0.6);
        break;
      case 'glow':
        if (main) {
          kick(t, 0.8, 130);
          if (bi % 2 === 1) clap(t, 0.35);
          for (let k = 0; k < 4; k++) noise(t + (k * B) / 4, 0.05, 'bandpass', 6500, 1, k % 2 ? 0.05 : 0.08, 0.002, 0.03, drums);
          keys(t + B / 2, chord.map((m) => m + 12), B * 0.3, 0.035);
          bass(t + B / 2, root + 12, B * 0.35, 0.16, 0.7);
        } else if (pre && bi % 2 === 1) keys(t, chord.map((m) => m + 12), B, 0.025);
        break;
      case 'soft':
        if (bi === 0) keys(t, chord, B * 4, 0.04);
        if (main) {
          if (bi === 0) kick(t, 0.65, 110);
          if (bi === 2) kick(t + B / 2, 0.5, 110);
          if (bi % 2 === 1) snare(t, 0.22, 0.5);
          hat(t, 0.045);
          hat(t + B * 0.62, 0.035);
          if (bi === 0 || bi === 2) bass(t, root + 12, B * 1.6, 0.13, 0.5);
          if (hash(b) > 0.6) pluck(t + B / 2, chord[Math.floor(hash(b + 1) * 3)] + 12, 0.04, 'triangle', 0.5);
        }
        break;
      case 'pulse':
        if (bi === 0) pad(t, chord, Math.min(4 * B, end - t + 0.6), 0.016, 900);
        if (main) {
          kick(t, 0.95);
          hat(t + B / 2, 0.12, true);
          for (let k = 0; k < 4; k++) {
            bass(t + (k * B) / 4, root + 12, B * 0.18, 0.12, 0.8);
            if (hash(b * 4 + k + 7) > 0.45) bleep(t + (k * B) / 4, chord[(b + k) % 3] + 24 + (hash(b + k) > 0.7 ? 12 : 0), 0.04);
          }
        } else if (pre) bleep(t, chord[bi % 3] + 24, 0.03);
        break;
    }
  }

  if (plan) {
    plan.drops.forEach((d, i) => { if (d > B) riser(Math.max(0, d - B * (i ? 8 : 4)), d, 0.22); boom(d, 1); crash(d); });
  } else {
  // Effects on every cut.
  if (drop > B) riser(Math.max(0, drop - Math.min(drop, B * 4)), drop, tr.id === 'epic' ? 0.28 : 0.2);
  scenes.forEach((sc, i) => {
    const t = sc.start;
    if (i === 0) { if (tr.id === 'epic' || sc.kind === 'flash') boom(t, 0.7); return; }
    if (Math.abs(t - drop) < 0.01) { boom(t, 1); crash(t); return; }
    if (sc.kind === 'flash') { whoosh(t - B, B, 0.12); hit(t, 0.75); return; }
    if (sc.kind === 'stat') { hit(t, 0.5); return; }
    if (sc.kind === 'outro') { boom(t, 0.85); crash(t, 0.12); return; }
    if (tr.id === 'epic') { boom(t, 0.55); return; }
    whoosh(t - 0.4, 0.42, 0.08);
  });
  }
  // A last chord rings out under the closing card.
  if (tr.id !== 'epic') pad(grooveEnd, CHORDS[0].map((m) => m + shift + 12), Math.max(0.5, end - grooveEnd), 0.02, 2200);

  return ctx.startRendering();
}

/** A decaying noise tail for the reverb. Deterministic, so preview and export sound the same. */
function impulse(ctx: BaseAudioContext, secs: number, decay: number): AudioBuffer {
  const len = Math.floor(SR * secs);
  const buf = ctx.createBuffer(2, len, SR);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (hash(i * 1.37 + c * 9.1) * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

let actx: AudioContext | null = null;
export const audioContext = () => (actx ??= new AudioContext());

/** Plays the score in step with a Player. Pass it as player.audio. */
export class Sound {
  private src: AudioBufferSourceNode | null = null;
  private token = 0;
  muted = false;
  constructor(private input: () => RenderInput) {}

  async start(at: number) {
    this.stop();
    if (this.muted) return;
    const job = renderMusic(this.input());
    if (!job) return;
    const token = ++this.token;
    const ac = audioContext();
    if (ac.state !== 'running') await ac.resume().catch(() => undefined);
    const t0 = performance.now();
    const buf = await job;
    if (token !== this.token) return;
    // The video kept moving while the score rendered; start the audio where the picture is now.
    const offset = at + (performance.now() - t0) / 1000;
    if (offset >= buf.duration) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start(0, offset);
    this.src = src;
  }

  stop() {
    this.token++;
    try { this.src?.stop(); } catch { /* already stopped */ }
    this.src = null;
  }
}
