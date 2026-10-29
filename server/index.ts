// The Node server, for running Klix on your own machine. The deployed site runs worker.ts on Cloudflare instead.
import './env.ts';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import express from 'express';
import { handle, health, image, PER_DAY, PER_IP_PER_DAY, type Cached, type Host } from './api.ts';
import { MOCK, MODEL } from './writer.ts';

const PORT = Number(process.env.PORT ?? 8787);
const CACHE_FILE = 'data/cache.json';
const USAGE_FILE = 'data/usage.json';

const save = (file: string, value: unknown) => {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const read = <T>(file: string, fallback: T): T => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

// Cached scripts and the image allowlist live in one JSON file. Images on cached sites stay allowed.
const store: Record<string, Cached | true> = read(CACHE_FILE, {});
for (const v of Object.values(store)) if (v !== true && v.repo.image) store['img:' + v.repo.image] = true;

// Claude calls per IP and in total per day, so strangers cannot drain the API credit. Counts survive restarts.
type Usage = { day: string; total: number; ips: Record<string, number> };
const day = () => new Date().toISOString().slice(0, 10);
let usage: Usage = read(USAGE_FILE, { day: day(), total: 0, ips: {} });

const host: Host = {
  get: async (key) => store[key],
  put: async (key, value) => { store[key] = value; save(CACHE_FILE, store); },
  take: async (ip) => {
    if (usage.day !== day()) usage = { day: day(), total: 0, ips: {} };
    if (usage.total >= PER_DAY) return 'all';
    const n = usage.ips[ip] ?? 0;
    if (n >= PER_IP_PER_DAY) return 'ip';
    usage.ips[ip] = n + 1;
    usage.total++;
    save(USAGE_FILE, usage);
    return 'ok';
  },
};

const app = express();
// Behind a proxy set TRUST_PROXY=1. Trusting every hop would let a visitor fake X-Forwarded-For to dodge the per-IP limit.
const TRUST = process.env.TRUST_PROXY;
app.set('trust proxy', TRUST ? (Number(TRUST) || TRUST) : 'loopback');
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => { res.json(health()); });

app.get('/api/image', async (req, res) => {
  const r = await image(String(req.query.u ?? ''), host);
  if (!r.body) return res.status(r.status).end();
  res.set({ 'Content-Type': r.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(r.body));
});

app.post('/api/*path', async (req, res, next) => {
  const r = await handle(req.path, req.body, req.ip ?? 'unknown', host);
  if (!r) return next();
  res.status(r.status).json(r.json);
});

// Production: serve the built site with clean paths (/ and /make).
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.get('/make', (_req, res) => res.sendFile(path.join(dist, 'make', 'index.html')));
  app.use(express.static(dist, { redirect: false }));
}

app.listen(PORT, () => console.log(`Klix server on http://localhost:${PORT} (${MOCK ? 'test mode, no Claude' : `Claude ${MODEL}`})`));

// For testing on a phone over Wi-Fi: browsers only allow the fast export (WebCodecs) on HTTPS, so with
// LAN_HTTPS_PORT set the server also listens on HTTPS with the self-signed cert in data/.
const LAN_HTTPS_PORT = Number(process.env.LAN_HTTPS_PORT ?? 0);
if (LAN_HTTPS_PORT && fs.existsSync('data/lan-cert.pem')) {
  https.createServer({ cert: fs.readFileSync('data/lan-cert.pem'), key: fs.readFileSync('data/lan-key.pem') }, app)
    .listen(LAN_HTTPS_PORT, () => console.log(`LAN HTTPS on port ${LAN_HTTPS_PORT}`));
}
