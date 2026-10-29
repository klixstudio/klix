// Shapes shared by the server and the browser renderer.

export interface RepoFacts {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  languages: string[];
  license: string;
  topics: string[];
  release: string;
  /** "site" when the source is a website instead of a GitHub repo. */
  kind?: 'repo' | 'site';
  /** Preview image of a website (og:image), shown as the product shot. */
  image?: string;
}

export interface Beat {
  title: string;
  body: string;
}

export interface VideoScript {
  hook: string;
  tagline: string;
  beats: Beat[];
  code: { lang: string; text: string };
  cta: string;
}

/** A website's own look, read from its CSS and picked by Claude: the video wears these colours and fonts. */
export interface SiteLook {
  style: string;
  bg: string;
  bg2: string;
  ink: string;
  accents: [string, string, string];
  light: boolean;
  /** The site's display font as named in its CSS, or ''. */
  fontFamily: string;
  /** The closest Klix font, used when the site's own font cannot be loaded. */
  nearestFont: string;
}

export interface ScriptResponse {
  repo: RepoFacts;
  script: VideoScript;
  /** "claude" when Claude wrote it, "rules" when the server ran in test mode. */
  by: 'claude' | 'rules';
  model: string;
  cached: boolean;
  /** Website mode only. */
  look?: SiteLook;
}

export const LIMITS = {
  hook: 56,
  tagline: 110,
  beatTitle: 30,
  beatBody: 100,
  cta: 40,
  codeLines: 9,
  beatsMin: 3,
  beatsMax: 4,
};
