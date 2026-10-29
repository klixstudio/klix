// The API, free of any web framework, so the Node server (index.ts) and the Cloudflare Worker (worker.ts) share it.
// Each host supplies storage for cached scripts and the daily allowance counter.
import type { ScriptResponse } from '../shared/script.ts';
import { loadRepo, parseRepo, RepoError } from './github.ts';
import { MOCK, MODEL, writeScript, writeSiteScript, direct, WriterRefused, type Catalog } from './writer.ts';
import { loadSite, parseSite, safeFetch } from './site.ts';

export const PER_IP_PER_DAY = Number(process.env.SCRIPTS_PER_IP_PER_DAY ?? 5);
/** Total Claude calls per day across all visitors, so the bill has a ceiling even when someone rotates IPs. */
export const PER_DAY = Number(process.env.CLAUDE_CALLS_PER_DAY ?? 150);

export type Cached = Omit<ScriptResponse, 'cached'> & { version: string };

export interface Host {
  /** Cached scripts by key ("owner/name" or "site:url"), and the image allowlist ("img:url"). */
  get(key: string): Promise<Cached | true | undefined>;
  put(key: string, value: Cached | true): Promise<void>;
  /** Counts one Claude call for this IP today. "ip" or "all" when a limit is already reached. */
  take(ip: string): Promise<'ok' | 'ip' | 'all'>;
}

export interface Reply { status: number; json: unknown }

const today = () => new Date().toISOString().slice(0, 10);
const ok = (json: unknown): Reply => ({ status: 200, json });
const fail = (status: number, error: string): Reply => ({ status, json: { error } });

const limited = (why: 'ip' | 'all', rest: string) => fail(429, why === 'all'
  ? 'Klix is at its daily limit for everyone. Try again tomorrow; you can still edit any script by hand.'
  : `Daily limit reached (${PER_IP_PER_DAY} per day). ${rest}`);

/** The option lists the browser sends, checked for shape and size before they reach Claude. */
function readCatalog(raw: unknown): Catalog {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (key: string, fields: string[]) => {
    const v = r[key];
    if (!Array.isArray(v) || !v.length || v.length > 40) throw new RepoError('Bad option list.');
    return v.map((x) => {
      const o: Record<string, string> = {};
      for (const k of fields) { const val = (x as Record<string, unknown>)?.[k]; if (typeof val !== 'string' || val.length > 160) throw new RepoError('Bad option list.'); o[k] = val; }
      if (!/^[\w-]{1,30}$/.test(o.id)) throw new RepoError('Bad option list.');
      return o;
    });
  };
  return {
    styles: list('styles', ['id', 'label', 'blurb']) as Catalog['styles'],
    palettes: list('palettes', ['id', 'label']) as Catalog['palettes'],
    fonts: list('fonts', ['id', 'label']) as Catalog['fonts'],
    tracks: list('tracks', ['id', 'label', 'mood']) as Catalog['tracks'],
    transitions: list('transitions', ['id', 'label']) as Catalog['transitions'],
  };
}

const cachedFor = (v: Cached | true | undefined) => (v && v !== true && v.by === (MOCK ? 'rules' : 'claude') ? v : undefined);

async function script(body: Record<string, unknown>, ip: string, host: Host): Promise<Reply> {
  const { owner, name } = parseRepo(String(body.repo ?? ''));
  const fresh = body.fresh === true;
  const bundle = await loadRepo(owner, name);
  const key = bundle.facts.fullName.toLowerCase();
  const hit = cachedFor(await host.get(key));
  if (hit && hit.version === bundle.version && !fresh) {
    const { version: _v, ...rest } = hit;
    return ok({ ...rest, repo: bundle.facts, cached: true } satisfies ScriptResponse);
  }
  if (!MOCK) {
    const t = await host.take(ip);
    if (t !== 'ok') return limited(t, 'Repos made before still load, and you can edit any script by hand.');
  }
  const { script, by, model } = await writeScript(bundle);
  await host.put(key, { repo: bundle.facts, script, by, model, version: bundle.version });
  return ok({ repo: bundle.facts, script, by, model, cached: false } satisfies ScriptResponse);
}

async function site(body: Record<string, unknown>, ip: string, host: Host): Promise<Reply> {
  const url = parseSite(String(body.url ?? ''));
  const catalog = readCatalog(body.catalog);
  const fresh = body.fresh === true;
  const key = 'site:' + url.toLowerCase();
  const hit = cachedFor(await host.get(key));
  if (hit && hit.version === today() && !fresh) {
    const { version: _v, ...rest } = hit;
    return ok({ ...rest, cached: true } satisfies ScriptResponse);
  }
  const bundle = await loadSite(url);
  if (!MOCK) {
    const t = await host.take(ip);
    if (t !== 'ok') return limited(t, 'You can still edit any script by hand.');
  }
  const { script, look, by, model } = await writeSiteScript(bundle, catalog);
  if (bundle.facts.image) await host.put('img:' + bundle.facts.image, true);
  await host.put(key, { repo: bundle.facts, script, look, by, model, version: bundle.version });
  return ok({ repo: bundle.facts, script, look, by, model, cached: false } satisfies ScriptResponse);
}

async function directRoute(body: Record<string, unknown>, ip: string, host: Host): Promise<Reply> {
  const brief = String(body.brief ?? '').trim();
  if (brief.length < 4) return fail(400, 'Describe the video you want in a sentence or two.');
  if (brief.length > 2000) return fail(400, 'Keep the description under 2000 characters.');
  const catalog = readCatalog(body.catalog);
  const current = body.current as { script: ScriptResponse['script']; facts: Record<string, unknown>; settings: Record<string, unknown> } | undefined;
  if (!current?.script?.hook || !Array.isArray(current.script.beats)) return fail(400, 'Load a repo, a website or the sample first.');
  if (MOCK) return fail(503, 'Describe needs Claude, and the server is in test mode.');
  const t = await host.take(ip);
  if (t !== 'ok') return limited(t, 'Describe uses the same allowance as new scripts.');
  return ok(await direct(brief, catalog, current));
}

const ROUTES: Record<string, { run: typeof script; broke: string; refused: string }> = {
  '/api/script': { run: script, broke: 'Something broke while writing the script. Try again.', refused: 'Claude declined to write a script for this repo.' },
  '/api/site': { run: site, broke: 'Something broke while reading the website. Try again.', refused: 'Claude declined to write a script for this website.' },
  '/api/direct': { run: directRoute, broke: 'Something broke while directing. Try again.', refused: 'Claude declined that description.' },
};

/** Handles a POST to one of the API routes. Returns null for an unknown path. */
export async function handle(path: string, body: unknown, ip: string, host: Host): Promise<Reply | null> {
  const route = ROUTES[path];
  if (!route) return null;
  try {
    return await route.run((body ?? {}) as Record<string, unknown>, ip, host);
  } catch (err) {
    if (err instanceof RepoError) return fail(err.status, err.message);
    if (err instanceof WriterRefused) return fail(422, route.refused);
    console.error(err);
    return fail(500, route.broke);
  }
}

export const health = () => ({ ok: true, mode: MOCK ? 'test' : 'claude', model: MOCK ? 'test-mode' : MODEL });

/** Same-origin copy of a website's preview image, so the canvas can draw it and still export.
 *  Only images the server has seen on a page it read can come through. */
export async function image(u: string, host: Host): Promise<{ status: number; body?: Uint8Array; type?: string }> {
  if (!u || (await host.get('img:' + u)) !== true) return { status: 404 };
  try {
    const { body, type } = await safeFetch(u, 'image/*', 6_000_000);
    if (!/^image\/(png|jpe?g|webp|gif|avif)/i.test(type)) return { status: 415 };
    return { status: 200, body, type };
  } catch {
    return { status: 502 };
  }
}
