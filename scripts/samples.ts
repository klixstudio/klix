// Builds the preview samples from real repos: facts from the GitHub API, script written by Claude.
// Run: npx tsx scripts/samples.ts   (needs ANTHROPIC_API_KEY and GITHUB_TOKEN in .env)
// The result is a dated snapshot in web/src/samples.json; numbers on GitHub keep moving after that.
import '../server/env.ts';
import fs from 'node:fs';
import { loadRepo } from '../server/github.ts';
import { writeScript } from '../server/writer.ts';

/** One big, well-known repo per style. */
const PICKS: [style: string, repo: string][] = [
  ['editorial', 'facebook/react'],
  ['cinematic', 'microsoft/vscode'],
  ['kinetic', 'vercel/next.js'],
  ['minimal', 'tailwindlabs/tailwindcss'],
  ['terminal', 'oven-sh/bun'],
  ['glitch', 'denoland/deno'],
  ['swiss', 'sveltejs/svelte'],
  ['neon', 'vitejs/vite'],
  ['luxe', 'supabase/supabase'],
  ['aurora', 'shadcn-ui/ui'],
  ['brutal', 'rust-lang/rust'],
  ['pop', 'microsoft/TypeScript'],
  ['blueprint', 'golang/go'],
  ['noir', 'torvalds/linux'],
  ['mesh', 'tauri-apps/tauri'],
  ['keynote', 'nodejs/node'],
];

const out: Record<string, unknown>[] = [];
const queue = [...PICKS];
async function worker() {
  for (let pick = queue.shift(); pick; pick = queue.shift()) {
    const [style, full] = pick;
    const [owner, name] = full.split('/');
    try {
      const bundle = await loadRepo(owner, name);
      const { script, by, model } = await writeScript(bundle);
      const f = bundle.facts;
      out.push({
        style,
        repo: { owner: f.owner, name: f.name, url: f.url, stars: f.stars, forks: f.forks, language: f.language, license: f.license, release: f.release },
        script,
        by,
        model,
      });
      console.log(`ok   ${full} (${style}) by ${by}: ${script.hook}`);
    } catch (e) {
      console.log(`FAIL ${full}: ${(e as Error).message}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
out.sort((a, b) => PICKS.findIndex(([s]) => s === a.style) - PICKS.findIndex(([s]) => s === b.style));
fs.writeFileSync('web/src/samples.json', JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), samples: out }, null, 2) + '\n');
console.log(`wrote ${out.length} samples`);
