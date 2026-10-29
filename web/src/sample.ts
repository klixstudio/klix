import type { RenderInput, RepoView } from './render.ts';
import type { SiteLook, VideoScript } from '../../shared/script.ts';
import { DEFAULTS, THEMES, withStyle } from './render.ts';
import data from './samples.json';
import sites from './site-samples.json';

/** Real repos for the previews, one per style: GitHub facts and a Claude script, snapshotted by scripts/samples.ts. */
export const SAMPLES_DATE: string = data.fetchedAt;
const SAMPLES = data.samples as { style: string; repo: RepoView; script: VideoScript }[];

const make = (x: (typeof SAMPLES)[number]): RenderInput => ({ ...DEFAULTS, theme: THEMES[0], repo: x.repo, script: x.script, stats: true });

/** The default sample: the first repo in the snapshot. */
export const SAMPLE: RenderInput = withStyle(make(SAMPLES[0]), SAMPLES[0].style);

/** The repo shown with a style, in that style. Falls back to the default sample. */
export function sampleFor(style: string): RenderInput {
  const x = SAMPLES.find((s) => s.style === style);
  return withStyle(x ? make(x) : SAMPLE, style);
}

/** Real websites for the website previews: page text, the site's own colours and fonts, written up by Claude.
 *  Snapshotted by scripts/site-samples.ts, with each site's preview image saved under /samples. */
export const SITES_DATE: string = sites.fetchedAt;
export const SITE_SAMPLES = (sites.samples as unknown as { repo: RepoView; script: VideoScript; look: SiteLook }[]).map((x) => {
  const l = x.look;
  const theme = { id: 'site', label: x.repo.name, bg: l.bg, bg2: l.bg2, ink: l.ink, muted: l.ink + (l.light ? 'a0' : '99'), accents: l.accents, light: l.light };
  const input: RenderInput = { ...withStyle({ ...DEFAULTS, theme: THEMES[0], repo: x.repo, script: x.script, stats: false }, l.style), theme, font: l.nearestFont, code: false, stats: false };
  return { input, look: l };
});
