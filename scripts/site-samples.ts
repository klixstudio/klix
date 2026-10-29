// Builds the website previews from real sites: page text, the site's own colours and fonts, its preview image,
// and a script and look picked by Claude. Images are saved next to the site so the previews need no proxy.
// Run: npx tsx scripts/site-samples.ts   (needs ANTHROPIC_API_KEY in .env)
import '../server/env.ts';
import fs from 'node:fs';
import { loadSite, parseSite, safeFetch } from '../server/site.ts';
import { writeSiteScript } from '../server/writer.ts';
import { STYLES, THEMES, FONTS, TRACKS, TRANSITIONS } from '../web/src/render.ts';

const SITES = ['linear.app', 'vercel.com', 'raycast.com', 'stripe.com', 'notion.com', 'figma.com', 'supabase.com', 'framer.com', 'resend.com', 'arc.net', 'cursor.com'];
const WANT = 8;

const catalog = {
  styles: STYLES.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb })),
  palettes: THEMES.map((t) => ({ id: t.id, label: t.label })),
  fonts: FONTS.map((f) => ({ id: f.id, label: f.label })),
  tracks: TRACKS.map((t) => ({ id: t.id, label: t.label, mood: t.mood })),
  transitions: TRANSITIONS.map((t) => ({ id: t.id, label: t.label })),
};

fs.mkdirSync('web/public/samples', { recursive: true });
const out: Record<string, unknown>[] = [];
for (const site of SITES) {
  if (out.length >= WANT) break;
  try {
    const bundle = await loadSite(parseSite(site));
    const { script, look, by } = await writeSiteScript(bundle, catalog);
    let image = '';
    if (bundle.facts.image) {
      const { body, type } = await safeFetch(bundle.facts.image, 'image/*', 6_000_000);
      const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : '';
      if (ext) {
        const file = `${bundle.facts.owner.replace(/[^\w.-]/g, '-')}.${ext}`;
        fs.writeFileSync(`web/public/samples/${file}`, body);
        image = `/samples/${file}`;
      }
    }
    const f = bundle.facts;
    out.push({
      repo: { kind: 'site', owner: f.owner, name: f.name, url: f.url, stars: 0, forks: 0, language: '', license: '', release: '', image },
      script,
      look,
      by,
    });
    console.log(`ok   ${site}: ${look.style}, bg ${look.bg}, accent ${look.accents[0]}, font ${look.fontFamily || '-'} -> ${look.nearestFont}, image ${image ? 'yes' : 'no'} | ${script.hook}`);
  } catch (e) {
    console.log(`FAIL ${site}: ${(e as Error).message}`);
  }
}
fs.writeFileSync('web/src/site-samples.json', JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), samples: out }, null, 2) + '\n');
console.log(`wrote ${out.length} website samples`);
