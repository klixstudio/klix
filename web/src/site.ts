// Behaviour shared by both pages: the nav, scroll buttons and reveal-on-scroll. No hash links anywhere.

export function initSite() {
  const nav = document.getElementById('nav');
  const onScroll = () => nav?.classList.toggle('solid', scrollY > 24);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  for (const b of document.querySelectorAll<HTMLElement>('[data-go]')) {
    b.addEventListener('click', () => {
      const target = document.querySelector(`[data-anchor="${b.dataset.go}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else location.href = `/?go=${b.dataset.go}`;
    });
  }

  // Coming from the studio with ?go=features: scroll there, then drop the query.
  const go = new URLSearchParams(location.search).get('go');
  if (go) {
    const target = document.querySelector(`[data-anchor="${go}"]`);
    history.replaceState(null, '', location.pathname);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      const siblings = [...(el.parentElement?.children ?? [])].filter((c) => c.classList.contains('reveal'));
      el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 5) * 80}ms`;
      el.classList.add('in');
      io.unobserve(el);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // Cards light their edge and surface where the pointer is.
  addEventListener('pointermove', (e) => {
    const card = (e.target as Element | null)?.closest?.<HTMLElement>('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

/** Loads a font family from Google Fonts. True when the browser can now draw with it. */
export async function loadWebFont(family: string): Promise<boolean> {
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;
  if (!document.querySelector(`link[href="${href}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    await new Promise<void>((done) => { link.onload = () => done(); link.onerror = () => done(); document.head.append(link); setTimeout(done, 5000); });
  }
  const faces = await document.fonts.load(`600 40px "${family}"`).catch(() => [] as FontFace[]);
  return faces.length > 0;
}

/** A website address from what the visitor typed ("linear.app", "https://x.com/page"), or null. */
export function cleanSite(raw: string): string | null {
  const s = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s) && !/^github\.com\//i.test(s) ? s : null;
}

/** Turns whatever the visitor typed into "owner/repo", or null. */
export function cleanRepo(raw: string): string | null {
  const s = raw.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})/);
  return m ? `${m[1]}/${m[2]}` : null;
}
