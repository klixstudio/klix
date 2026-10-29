// The deployed Klix: a Cloudflare Worker that serves the built site (dist) and the API from api.ts.
// Cached scripts live in KV. The daily allowance counter lives in one Durable Object, so it stays exact
// under bursts, where KV's eventual consistency and one-write-per-second-per-key would undercount.
import { DurableObject } from 'cloudflare:workers';
import { handle, health, image, PER_DAY, PER_IP_PER_DAY, type Cached, type Host } from './api.ts';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  CACHE: {
    get(key: string, type: 'json'): Promise<unknown>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  };
  USAGE: { idFromName(name: string): unknown; get(id: unknown): { take(ip: string, perIp: number, perDay: number): Promise<'ok' | 'ip' | 'all'> } };
}

export class Usage extends DurableObject {
  async take(ip: string, perIp: number, perDay: number): Promise<'ok' | 'ip' | 'all'> {
    const s = this.ctx.storage;
    const day = new Date().toISOString().slice(0, 10);
    if ((await s.get('day')) !== day) { await s.deleteAll(); await s.put('day', day); }
    const total = (await s.get<number>('total')) ?? 0;
    if (total >= perDay) return 'all';
    const n = (await s.get<number>('ip:' + ip)) ?? 0;
    if (n >= perIp) return 'ip';
    await s.put({ total: total + 1, ['ip:' + ip]: n + 1 });
    return 'ok';
  }
}

const MONTH = 60 * 60 * 24 * 30;

/** KV keys top out at 512 bytes, and page URLs can be longer, so long keys are hashed. */
async function kvKey(key: string): Promise<string> {
  if (key.length <= 400) return key;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return 'sha:' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const host: Host = {
      get: async (key) => ((await env.CACHE.get(await kvKey(key), 'json')) ?? undefined) as Cached | true | undefined,
      put: async (key, value) => env.CACHE.put(await kvKey(key), JSON.stringify(value), { expirationTtl: MONTH }),
      take: (who) => env.USAGE.get(env.USAGE.idFromName('global')).take(who, PER_IP_PER_DAY, PER_DAY),
    };

    if (url.pathname === '/api/health') return Response.json(health());
    if (url.pathname === '/api/image') {
      const r = await image(url.searchParams.get('u') ?? '', host);
      if (!r.body) return new Response(null, { status: r.status });
      return new Response(r.body as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': r.type!, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') return Response.json({ error: 'Not found.' }, { status: 404 });
      const text = await req.text();
      if (text.length > 64 * 1024) return Response.json({ error: 'Request too large.' }, { status: 413 });
      let body: unknown;
      try { body = JSON.parse(text || '{}'); } catch { return Response.json({ error: 'Bad JSON.' }, { status: 400 }); }
      const r = await handle(url.pathname, body, ip, host);
      return r ? Response.json(r.json, { status: r.status }) : Response.json({ error: 'Not found.' }, { status: 404 });
    }
    return env.ASSETS.fetch(req);
  },
};
