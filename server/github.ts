import type { RepoFacts } from '../shared/script.ts';

const API = 'https://api.github.com';

export class RepoError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Accepts "owner/name", "github.com/owner/name" or a full URL with extra path parts. */
export function parseRepo(input: string): { owner: string; name: string } {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:[/?].*)?$/);
  if (!m) throw new RepoError('That does not look like a GitHub repo. Try github.com/owner/repo.');
  return { owner: m[1], name: m[2] };
}

function headers(accept = 'application/vnd.github+json'): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, 'User-Agent': 'klix', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function get(path: string, accept?: string): Promise<Response> {
  const r = await fetch(API + path, { headers: headers(accept), signal: AbortSignal.timeout(10_000) });
  if (r.status === 403 || r.status === 429) throw new RepoError('GitHub rate limit reached. Try again in a few minutes.', 503);
  return r;
}

export interface RepoBundle {
  facts: RepoFacts;
  readme: string;
  codeBlocks: { lang: string; text: string }[];
  /** Changes whenever the repo gets a new push, so cached scripts go stale on their own. */
  version: string;
}

export async function loadRepo(owner: string, name: string): Promise<RepoBundle> {
  const r = await get(`/repos/${owner}/${name}`);
  if (r.status === 404) throw new RepoError('Repo not found. Klix only reads public repos.', 404);
  if (!r.ok) throw new RepoError(`GitHub answered ${r.status}.`, 502);
  const repo = await r.json() as {
    owner: { login: string }; name: string; full_name: string; html_url: string; description: string | null;
    stargazers_count: number; forks_count: number; language: string | null; license: { spdx_id: string } | null;
    topics?: string[]; pushed_at: string; private: boolean;
  };

  const [readmeRes, langRes, relRes] = await Promise.all([
    get(`/repos/${owner}/${name}/readme`, 'application/vnd.github.raw+json'),
    get(`/repos/${owner}/${name}/languages`),
    get(`/repos/${owner}/${name}/releases/latest`),
  ]);
  const readme = readmeRes.ok ? (await readmeRes.text()).slice(0, 40_000) : '';
  const languages = langRes.ok ? Object.keys(await langRes.json() as Record<string, number>).slice(0, 5) : [];
  const release = relRes.ok ? ((await relRes.json()) as { tag_name: string }).tag_name : '';

  const license = repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : '';
  return {
    facts: {
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description ?? '',
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language ?? languages[0] ?? '',
      languages,
      license,
      topics: (repo.topics ?? []).slice(0, 6),
      release,
    },
    readme,
    codeBlocks: codeBlocks(readme),
    version: `${repo.pushed_at}|${release}`,
  };
}

/** Fenced code blocks from the README. The video only ever shows code copied from here. */
export function codeBlocks(readme: string): { lang: string; text: string }[] {
  const out: { lang: string; text: string }[] = [];
  const re = /^```([\w+-]*)[^\n]*\n([\s\S]*?)^```/gm;
  for (const m of readme.matchAll(re)) {
    const text = m[2].replace(/\s+$/, '');
    if (!text.trim() || text.length > 1500) continue;
    out.push({ lang: m[1] || 'text', text });
    if (out.length >= 12) break;
  }
  return out;
}
