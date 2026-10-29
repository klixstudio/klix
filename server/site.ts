// Reads a public web page for the website mode: title, description, headings, body text and the preview image.
// The server fetches URLs a visitor typed, so every hop is checked: http(s) only, public addresses only,
// a few redirects at most, a time limit and a size limit.
import dns from 'node:dns/promises';
import net from 'node:net';
import type { RepoFacts } from '../shared/script.ts';
import { RepoError } from './github.ts';

export interface SiteBundle {
  facts: RepoFacts;
  /** Visible text of the page, trimmed, for Claude to read. */
  text: string;
  headings: string[];
  /** The site's own look, read from its CSS: named colour tokens, the most used colours, and its fonts. */
  look: { themeColor: string; body: { bg: string; ink: string }; tokens: { name: string; hex: string }[]; common: string[]; fonts: string[] };
  /** Changes once a day, so cached scripts refresh on their own. */
  version: string;
}

/** Private, loopback, link-local and other non-public ranges. */
function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function checkHost(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RepoError('Only http and https links work.');
  if (url.username || url.password) throw new RepoError('Links with a login in them are not allowed.');
  if (url.port && !['80', '443'].includes(url.port)) throw new RepoError('Only standard web ports work.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new RepoError('That website could not be found.', 404);
  if (addrs.some((a) => isPrivate(a.address))) throw new RepoError('That address is not a public website.');
}

/** Fetches a public URL with the checks above on every redirect. Returns the response and the final URL. */
export async function safeFetch(raw: string, accept: string, maxBytes: number): Promise<{ body: Buffer; type: string; url: URL }> {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    await checkHost(url);
    const r = await fetch(url, { redirect: 'manual', headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0 (compatible; KlixBot/1.0)' }, signal: AbortSignal.timeout(9000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location')!, url); continue; }
    if (!r.ok) throw new RepoError(`The website answered ${r.status}.`, 502);
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new RepoError('That page is too large to read.', 413);
    const reader = r.body!.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); break; }
      parts.push(value);
    }
    return { body: Buffer.concat(parts), type: r.headers.get('content-type') ?? '', url };
  }
  throw new RepoError('Too many redirects.', 502);
}

/** Accepts "example.com", "https://example.com/page" and the like. */
export function parseSite(input: string): string {
  const s = input.trim();
  if (!s || s.length > 500) throw new RepoError('Paste a website address, for example linear.app.');
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes('.')) throw new Error();
    u.hash = '';
    return u.toString();
  } catch {
    throw new RepoError('That does not look like a website address.');
  }
}

const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const strip = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function meta(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (name === key) return decode(tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').trim();
  }
  return '';
}

export async function loadSite(raw: string): Promise<SiteBundle> {
  const { body, type, url } = await safeFetch(raw, 'text/html,application/xhtml+xml', 2_000_000);
  if (!/html/i.test(type)) throw new RepoError('That link is not a web page.');
  const html = body.toString('utf8');
  const clean = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const title = strip(clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const siteName = meta(html, 'og:site_name') || meta(html, 'application-name');
  const description = meta(html, 'og:description') || meta(html, 'description') || meta(html, 'twitter:description');
  const imageRaw = meta(html, 'og:image') || meta(html, 'og:image:url') || meta(html, 'twitter:image');
  let image = '';
  try { if (imageRaw) { const u = new URL(imageRaw, url); if (/^https?:$/.test(u.protocol)) image = u.toString(); } } catch { /* bad image url */ }
  const headings = [...clean.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => strip(m[2])).filter((h) => h.length > 2 && h.length < 140).slice(0, 14);
  const text = strip(clean.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? clean).slice(0, 12_000);
  if (text.length < 40 && !description) throw new RepoError('That page has almost no text Klix can read. It may need JavaScript to show anything.', 422);

  const look = await readLook(html, url);
  const host = url.hostname.replace(/^www\./, '');
  const brand = (siteName || title.split(/\s[|·–—-]\s/)[0] || host.split('.')[0]).trim().slice(0, 40);
  return {
    facts: {
      kind: 'site',
      owner: host,
      name: brand,
      fullName: host + (url.pathname !== '/' ? url.pathname : ''),
      url: url.toString().replace(/\/$/, ''),
      description: description.slice(0, 300),
      stars: 0, forks: 0, language: '', languages: [], license: '', topics: [], release: '',
      image,
    },
    text,
    headings,
    look,
    version: new Date().toISOString().slice(0, 10),
  };
}

// Colour parsing: hex, rgb(), hsl(), bare "h s% l%" tokens (shadcn style) and oklch() (Tailwind 4).
const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
function hslHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
function oklchHex(L: number, C: number, H: number) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const g = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055);
  return rgbHex(g(lin[0]), g(lin[1]), g(lin[2]));
}
export function toHex(v: string): string {
  const s = v.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})\b/);
  if (m) { const x = m[1]; return x.length === 3 || x.length === 4 ? `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}` : `#${x.slice(0, 6)}`; }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return rgbHex(+m[1], +m[2], +m[3]);
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/) ?? s.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (m) return hslHex(+m[1], +m[2], +m[3]);
  m = s.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/);
  if (m) return oklchHex(m[2] ? +m[1] / 100 : +m[1], +m[3], +m[4]);
  return '';
}

const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/gi;
const GENERIC = /^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica neue|helvetica|arial|noto sans|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|emoji|var\(.*|cursive|fantasy)$/i;

/** Reads colours and fonts from the page's inline styles and up to four stylesheets. */
async function readLook(html: string, base: URL): Promise<SiteBundle['look']> {
  let css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /rel\s*=\s*["'][^"']*stylesheet/i.test(t));
  const googleFonts: string[] = [];
  const hrefs: string[] = [];
  for (const t of links) {
    const href = t.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const u = new URL(decode(href), base);
    if (u.hostname === 'fonts.googleapis.com') { for (const f of u.searchParams.getAll('family')) googleFonts.push(f.split(':')[0].replace(/\+/g, ' ')); continue; }
    hrefs.push(u.toString());
  }
  const sheets = await Promise.all(hrefs.slice(0, 4).map((h) => safeFetch(h, 'text/css', 600_000).then((r) => r.body.toString('utf8')).catch(() => '')));
  css += '\n' + sheets.join('\n');
  // Inline style attributes carry colours too on many landing pages.
  css += '\n' + [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(';').slice(0, 100_000);

  const tokens: { name: string; hex: string }[] = [];
  const seen = new Set<string>();
  for (const m of css.matchAll(/--([\w-]{2,40})\s*:\s*([^;{}]{3,80})/g)) {
    const name = m[1];
    if (!/primary|brand|accent|background|^bg|foreground|^fg|text|surface|base|highlight|secondary|main|ink|card|muted|border|ring|theme/i.test(name)) continue;
    const hex = toHex(m[2]);
    if (!hex || seen.has(name)) continue;
    seen.add(name);
    tokens.push({ name, hex });
    if (tokens.length >= 40) break;
  }
  const counts = new Map<string, number>();
  for (const m of css.matchAll(COLOR)) { const h = toHex(m[0]); if (h) counts.set(h, (counts.get(h) ?? 0) + 1); }
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([h]) => h);

  const rule = (sel: string) => css.match(new RegExp(`(?:^|[}\\s,])${sel}\\s*[,{][^}]*}`, 'i'))?.[0] ?? '';
  const pick = (block: string, prop: RegExp) => { const v = block.match(prop)?.[1]; return v ? toHex(v) : ''; };
  const bodyRule = rule('body') + rule('html') + rule(':root');
  const body = { bg: pick(bodyRule, /background(?:-color)?\s*:\s*([^;}]+)/i), ink: pick(bodyRule, /(?:^|[;{\s])color\s*:\s*([^;}]+)/i) };

  const fonts = new Map<string, number>();
  for (const f of googleFonts) fonts.set(f, (fonts.get(f) ?? 0) + 5);
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].trim().replace(/^["']|["']$/g, '').replace(/^__/, '').replace(/_[0-9a-f]{4,}$/i, '').replace(/[_ ]Fallback.*$/i, '').replace(/_/g, ' ').trim();
    if (!first || GENERIC.test(first) || first.length > 40) continue;
    fonts.set(first, (fonts.get(first) ?? 0) + 1);
  }
  return {
    themeColor: toHex(meta(html, 'theme-color')),
    body,
    tokens,
    common,
    fonts: [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f]) => f),
  };
}
