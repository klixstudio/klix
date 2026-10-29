// Frame-by-frame export with WebCodecs: each frame is drawn at its exact time and encoded to H.264,
// the score is encoded to AAC, and both are muxed into an MP4. Not tied to the screen's refresh rate,
// so 90 and 120 fps come out exact, and the tab can be in the background.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { drawFrame, duration, frameSize, bitrate, type RenderInput } from './render.ts';
import { renderMusic } from './music.ts';

// H.264 levels: [level byte, max macroblocks per second, max macroblocks per frame].
const LEVELS: [number, number, number][] = [[0x28, 245760, 8192], [0x2a, 522240, 8704], [0x32, 589824, 22080], [0x33, 983040, 36864], [0x34, 2073600, 36864], [0x3c, 4177920, 139264], [0x3d, 8355840, 139264], [0x3e, 16711680, 139264]];
const AAC = { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 192_000 };

/** The lowest H.264 High level that covers this size and rate and that the browser can encode, or null. */
export async function videoCodec(w: number, h: number, fps: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  const fitting = LEVELS.filter(([, rate, frame]) => rate >= mbs * fps && frame >= mbs).map(([lv]) => `avc1.6400${hex(lv)}`);
  for (const codec of [...fitting, 'avc1.64003E', 'avc1.640028', 'avc1.4D0034', 'avc1.42003E']) {
    const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 8e6, framerate: fps }).catch(() => null);
    if (r?.supported) return codec;
  }
  return null;
}

export async function encodeOffline(input: RenderInput, onProgress: (p: number) => void): Promise<{ blob: Blob; audio: boolean } | null> {
  const [w, h] = frameSize(input.format, input.resolution);
  const fps = input.fps;
  const codec = await videoCodec(w, h, fps);
  if (!codec) return null;
  const job = renderMusic(input);
  const music = job ? await job : null;
  const audio = Boolean(music) && typeof AudioEncoder !== 'undefined' && Boolean((await AudioEncoder.isConfigSupported(AAC).catch(() => null))?.supported);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: w, height: h, frameRate: fps },
    audio: audio ? { codec: 'aac', numberOfChannels: 2, sampleRate: AAC.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure: Error | null = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  venc.configure({ codec, width: w, height: h, bitrate: bitrate(input), framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const total = duration(input);
  const frames = Math.round(total * fps);
  const step = 1e6 / fps;
  const share = audio ? 0.94 : 1;
  for (let i = 0; i < frames; i++) {
    drawFrame(ctx, input, Math.min(i / fps, total - 0.0001));
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // Keep the encoder queue short so memory stays flat, and let the page breathe.
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    if (i % 6 === 0) { onProgress((i / frames) * share); await new Promise((r) => setTimeout(r, 0)); }
    if (failure) throw failure;
  }
  await venc.flush();
  venc.close();

  if (audio && music) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failure = e; } });
    aenc.configure(AAC);
    const len = Math.min(music.length, Math.ceil(total * music.sampleRate));
    const L = music.getChannelData(0);
    const R = music.getChannelData(1);
    const CH = 4096;
    for (let off = 0; off < len; off += CH) {
      const n = Math.min(CH, len - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: music.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off * 1e6) / music.sampleRate), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
    onProgress(1);
  }
  if (failure) throw failure;
  muxer.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), audio };
}
