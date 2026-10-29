// "Repo in, trailer out": repo facts drift into the prism on the left, finished cuts leave it on the right.

interface Pt { x: number; y: number }
interface Source { label: string; fx: number; fy: number; r: number }

const SOURCES: Source[] = [
  { label: 'readme', fx: -0.36, fy: -0.3, r: 0 },
  { label: 'website', fx: -0.44, fy: -0.17, r: 0 },
  { label: 'stars', fx: -0.3, fy: -0.08, r: 0 },
  { label: '', fx: -0.24, fy: -0.26, r: 7 },
  { label: 'languages', fx: -0.4, fy: 0.08, r: 0 },
  { label: '', fx: -0.27, fy: 0.13, r: 13 },
  { label: 'release', fx: -0.33, fy: 0.3, r: 0 },
  { label: '', fx: -0.19, fy: 0.22, r: 6 },
  { label: 'colours', fx: -0.2, fy: 0.36, r: 0 },
  { label: 'code', fx: -0.21, fy: -0.02, r: 0 },
  { label: '', fx: -0.16, fy: -0.16, r: 5 },
];

const PEARL = ['#ffd0b4', '#f6b3cf', '#cdb4ff', '#f6e7c8', '#ffb38a'];

export function startFlow(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  let W = 0;
  let H = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const bez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
  };
  const along = (pts: Pt[], t: number): Pt => {
    const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    let d = t * lens.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i]) { const k = d / lens[i]; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k }; }
      d -= lens[i];
    }
    return pts[pts.length - 1];
  };
  const dot = (p: Pt, r: number, color: string, glow = 14) => {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, color);
    g.addColorStop(1, color + '55');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const draw = (time: number) => {
    ctx.clearRect(0, 0, W, H);
    const s = Math.min(1, W / 1100);
    const cx = W / 2;
    const cy = H / 2;
    const prism = canvas.parentElement!.querySelector<HTMLElement>('.flow-prism')!.clientWidth;
    const inPt = { x: cx - prism * 0.2, y: cy };
    const outPt = { x: cx + prism * 0.24, y: cy };
    const small = W < 640;

    // Inputs
    SOURCES.forEach((src, i) => {
      const p = { x: cx + src.fx * W * (small ? 1.05 : 0.95), y: cy + src.fy * H * 1.15 };
      const c1 = { x: p.x + (inPt.x - p.x) * 0.55, y: p.y };
      const c2 = { x: inPt.x - 60 * s, y: inPt.y + (p.y - inPt.y) * 0.15 };
      ctx.strokeStyle = 'rgba(246, 239, 231, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, inPt.x, inPt.y);
      ctx.stroke();
      const t = ((time * 0.00018 + i * 0.137) % 1);
      dot(bez(p, c1, c2, inPt, t), 2.2, PEARL[i % PEARL.length], 10);
      const bob = Math.sin(time * 0.0012 + i) * 3;
      if (src.label && !small) {
        ctx.font = `500 11px "Geist Mono", monospace`;
        const tw = ctx.measureText(src.label.toUpperCase()).width + 22;
        const x = p.x - tw;
        const y = p.y - 13 + bob;
        ctx.save();
        ctx.shadowColor = 'rgba(255, 195, 160, 0.35)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(12, 10, 10, 0.92)';
        ctx.beginPath();
        ctx.roundRect(x, y, tw, 26, 13);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(246, 239, 231, 0.28)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(246, 239, 231, 0.9)';
        ctx.fillText(src.label.toUpperCase(), x + 11, y + 17);
        dot({ x: p.x, y: p.y + bob * 0 }, 3, PEARL[i % PEARL.length], 8);
      } else {
        dot({ x: p.x, y: p.y + bob }, (src.r || 9) * (small ? 0.75 : 1), PEARL[i % PEARL.length], 22);
      }
    });

    // Outputs: two finished cuts, square and vertical.
    const outs = [
      { label: 'Square 1:1', w: 76, h: 76, y: cy - H * 0.24 },
      { label: 'Vertical 9:16', w: 56, h: 100, y: cy + H * 0.24 },
    ];
    const elbowX = cx + Math.max(prism * 0.42, W * 0.14);
    const frameX = cx + W * (small ? 0.33 : 0.27);
    outs.forEach((o, i) => {
      const fs = small ? 0.65 : 1;
      const fx = frameX;
      const fy = o.y;
      const pts: Pt[] = [outPt, { x: elbowX, y: outPt.y }, { x: elbowX, y: fy }, { x: fx - (o.w * fs) / 2 - 6, y: fy }];
      ctx.strokeStyle = 'rgba(246, 239, 231, 0.3)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.arcTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, 18);
      ctx.arcTo(pts[2].x, pts[2].y, pts[3].x, pts[3].y, 18);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.stroke();
      dot(along(pts, (time * 0.00022 + i * 0.5) % 1), 2.6, PEARL[i + 1], 14);

      const w = o.w * fs;
      const h = o.h * fs;
      const x = fx - w / 2;
      const y = fy - h / 2 + Math.sin(time * 0.001 + i * 2) * 3;
      ctx.save();
      ctx.shadowColor = i ? 'rgba(201, 168, 255, 0.7)' : 'rgba(255, 179, 138, 0.7)';
      ctx.shadowBlur = 34;
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#ffe2cf');
      g.addColorStop(0.5, '#f6b3cf');
      g.addColorStop(1, '#cdb4ff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12 * fs);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(10, 8, 8, 0.86)';
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 11 * fs);
      ctx.fill();
      const pr = 9 * fs;
      ctx.fillStyle = '#ffe2cf';
      ctx.beginPath();
      ctx.moveTo(fx - pr * 0.6, y + h / 2 - pr);
      ctx.lineTo(fx + pr, y + h / 2);
      ctx.lineTo(fx - pr * 0.6, y + h / 2 + pr);
      ctx.closePath();
      ctx.fill();
      ctx.font = `500 ${small ? 10 : 12}px "Geist", sans-serif`;
      ctx.fillStyle = 'rgba(246, 239, 231, 0.92)';
      ctx.letterSpacing = '1.5px';
      const label = o.label.toUpperCase();
      if (small) { ctx.textAlign = 'center'; ctx.fillText(label.split(' ')[0], fx, y + h + 18); ctx.textAlign = 'left'; }
      else ctx.fillText(label, x + w + 16 * fs, y + h / 2 + 4);
      ctx.letterSpacing = '0px';
    });
  };

  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loop = (now: number) => {
    if (visible || still) draw(still ? 1000 : now);
    if (!still) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
